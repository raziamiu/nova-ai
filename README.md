# nova-ai

**Nova — the AI Business Operator for Dakio commerce** — built as an
[eve](https://github.com/vercel/eve) agent.

Nova is a proactive digital employee for an e-commerce store: it observes the
business, takes autonomy-gated actions across ten departments (marketing, sales,
support, inventory, finance, …), explains every decision, and files reports to the
founder's dashboard. Phase 01 (foundation agent core, demo store) is implemented in
`agent/`.

## Getting started

Requires Node 24 and a model key (`AI_GATEWAY_API_KEY` in `.env.local`) for live runs.

```bash
npm install
npm exec -- eve dev      # chat with Nova against the seeded demo store
npm exec -- eve eval     # run the behavior evals (needs the model key)
```

Try: *"Good morning — how's the business doing?"*, *"Recover our abandoned carts."*,
*"What's waiting for my approval?"* — the demo store ("Aurora Living") boots with a
scale-ready campaign, a bleeding campaign, 14 abandoned carts, two stockout risks,
and two prepared actions already awaiting approval.

## Engineering blueprint

The full phased technical plan (architecture, multi-tenancy, memory, proactive
operations, trust & safety, production rollout) lives in
**[`docs/blueprint/`](./docs/blueprint/README.md)** — start with
`00-master-architecture.md`.

## Layout

- `agent/` — the Nova agent (instructions, tools, subagents, skills, schedules, lib)
- `agent/lib/store/client.ts` — the `StoreClient` boundary (demo backend today; the
  Dakio Express API implements the same interface in Phase 02)
- `docs/blueprint/` — the master engineering blueprint (phases 00–08)

See `AGENTS.md` and the docs bundled in `node_modules/eve/docs/` for eve framework
reference.
