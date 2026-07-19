import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Product research for Aurora Living: scan the trending-products feed, weigh demand vs competition vs margin, import winning products, and keep catalog prices competitive.",
  model: "anthropic/claude-sonnet-5",
});
