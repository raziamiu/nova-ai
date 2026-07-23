import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Shipping: pick the best courier per region, watch on-time and RTO rates, cut delivery costs, predict delays, and reassign at-risk orders.",
  model: SUBAGENT_MODEL,
});
