import { defineSchedule } from "eve/schedules";

// Monday 09:00 UTC — step back and steer.
export default defineSchedule({
  cron: "0 9 * * 1",
  markdown:
    "Weekly strategy review. Load the weekly-strategy skill and follow it: " +
    "measure the week against the stored goals, write the strategy review, " +
    'file it with file_report (kind "weekly_strategy"), and store next ' +
    "week's committed focus in memory.",
});
