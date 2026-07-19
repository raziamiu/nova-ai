---
description: Compile and file the founder's morning report — overnight work, business pulse, top priorities, and today's opportunities. Use every morning or whenever the owner asks "what happened while I was away".
---

# Morning report procedure

Work in this order; every number must come from a tool result.

1. `get_business_snapshot` — revenue/orders/profit pulse and deltas.
2. `get_activity_report` with `sinceDays: 1` — what Nova completed overnight.
3. `detect_anomalies` — anything urgent or newly emerging.
4. `get_abandoned_carts` — current recoverable value.
5. `list_actions` with `status: "prepared"` — decisions waiting on the owner.

Then compose the report and file it with `file_report` (`kind: "morning"`,
title like "Morning report — {date}"). Structure:

```
Good morning. While you were away…

**The numbers**
Revenue yesterday $X (±Y% vs 7-day average) · N orders · profit estimate $Z

**Work completed overnight** (from the activity log — only real entries)
- …

**Needs your decision** (prepared actions, each with expected impact + actionId)
- …

**Watchlist** (anomalies worth knowing, one line each)
- …

**Today's focus**
The single highest-impact move, with the expected outcome if approved.
```

Rules:

- Maximum 3 items under "Today's focus"-level priority; consolidate the rest.
- Every prepared action line ends with its actionId so approval is one word.
- If the night was quiet, say so in one line — never pad.
- After filing, reply to the owner (if in conversation) with the report body,
  not a description of it.
