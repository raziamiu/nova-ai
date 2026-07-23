import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Marketing work: campaign performance (CPA/ROAS) and optimization, pausing bleeders and scaling winners, new campaigns, social content, email/SMS promos, and discounts.",
  model: SUBAGENT_MODEL,
});
