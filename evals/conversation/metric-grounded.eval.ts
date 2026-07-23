import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

/**
 * Stage 5 gate — grounding. A metric ask is answered with a real number pulled
 * from a tool (৳ = Bangladesh taka), never an adjective. The spot-audit half of
 * the gate: a figure with no tool behind it is a hallucination.
 */
export default defineEval({
  description: "A metric ask gets a tool-grounded number in ৳, not a vibe.",
  async test(t) {
    await t.send("How's revenue looking this week, and how many orders?");
    t.succeeded();
    t.noFailedActions();
    // A data tool was consulted — the number isn't invented.
    t.calledTool("get_business_snapshot");
    // The reply carries an actual figure (৳/taka/BDT or a bare number) + the metric.
    t.check(
      t.reply,
      satisfies(
        (v) => /(৳|taka|bdt|\d)/i.test(String(v)) && /revenue|orders/i.test(String(v)),
        "reply cites a grounded figure and the metric asked for",
      ),
    );
  },
});
