import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Courier management: pick the best courier per region, watch on-time and RTO rates, cut shipping costs, predict delays, and reassign at-risk orders.",
  model: "anthropic/claude-sonnet-5",
});
