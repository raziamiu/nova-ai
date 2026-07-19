import { defineSchedule } from "eve/schedules";

// Every 4 hours — abandoned carts go stale fast.
export default defineSchedule({
  cron: "0 */4 * * *",
  markdown:
    "Abandoned cart sweep. Load the cart-recovery skill and follow it: find " +
    "untouched carts, write personalized recovery messages in the brand " +
    "voice, send them via send_customer_message (autonomy-gated), and finish " +
    "with one consolidated summary of carts contacted, value at stake, and " +
    "expected recoveries.",
});
