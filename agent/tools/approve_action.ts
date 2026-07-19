import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import { approveAction } from "../lib/nova/actions";

export default defineTool({
  description:
    "Approve a prepared action from the queue — it executes immediately and the outcome is returned. Use list_actions with status \"prepared\" to see what is waiting. Owner decision only; call it when the owner says yes to a specific prepared action.",
  inputSchema: z.object({
    actionId: z.string().describe("Id of the prepared action to approve."),
  }),
  approval: (ctx: ApprovalContext) => {
    const a = ctx.session.auth.current;
    return a?.authenticator === "app" && a.principalId === "eve:app"
      ? {
          type: "denied" as const,
          reason: "Scheduled runs cannot approve actions — only the owner can.",
        }
      : "not-applicable";
  },
  async execute({ actionId }) {
    try {
      return approveAction(actionId);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
