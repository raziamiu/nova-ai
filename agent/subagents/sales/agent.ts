import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Sales work: replying to customers about purchases, negotiation and objection handling, targeted discounts, upsells/cross-sells/bundles, and abandoned-cart recovery.",
  model: SUBAGENT_MODEL,
});
