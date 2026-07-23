/**
 * The typed reply envelope (Stage 5 "Conversation", design decision #1).
 *
 * A department subagent doesn't answer in prose that the root splices in — it
 * returns THIS shape. The signature (`agentId`), the grounding refs (`stats`),
 * the option chips (`optionRefs` → decision refs), and any action receipt
 * (`actionRef`) are DATA, validated before persistence, so the UI renders them
 * from real columns and the grounding audit can re-run every numeric claim.
 *
 * `stats` is capped (envelope bloat is a listed risk) and every stat names the
 * tool + params that produced its value — an unattributed number is a failed
 * grounding audit, not a stylistic choice (§13 chat row, Stage 5 gate).
 */

import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../types";

/** A grounded numeric claim: the value AND how to reproduce it. */
export const chatStatSchema = z.object({
  label: z.string().min(1).describe("What this number is, e.g. 'orders today'."),
  value: z.union([z.string(), z.number()]).describe("The value as claimed in the reply."),
  source: z
    .object({
      tool: z.string().min(1).describe("The tool that produced it, e.g. 'get_orders'."),
      params: z.record(z.string(), z.unknown()).optional().describe("The params it was called with — the audit re-runs this."),
    })
    .describe("How to reproduce the value — the grounding contract."),
});

export const chatOptionRefSchema = z.object({
  decisionRef: z.string().min(1).describe("The decision this chip approves (08) — choosing it executes that decision, nothing bespoke."),
  label: z.string().min(1).describe("The chip's founder-facing label."),
});

/** The department subagent's reply-to-root envelope. */
export const replyEnvelopeSchema = z.object({
  agentId: z
    .enum(NOVA_DEPARTMENTS)
    .describe("Which agent is signing this reply — validated against the org, never free text."),
  text: z.string().min(1).describe("The founder-facing answer, in the founder's language (bn/en)."),
  stats: z
    .array(chatStatSchema)
    .max(8)
    .default([])
    .describe("Grounding refs for every number in `text` — capped at 8; an unattributed number fails the audit."),
  optionRefs: z
    .array(chatOptionRefSchema)
    .max(3)
    .default([])
    .describe("Decision chips (≤3, the desk rule) — each approves a server-authored decision."),
  actionRef: z.string().optional().describe("The action id when this reply executed something (its receipt)."),
});

export type ChatStat = z.infer<typeof chatStatSchema>;
export type ChatOptionRef = z.infer<typeof chatOptionRefSchema>;
export type ReplyEnvelope = z.infer<typeof replyEnvelopeSchema>;

/**
 * Validate + normalize an envelope before persistence. Returns the parsed
 * envelope or a list of errors — a hallucinated agentId, an over-cap stats
 * array, or a bare number with no source all fail HERE, never reach the UI.
 */
export function parseEnvelope(input: unknown): { ok: true; envelope: ReplyEnvelope } | { ok: false; errors: string[] } {
  const r = replyEnvelopeSchema.safeParse(input);
  if (r.success) return { ok: true, envelope: r.data };
  return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
}
