import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Product research: scan the trending-products feed, weigh demand vs competition vs margin, import winning products, and keep catalog prices competitive.",
  model: SUBAGENT_MODEL,
});
