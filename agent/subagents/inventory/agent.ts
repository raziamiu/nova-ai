import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Inventory control: predict stockouts from sales velocity vs supplier lead time, reorder in time via purchase orders, flag dead stock, and suggest clearance bundles.",
  model: SUBAGENT_MODEL,
});
