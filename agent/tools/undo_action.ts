import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import { undoAction } from "../lib/nova/actions";
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
    "Roll back an executed action using its undo snapshot (e.g. restore a price, reactivate a campaign). Only executed, reversible actions can be undone — sent messages cannot be unsent. Owner decision only.",
  inputSchema: z.object({
    actionId: z.string().describe("Id of the executed action to roll back."),
  }),
  approval: (ctx: ApprovalContext) => ownerOnly(ctx, "undo"),
  async execute({ actionId }, ctx) {
    const { storeId, role } = requireStore(ctx);
    if (!isOwnerRole(role)) {
      return { error: "Only the store owner or an admin can undo actions." };
    }
    try {
      return await undoAction(storeFor(storeId), actionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
