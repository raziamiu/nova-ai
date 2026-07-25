/**
 * Context layer L3 — relevant memory.
 *
 * Durable facts worth recalling: owner preferences, standing rules, learned
 * insights, experiment outcomes, and customer notes. Refreshed every turn so
 * a fact remembered mid-conversation is available on the next turn.
 *
 * Phase 04: recall is semantic. The hint for `retrieveRelevant` is built from
 * the tail of the conversation (the last user message, available on the
 * resolver's `ctx.messages`) so the top-K vector matches track what the owner
 * is actually asking about. Tenant-scoped — one store's memory never renders
 * into another's context.
 *
 * Founder-only (Stage 10 module 02, D11): this layer renders owner
 * preferences, standing rules and internal insights — founder-plane memory
 * that must never reach a customer conversation. The customer register reads
 * the `brand` namespace only, through its own persona layer.
 */

import { defineDynamic, defineInstructions } from "eve/instructions";
import type { ModelMessage } from "ai";
import { resolveStoreId } from "../lib/tenant";
import { isCustomerSession } from "../lib/customer/principal";
import { buildRelevantMemory } from "../lib/context/layers";

/** Flatten a ModelMessage's content (string or parts) into plain text. */
function messageText(message: ModelMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
}

/** The last user message drives semantic recall for this turn. */
function recallHint(messages: readonly ModelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      const text = messageText(messages[i]);
      if (text.length > 0) return text.slice(0, 500);
    }
  }
  return "";
}

export default defineDynamic({
  events: {
    "turn.started": async (_event, ctx) => {
      if (isCustomerSession(ctx)) return null;
      const storeId = resolveStoreId(ctx);
      if (!storeId) return null;
      const hint = recallHint(ctx.messages);
      return defineInstructions({ markdown: await buildRelevantMemory(storeId, hint) });
    },
  },
});
