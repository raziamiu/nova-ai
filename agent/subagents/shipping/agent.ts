import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Shipping: pick the best courier per region, watch on-time and RTO rates, cut delivery costs, predict delays, and reassign at-risk orders.",
  model: "anthropic/claude-sonnet-5",
});
