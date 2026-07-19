import { defineTool } from "eve/tools";
import { z } from "zod";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Review Nova's action queue and history — every mutation Nova attempted, with its justification (reason, expected impact, confidence), risk class, and outcome. Filter by status: prepared = awaiting owner approval; executed, blocked, rejected, undone. Returns { count, actions } newest first (max 50).",
  inputSchema: z.object({
    status: z
      .enum(["executed", "prepared", "blocked", "rejected", "undone"])
      .optional()
      .describe("Only actions with this status; omit for the full history."),
  }),
  async execute({ status }) {
    try {
      const all = getStoreClient().listActions(status);
      const sorted = [...all].sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
      return {
        count: all.length,
        actions: sorted.slice(0, 50).map((a) => ({
          id: a.id,
          type: a.type,
          department: a.department,
          title: a.title,
          status: a.status,
          riskClass: a.riskClass,
          justification: a.justification,
          outcome: a.outcome,
          undoable: a.undoable,
          createdAt: a.createdAt,
        })),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
});
