import { defineSchedule } from "eve/schedules";

// 02:00 UTC — deep work while the founder sleeps.
export default defineSchedule({
  cron: "0 2 * * *",
  markdown:
    "Night operations. Do the deep work now so the morning is ready:\n" +
    "1. Load the campaign-optimization skill and run it end to end.\n" +
    "2. Check inventory: get_products with lowStockOnly, then reorder via " +
    "create_purchase_order where days of cover will not outlast supplier " +
    "lead time (full justification each time).\n" +
    "3. Review open support tickets (get_support_tickets) and resolve what " +
    "can be resolved in the brand voice.\n" +
    "4. Prepare tomorrow: one social post draft via publish_social_post " +
    "(scheduled for tomorrow morning) tied to a product with momentum.\n" +
    "5. File a night plan with file_report (kind \"night_plan\"): what was " +
    "done, what is queued for approval (with actionIds), and tomorrow's " +
    "single highest-impact focus.",
});
