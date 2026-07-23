import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Growth strategy: new channels, product and bundle opportunities, influencer/affiliate ideas, and pricing experiments — framed as testable experiments with expected impact.",
  model: SUBAGENT_MODEL,
});
