import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import { rejectAction } from "../lib/nova/actions";
import { requireStore, isOwnerRole } from "../lib/tenant";
import { storeFor } from "../lib/store/resolve";

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
    "Reject a prepared action from the queue — it will not run, and the rejection (with the owner's reason) is kept in the action history so Nova learns the preference. Owner decision only.",
  inputSchema: z.object({
    actionId: z.string().describe("Id of the prepared action to reject."),
    reason: z.string().optional().describe("Why the owner said no — stored for learning."),
  }),
  approval: (ctx: ApprovalContext) => ownerOnly(ctx, "reject"),
  async execute({ actionId, reason }, ctx) {
    const { storeId, role } = requireStore(ctx);
    if (!isOwnerRole(role)) {
      return { error: "Only the store owner or an admin can reject actions." };
    }
    try {
      return await rejectAction(storeFor(storeId), actionId, reason);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
