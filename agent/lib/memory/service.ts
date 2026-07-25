/**
 * The memory & learning service — the boundary the blueprint (§APIs) defines:
 *
 *   upsert(storeId, entry)            durable semantic write (+ outbox embed)
 *   retrieveRelevant(storeId, hint,k) vector + recency + weight recall for L3
 *   listNamespace(storeId, namespace) keyed read
 *   remove(storeId, namespace, key)   hard delete (row + embedding)
 *   distill(storeId, sinceDays)       bulk episodic read for reflection
 *
 * Every entry point takes an explicit `storeId` — there is NO ambient default,
 * so a caller physically cannot read or write memory without naming a tenant.
 * The service resolves `storeFor(storeId)` itself; tenancy is therefore the
 * same guarantee the rest of the agent relies on (see lib/tenant.ts), and one
 * tenant's vectors can never enter another's ranking.
 *
 * Embeddings follow the outbox pattern: writes leave `embedding == null`, and
 * the embed worker (or a lazy fill inside retrieveRelevant) computes them. The
 * embed backend is stub-by-default and gateway-gated, so this whole module runs
 * with no model key.
 */

import { InboxSendRefused, type StoreClient } from "../store/client";
import type { ActionRecord, MemoryEntry, MemoryNamespace, MemoryUpsert } from "../types";
import { storeFor } from "../store/resolve";
import { bustCustomerPersona } from "../customer/persona";
import { embedBatch, embedText, usingGatewayEmbeddings } from "./embed";
import { rankByRelevance, RETRIEVAL, type ScoredEntry } from "./vector";

/** Max entries the embed worker processes per batch (blueprint: ≤64). */
const EMBED_BATCH = 64;

/**
 * Fill embeddings for any entries still in the outbox (`embedding == null`).
 * Idempotent and cheap in the stub backend; batched for the gateway path.
 * Runs off the turn hot path in production; called lazily here so retrieval is
 * always correct even before the async worker has caught up.
 */
export async function runEmbedWorker(client: StoreClient): Promise<number> {
  const pending = (await client.listMemory()).filter((m) => !hasEmbedding(m));
  if (pending.length === 0) return 0;

  let embedded = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH) {
    const slice = pending.slice(i, i + EMBED_BATCH);
    const vectors = await embedBatch(slice.map(embeddingInput));
    for (let j = 0; j < slice.length; j += 1) {
      await client.setMemoryEmbedding(slice[j].namespace, slice[j].key, vectors[j]);
      embedded += 1;
    }
  }
  return embedded;
}

function hasEmbedding(entry: MemoryEntry): boolean {
  return Array.isArray(entry.embedding) && entry.embedding.length > 0;
}

/** The text an entry is embedded from — key + value carry the meaning. */
function embeddingInput(entry: { key: string; value: string }): string {
  return `${entry.key.replace(/[-_]/g, " ")}. ${entry.value}`;
}

/**
 * Durable semantic write. Embeds inline (stub is free; keeps tests simple and
 * retrieval immediately consistent) and stores the vector on the row. In a
 * gateway deployment set the embedding aside for the async worker instead.
 */
export async function upsert(storeId: string, entry: MemoryUpsert): Promise<MemoryEntry> {
  const written = await upsertVia(storeFor(storeId), entry);
  propagateBrandEdit(storeId, entry.namespace);
  return written;
}

/**
 * A `brand`-memory write is the L-BRAND half of the customer persona (Stage 10
 * D3), and the rendered persona is cached for 24h under a key that carries the
 * GUARDRAILS version — which a memory write does not bump. So a founder fixing
 * a wrong shop fact ("delivery outside Dhaka is 3 days, not 5") would keep
 * having customers told the old number for up to a day, with nothing in the
 * product to explain why the correction did nothing. Busting here is what makes
 * D3's "propagates to all live customer sessions within one turn" true: durable
 * sessions re-resolve their instructions on the next `turn.started`.
 *
 * Deliberately narrow — only `brand` renders into a customer session, and
 * clearing the whole tenant prefix would drop the 24h profile cache on every
 * `preferences` write for no gain.
 */
function propagateBrandEdit(storeId: string, namespace: MemoryNamespace): void {
  if (namespace === "brand") bustCustomerPersona(storeId);
}

/**
 * A memory write the SERVER refused (Stage 10 module 03, D10).
 *
 * dakio-api runs a redaction guard on both memory write routes: a value
 * carrying an NID, a card PAN or an OTP is rejected with a 422, because a
 * durable "customer notes" row is the one place a leaked credential outlives
 * the conversation it appeared in. Prompt-level rules alone cannot enforce
 * that; the server has to say no.
 *
 * This class exists so the model is TOLD no, and told why. Without it the
 * refusal arrives as `Dakio POST /api/v1/agent-data/memory → 422: …` — an
 * opaque transport string with no code on it, and the only sensible thing a
 * model can do with an opaque failure is try again, which is exactly the loop a
 * guarded write must not provoke. A sibling of `InboxSendRefused` rather than a
 * reuse of it: the codes are a different taxonomy and a `catch` that wants one
 * should not silently swallow the other.
 */
export class MemoryWriteRefused extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = "MemoryWriteRefused";
    this.code = code;
    this.status = status;
  }
}

/** The one status the memory guard answers with (`res.status(422).json({error})`). */
const MEMORY_REFUSAL_STATUS = 422;

/**
 * Turn a refused write into a `MemoryWriteRefused`; leave anything else alone.
 *
 * Two shapes have to be recognised, and both are load-bearing. If the HTTP
 * client declares `refusalOn: [422]` on this route, the 422 arrives already
 * parsed as an `InboxSendRefused` carrying the server's code. If it does not,
 * the same 422 arrives as the generic transport `Error` whose message is the
 * status line plus the raw body. Matching only the first would make the
 * behaviour depend on a flag in another file — and the failure mode of getting
 * it wrong is silent: a retry loop against a guard that will never say yes.
 *
 * A genuine outage (500, network) is NOT a refusal and is rethrown untouched:
 * that one SHOULD be retried, and calling it a refusal would teach the model to
 * give up on a write that was only ever late.
 */
function asMemoryRefusal(err: unknown): unknown {
  if (err instanceof InboxSendRefused) {
    if (err.status !== MEMORY_REFUSAL_STATUS) return err;
    return new MemoryWriteRefused(String(err.code), refusalMessage(err.message), err.status);
  }
  const raw = err instanceof Error ? err.message : String(err);
  if (!/agent-data\/memory\b[^]*→ 422\b/.test(raw)) return err;
  return new MemoryWriteRefused("MEMORY_REFUSED", refusalMessage(raw));
}

/**
 * The sentence the model reads. It states the outcome, the reason as the server
 * gave it, and the one instruction that matters — do not retry — because a
 * refusal the model treats as a transient is worse than no refusal at all.
 */
function refusalMessage(detail: string): string {
  const reason = serverReason(detail);
  return `Memory write refused by the server${reason ? `: ${reason}` : ""}. This value is not storable as written — the redaction guard rejects account numbers, ID numbers and one-time codes. Do not retry it; write the durable fact without the digits, or write nothing.`;
}

/** Pull `{"error":"…"}` out of a transport message, else use the tail as-is. */
function serverReason(detail: string): string {
  const json = detail.match(/\{[^]*\}/)?.[0];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { error?: unknown; message?: unknown };
      const reason = parsed.error ?? parsed.message;
      if (typeof reason === "string" && reason.length > 0) return reason;
    } catch {
      /* Non-JSON body: fall through to the raw tail. */
    }
  }
  return detail.split("→ 422:").pop()?.trim().slice(0, 200) ?? "";
}

/**
 * Client-scoped write, used by call sites that already hold a tenant-bound
 * client (e.g. the rejection fast-path in the action pipeline).
 *
 * Stub mode embeds inline (free; keeps recall immediately consistent for tests
 * and single-process dev). Gateway mode leaves the embedding for the async
 * embed worker — writes never block on a model round trip (blueprint: "embed
 * worker async (never blocks a turn)"). The M2 guard in `rankByRelevance`
 * ensures an entry still in the outbox can't leak into recall meanwhile.
 *
 * The translation sits HERE rather than in either tool, so every writer — the
 * `remember` tool, the rejection fast-path, and whatever the distill lane calls
 * — gets the same named refusal. One write path, one place that explains a no.
 */
export async function upsertVia(client: StoreClient, entry: MemoryUpsert): Promise<MemoryEntry> {
  const embedding =
    entry.embedding ?? (usingGatewayEmbeddings() ? null : await embedText(embeddingInput(entry)));
  try {
    return await client.upsertMemory({ ...entry, embedding });
  } catch (err) {
    throw asMemoryRefusal(err);
  }
}

/**
 * Top-K semantic recall for L3. Embeds the hint, brute-force cosine over the
 * tenant's entries with the blueprint scoring, threshold, and dedupe. An empty
 * hint yields no vector matches (score below threshold) — callers keep their
 * own always-in-view set (standing rules/preferences) on top of this.
 */
export async function retrieveRelevant(
  storeId: string,
  hint: string,
  k: number = RETRIEVAL.k,
): Promise<ScoredEntry[]> {
  const client = storeFor(storeId);
  // Stub mode: backfill inline (free + keeps tests immediately consistent).
  // Gateway mode: NEVER embed documents on the turn hot path — the async embed
  // worker fills the index off-peak; here we only embed the query and rank over
  // whatever is already indexed (blueprint: the worker never blocks a turn).
  if (!usingGatewayEmbeddings()) await runEmbedWorker(client);
  const trimmed = hint.trim();
  if (trimmed.length === 0) return [];
  const [entries, queryEmbedding] = await Promise.all([
    client.listMemory(),
    embedText(trimmed),
  ]);
  return rankByRelevance(entries, queryEmbedding, Date.parse(client.now()), k);
}

/** Keyed read of one namespace (the `recall` tool's uncapped view). */
export async function listNamespace(
  storeId: string,
  namespace?: MemoryNamespace,
): Promise<MemoryEntry[]> {
  return storeFor(storeId).listMemory(namespace);
}

/** Hard delete — the row and its embedding go together (compliance). */
export async function remove(
  storeId: string,
  namespace: MemoryNamespace,
  key: string,
): Promise<boolean> {
  const deleted = await storeFor(storeId).deleteMemory(namespace, key);
  // Retracting a wrong shop fact has to reach customers as fast as correcting
  // one does — a stale cache would keep quoting a note the founder just erased.
  if (deleted) propagateBrandEdit(storeId, namespace);
  return deleted;
}

// ---------------------------------------------------------------------------
// Reflection input — bulk episodic read
// ---------------------------------------------------------------------------

export interface ReflectionInput {
  storeId: string;
  sinceDays: number;
  /** Owner rejections in the window, with the reason they gave. */
  rejections: { action: ActionRecord; reason: string | null }[];
  /** Actions executed in the window (raw episodic material). */
  executed: ActionRecord[];
  /** Experiments still open, for the evaluator step. */
  openExperiments: string[];
  /** The most recent report (yesterday's plan) for continuity. */
  latestReportTitle: string | null;
}

/**
 * Bulk episodic read that feeds a reflection run. Reads the window's action
 * log and open experiments; pure data, no model. The reflection job turns this
 * into ≤10 provenance-carrying memory writes.
 */
export async function distill(storeId: string, sinceDays: number): Promise<ReflectionInput> {
  const client = storeFor(storeId);
  const nowMs = Date.parse(client.now());
  const cutoff = nowMs - sinceDays * 24 * 60 * 60 * 1000;

  const [actions, openExperiments, reports] = await Promise.all([
    client.listActions(),
    client.listExperiments("running"),
    client.listReports({ limit: 1 }),
  ]);

  const inWindow = (iso: string | null): boolean => iso != null && Date.parse(iso) >= cutoff;

  const rejections = actions
    .filter((a) => a.status === "rejected" && inWindow(a.decidedAt))
    .map((action) => ({ action, reason: rejectionReason(action) }));

  const executed = actions.filter((a) => a.status === "executed" && inWindow(a.executedAt));

  return {
    storeId,
    sinceDays,
    rejections,
    executed,
    openExperiments: openExperiments.map((e) => e.id),
    latestReportTitle: reports[0]?.title ?? null,
  };
}

/** Recover the owner's stated reason from a rejected action's outcome line. */
export function rejectionReason(action: ActionRecord): string | null {
  const outcome = action.outcome ?? "";
  const match = outcome.match(/Rejected by owner:\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Rejection fast-path — rejections teach immediately (blueprint §6)
// ---------------------------------------------------------------------------

/** Stable, readable key for the standing objection a rejection creates. */
export function rejectionMemoryKey(action: Pick<ActionRecord, "type">): string {
  return `rejected-${action.type}`;
}

/**
 * Synchronously record the owner's rejection as a `preferences` candidate so
 * Nova stops repeating the mistake WITHOUT waiting for nightly reflection.
 * Carries provenance (the rejected action id) and a lower weight — it's a
 * learned candidate, not an owner-authored rule. Called from `rejectAction`.
 */
export async function learnFromRejection(
  client: StoreClient,
  action: ActionRecord,
  reason?: string,
): Promise<MemoryEntry> {
  const because = reason && reason.trim().length > 0 ? ` because: ${reason.trim()}` : ".";
  const value = `Owner rejected "${action.title}" (${action.type})${because} Weigh this standing objection before proposing similar ${action.type} actions.`;
  return upsertVia(client, {
    namespace: "preferences",
    key: rejectionMemoryKey(action),
    value,
    source: "nova",
    weight: 0.6,
    provenance: { actionIds: [action.id], note: "rejection fast-path" },
  });
}
