---
description: Review all ad campaigns, pause bleeders, scale winners, and rebalance budgets within guardrails. Use during night operations or when the owner asks about ad performance.
---

# Campaign optimization procedure

1. `get_campaigns` — metrics come precomputed (spend7d, roas7d, cpa3d vs
   cpaPrior7d, cpaTrendPct).
2. Classify every **active** campaign:
   - **Bleeder**: zero conversions on meaningful 3-day spend, or ROAS < 1 on
     7-day spend > $100, or CPA trend ≥ +30%.
   - **Winner**: ROAS ≥ 3 with stable/improving CPA.
   - **Healthy**: everything else — leave alone.
3. Act, one action per campaign, each with a full justification:
   - Bleeders → `update_campaign` to pause. Cite the exact numbers
     ("CPA rose 43% over 3 days, $11.20 → $16.00").
   - Winners → `update_campaign` raising dailyBudget in steps of 20–40%,
     never past the budget-change guardrail. State the expected extra daily
     profit at current ROAS.
   - A paused campaign whose problem was seasonal/creative may be flagged for
     new creative instead — note it for the marketing department.
4. Respect autonomy statuses: report `prepared` actions as awaiting approval
   with their actionIds; never present them as done.
5. Record a durable lesson with `remember` (namespace `experiments`) when a
   campaign's outcome proves or disproves a hypothesis (e.g. "TikTok test:
   home decor CPA 2.4× Meta's — channel not viable at current AOV").
6. Summarize in one block: paused (with savings/day), scaled (with expected
   lift), left alone, and total daily budget before/after.
