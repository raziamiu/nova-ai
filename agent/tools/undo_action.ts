import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import { undoAction } from "../lib/nova/actions";

export default defineTool({
  description:
    "Roll back an executed action using its undo snapshot (e.g. restore a price, reactivate a campaign). Only executed, reversible actions can be undone — sent messages cannot be unsent. Owner decision only.",
  inputSchema: z.object({
    actionId: z.string().describe("Id of the executed action to roll back."),
  }),
  approval: (ctx: ApprovalContext) => {
    const a = ctx.session.auth.current;
    return a?.authenticator === "app" && a.principalId === "eve:app"
      ? {
          type: "denied" as const,
          reason: "Scheduled runs cannot undo actions — only the owner can.",
        }
      : "not-applicable";
  },
  async execute({ actionId }) {
    try {
      return undoAction(actionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
