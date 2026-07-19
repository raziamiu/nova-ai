import { defineTool, type ApprovalContext } from "eve/tools";
import { z } from "zod";
import type { AutonomyLevel } from "../lib/types";
import { getStoreClient } from "../lib/store/client";

export default defineTool({
  description:
    "Change Nova's autonomy level or guardrails. Only call when the OWNER explicitly asks. Levels: 0 observe only, 1 recommend, 2 prepare actions, 3 auto low-risk, 4 business operator. Unspecified fields keep their current values; returns the new config.",
  inputSchema: z.object({
    level: z
      .number()
      .int()
      .min(0)
      .max(4)
      .optional()
      .describe("New autonomy level (0-4); omit to keep the current level."),
    guardrails: z
      .object({
        maxDiscountPct: z
          .number()
          .optional()
          .describe("Largest discount Nova may ever issue, in percent."),
        maxPriceChangePct: z
          .number()
          .optional()
          .describe("Largest single price change, in percent of current price."),
        maxBudgetChangePct: z
          .number()
          .optional()
          .describe("Largest daily-budget change on a campaign, in percent."),
        minMarginPct: z
          .number()
          .optional()
          .describe("Never let a price change push margin below this percent."),
        maxAutoPurchaseOrderTotal: z
          .number()
          .optional()
          .describe("Purchase orders above this USD total always need approval."),
        maxAutoRefundTotal: z
          .number()
          .optional()
          .describe("Refunds above this USD amount always need approval."),
      })
      .optional()
      .describe("Guardrail overrides; unspecified guardrails keep their current values."),
  }),
  approval: (ctx: ApprovalContext) => {
    const a = ctx.session.auth.current;
    return a?.authenticator === "app" && a.principalId === "eve:app"
      ? { type: "denied" as const, reason: "Only the owner may change autonomy." }
      : "user-approval";
  },
  async execute({ level, guardrails }) {
    const client = getStoreClient();
    const current = await client.getAutonomy();
    return client.setAutonomy({
      level: (level ?? current.level) as AutonomyLevel,
      guardrails: { ...current.guardrails, ...guardrails },
      updatedAt: client.now(),
    });
  },
});
