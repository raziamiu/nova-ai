import { defineTool } from "eve/tools";
import { z } from "zod";
import { NOVA_DEPARTMENTS } from "../lib/types";
import { performAction } from "../lib/nova/actions";
import { receiptSchema } from "../lib/nova/schemas";
import { requireStore } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Refund a batch of orders — a FOUNDER-ONLY verb (PRD §5.4).
 *
 * This tool exists precisely so that Nova can propose the thing and never do
 * it. The authority seam classifies `bulk_refund` as founder-only, so every
 * call returns `blocked` with the rule `founder_only:bulk_refund` and an
 * escalation raised to the founder — at every autonomy level, including
 * Acting CEO, on every path.
 *
 * Why a tool at all, if it always refuses? Because the alternative is worse:
 * without it, Nova asked to "refund these twelve orders" would either improvise
 * with single-order verbs (defeating the classification) or fail with a
 * confusing "no such tool". This way the request lands in the ledger as an
 * explained, receipted proposal the founder can act on — which is exactly what
 * a refusal is supposed to produce.
 *
 * The founder-side execution path arrives with phase 08's approve transaction,
 * and needs a dakio-api refund endpoint that does not exist yet.
 */
export default defineTool({
  description:
    "Propose refunding several orders at once. Nova can never execute this — bulk refunds are the owner's decision at every autonomy level. The proposal is recorded with its reasoning and raised to the owner for a decision.",
  inputSchema: z.object({
    orderIds: z.array(z.string()).min(1).describe("Orders to refund."),
    reason: z.string().min(10).describe("Why these orders should be refunded, in the owner's terms."),
    receipt: receiptSchema,
    department: z
      .enum(NOVA_DEPARTMENTS)
      .optional()
      .describe("Attribution for the activity log; defaults to support."),
  }),
  async execute({ receipt, department, ...payload }, ctx) {
    const client = storeFor(requireStore(ctx).storeId);
    return performAction(client, {
      type: "bulk_refund" as never,
      department: department ?? "support",
      title: `Refund ${payload.orderIds.length} order${payload.orderIds.length === 1 ? "" : "s"}`,
      payload,
      receipt,
      dutyRef: "support.refund_processing",
    });
  },
});
