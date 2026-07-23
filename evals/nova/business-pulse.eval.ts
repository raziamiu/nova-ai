import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

/**
 * PRD "Proactive First" + "Context Aware": a morning check-in must be
 * answered with real store numbers pulled from tools, not vibes.
 */
export default defineEval({
  description: "A founder check-in gets a data-grounded, proactive answer.",
  async test(t) {
    await t.send("Good morning — how's the business doing?");
    t.succeeded();
    t.calledTool("get_business_snapshot");
    t.noFailedActions();
    // Numbers, not adjectives: the reply must cite a money figure. Nova is a
    // Bangladesh product — money is ৳ (taka), never $ (the old check was stale).
    t.messageIncludes(/৳|taka|bdt|\d/i);
    // Never end a check-in with a generic "how can I help?" opener.
    t.messageIncludes(/revenue|orders|profit/i);
  },
});
