import { defineSchedule } from "eve/schedules";

// 08:00 UTC daily — the founder's "while you were away" digest.
export default defineSchedule({
  cron: "0 8 * * *",
  markdown:
    "It is morning report time. Load the morning-report skill and follow it " +
    "exactly: gather the overnight numbers, completed work, anomalies, and " +
    "pending approvals, then file the report with file_report (kind " +
    '"morning"). Work only from tool data.',
});
