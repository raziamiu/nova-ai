import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

/**
 * PRD daily workflow: the 08:00 schedule compiles the overnight digest and
 * files it to the dashboard via file_report. Uses the dev-only schedule
 * dispatch route (`eve dev` never fires cron).
 */
export default defineEval({
  description: "The morning-report schedule files a morning report to the dashboard.",
  async test(t) {
    const { sessionIds } = await t.target.dispatchSchedule("morning-report");
    t.check(
      sessionIds.length,
      satisfies((n) => Number(n) >= 1, "dispatch started at least one session"),
    );
    if (sessionIds.length === 0) return;
    await t.target.attachSession(sessionIds[0]!);
    t.succeeded();
    t.calledTool("file_report");
    t.noFailedActions();
  },
});
