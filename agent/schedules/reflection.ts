import { defineSchedule } from "eve/schedules";

/**
 * Nightly reflection — 03:00 UTC, after night-operations (02:00) has produced
 * the day's actions and reports. Reads the last 24h of episodic log and
 * distills owner rejections + experiment outcomes into durable, owner-visible
 * semantic memory (every write carries provenance; never silent drift).
 *
 * Single-tenant / dev-dispatch only until Phase 05 adds the per-tenant
 * dispatcher — same posture as the other schedules. The deterministic
 * reflection service runs with no model key; the versioned prompt lives in
 * skills/reflection.md for the gateway path.
 */
export default defineSchedule({
  cron: "0 3 * * *",
  markdown:
    "Nightly reflection. Load the reflection skill and follow it end to end:\n" +
    "1. Review the last 24h of decisions — especially any actions the owner " +
    "rejected (list_actions) and the reasons they gave.\n" +
    "2. Distill durable lessons into memory with the remember tool — owner " +
    "rejections become preference/rule candidates, each citing the action it " +
    "came from. Keep it to at most 10 writes; update existing entries rather " +
    "than duplicating.\n" +
    "3. Evaluate any open experiments against their targets and record the " +
    "outcomes.\n" +
    "4. File a short 'what I learned today' note so the morning report can " +
    "surface it. Never invent a lesson you cannot trace to a real decision.",
});
