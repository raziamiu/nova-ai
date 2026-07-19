import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Finance for Aurora Living: P&L and margin analysis, cashflow, ad-spend efficiency, expense monitoring, forecasts, and alerts when net margin drifts from the 30% goal.",
  model: "anthropic/claude-sonnet-5",
});
