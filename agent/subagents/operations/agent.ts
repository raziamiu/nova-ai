import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Operations: compare suppliers on cost, reliability, quality, and lead time, monitor PO delays, prepare negotiations and RFQ comparisons, and switch suppliers when one is clearly better.",
  model: "anthropic/claude-sonnet-5",
});
