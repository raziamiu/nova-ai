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

import type { StoreClient } from "../store/client";
import type { ActionRecord, MemoryEntry, MemoryNamespace, MemoryUpsert } from "../types";
import { storeFor } from "../store/resolve";
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
  return upsertVia(storeFor(storeId), entry);
}

/**
 * Client-scoped write, used by call sites that already hold a tenant-bound
 * client (e.g. the rejection fast-path in the action pipeline).
 */
export async function upsertVia(client: StoreClient, entry: MemoryUpsert): Promise<MemoryEntry> {
  const embedding = entry.embedding ?? (await embedText(embeddingInput(entry)));
  return client.upsertMemory({ ...entry, embedding });
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
  return storeFor(storeId).deleteMemory(namespace, key);
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
export function rejectionMemoryKey(action: ActionRecord): string {
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
