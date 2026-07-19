import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import { approveAction } from "../lib/nova/actions";
import { requireStore, isOwnerRole } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

/** Deny scheduled runs and any non-owner/admin caller. */
function ownerOnly(ctx: ApprovalContext, verb: string) {
  const a = ctx.session.auth.current;
  if (a?.authenticator === "app" && a.principalId === "eve:app") {
    return { type: "denied" as const, reason: `Scheduled runs cannot ${verb} actions — only the owner can.` };
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
    const { storeId, role } = requireStore(ctx);
    if (!isOwnerRole(role)) {
      return { error: "Only the store owner or an admin can approve actions." };
    }
    try {
      return await approveAction(storeFor(storeId), actionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
