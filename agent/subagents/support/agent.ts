import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Customer support: answering FAQs, order tracking, replacements, refund workflows, resolving or escalating tickets — overdue tickets first, always in the brand voice.",
  model: SUBAGENT_MODEL,
});
