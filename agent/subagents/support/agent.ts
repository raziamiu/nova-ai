import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Customer support for Aurora Living: answering FAQs, order tracking, replacements, refund workflows, resolving or escalating tickets — overdue tickets first, always in the brand voice.",
  model: "anthropic/claude-sonnet-5",
});
