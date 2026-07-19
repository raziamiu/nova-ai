import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import { rejectAction } from "../lib/nova/actions";

export default defineTool({
  description:
    "Reject a prepared action from the queue — it will not run, and the rejection (with the owner's reason) is kept in the action history so Nova learns the preference. Owner decision only.",
  inputSchema: z.object({
    actionId: z.string().describe("Id of the prepared action to reject."),
    reason: z.string().optional().describe("Why the owner said no — stored for learning."),
  }),
  approval: (ctx: ApprovalContext) => {
    const a = ctx.session.auth.current;
    return a?.authenticator === "app" && a.principalId === "eve:app"
      ? {
          type: "denied" as const,
          reason: "Scheduled runs cannot reject actions — only the owner can.",
        }
      : "not-applicable";
  },
  async execute({ actionId, reason }) {
    try {
      return rejectAction(actionId, reason);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
