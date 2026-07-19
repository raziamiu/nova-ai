import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Supplier management: compare suppliers on cost, reliability, quality, and lead time, monitor PO delays, prepare negotiations, and switch suppliers when one is clearly better.",
  model: "anthropic/claude-sonnet-5",
});
