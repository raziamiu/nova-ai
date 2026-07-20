import { defineSchedule } from "eve/schedules";

// Hourly during waking hours — quiet anomaly radar. No news = no report.
export default defineSchedule({
  cron: "0 9-21 * * *",
  markdown:
    "Hourly pulse check. First, call get_inbox_events (unprocessed) — these " +
    "are real store events (new/updated orders, newly abandoned carts) Dakio " +
    "has pushed since your last check. Skim them for anything that changes " +
    "what you'd otherwise report or act on this hour (e.g. a spike in new " +
    "orders, a cluster of cancellations, a big cart just abandoned) — you do " +
    "not need to act on every event individually, they're situational " +
    "awareness for the anomaly scan below, not a task list. Call " +
    "mark_event_processed on each one once you've taken it into account. " +
    "Then run detect_anomalies. If there are no critical findings, stop — do " +
    "not file a report or take action (never spam the owner). If there ARE " +
    "critical findings: take the corrective action for each through the " +
    "normal action tools (they are autonomy-gated, so they will execute or " +
    "queue for approval as configured), then file ONE consolidated report " +
    'with file_report (kind "pulse") listing each finding, the evidence, and ' +
    "what was done or prepared.",
});
