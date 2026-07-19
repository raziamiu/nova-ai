import { defineSchedule } from "eve/schedules";

// Hourly during waking hours — quiet anomaly radar. No news = no report.
export default defineSchedule({
  cron: "0 9-21 * * *",
  markdown:
    "Hourly pulse check. Run detect_anomalies. If there are no critical " +
    "findings, stop — do not file a report or take action (never spam the " +
    "owner). If there ARE critical findings: take the corrective action for " +
    "each through the normal action tools (they are autonomy-gated, so they " +
    "will execute or queue for approval as configured), then file ONE " +
    'consolidated report with file_report (kind "pulse") listing each ' +
    "finding, the evidence, and what was done or prepared.",
});
