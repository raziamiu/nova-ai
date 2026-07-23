import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Operations: compare suppliers on cost, reliability, quality, and lead time, monitor PO delays, prepare negotiations and RFQ comparisons, and switch suppliers when one is clearly better.",
  model: SUBAGENT_MODEL,
});
