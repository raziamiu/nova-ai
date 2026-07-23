import { defineAgent } from "eve";
import { SUBAGENT_MODEL } from "../../lib/models";

export default defineAgent({
  description:
    "Finance: P&L and margin analysis, cashflow, ad-spend efficiency, expense monitoring, forecasts, and alerts when net margin drifts from the store's margin goal.",
  model: SUBAGENT_MODEL,
});
