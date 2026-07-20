import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import { approveAction } from "../lib/nova/actions";
import { requireStore, isOwnerRole } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/**
 * Deny scheduled/background runs and any non-owner/admin caller.
 *
 * `principalType !== "user"` (not a literal `eve:app` match) so this also
 * denies the Phase 05 dispatcher's per-tenant job principal
 * (`{authenticator:"nova-scheduler", principalType:"runtime"}` — see
 * `agent/lib/jobs/principal.ts`), which doesn't match the old `eve:app`
 * check at all. Trust-plane tools must deny every non-human caller, not just
 * eve's own built-in schedule principal.
 */
function ownerOnly(ctx: ApprovalContext, verb: string) {
  const a = ctx.session.auth.current;
  if (a?.principalType !== "user") {
    return { type: "denied" as const, reason: `Scheduled or background runs cannot ${verb} actions — only the owner can.` };
  }
  const role = typeof a?.attributes?.role === "string" ? a.attributes.role : undefined;
  if (!isOwnerRole(role)) {
    return { type: "denied" as const, reason: `Only the store owner or an admin can ${verb} actions.` };
  }
  return "not-applicable" as const;
}

export default defineTool({
  description:
    "Approve a prepared action from the queue — it executes immediately and the outcome is returned. Use list_actions with status \"prepared\" to see what is waiting. Owner decision only; call it when the owner says yes to a specific prepared action.",
  inputSchema: z.object({
    actionId: z.string().describe("Id of the prepared action to approve."),
  }),
  approval: (ctx: ApprovalContext) => ownerOnly(ctx, "approve"),
  async execute({ actionId }, ctx) {
    // Re-check authorization at execution time: approval ≠ authorization.
    const a = ctx.session.auth.current ?? ctx.session.auth.initiator;
    const { storeId, role } = requireStore(ctx);
    if (a?.principalType !== "user" || !isOwnerRole(role)) {
      return { error: "Only the store owner or an admin can approve actions." };
    }
    try {
      return await approveAction(storeFor(storeId), actionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
