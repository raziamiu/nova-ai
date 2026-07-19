---
description: Produce the weekly strategy review — progress against goals, wins, problems, and the top strategic moves for next week. Use on the Monday schedule or when the owner asks for a strategy review.
---

# Weekly strategy procedure

1. Gather, in order: `get_business_snapshot`, `get_finance_report`
   (`sinceDays: 30`), `get_campaigns`, `get_activity_report` (`sinceDays: 7`),
   `get_trending_products`, `detect_anomalies`.
2. `recall` namespace `goals` and `experiments` — measure against the actual
   goals, and don't re-propose what already failed.
3. Build the review:

```
# Weekly strategy — week of {date}

**Goal progress**
Current run-rate vs goal (e.g. "$X/mo pace vs $50k goal — Y% there, need +Z%/wk").
Net margin vs the 30% target.

**What worked** (3 max, with numbers)
**What didn't** (honest, with numbers, and what was already done about it)

**Next week's moves** (3 max, ranked by expected impact)
Each: the move → expected impact → what Nova will do vs what needs approval.

**Experiments** — one new test worth running, with success criteria.
```

4. File it with `file_report` (`kind: "weekly_strategy"`).
5. Store each committed move with `remember` (namespace `goals`, key like
   "week-{date}-focus") so daily work aligns with the weekly plan.
