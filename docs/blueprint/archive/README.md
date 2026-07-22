# Archived blueprint v1 docs

These are the unbuilt v1 phase plans (written against the original vision PRD,
`docs/prd/nova-prd.md`) superseded by blueprint v2 (phases 06–15, mapped to the
Master Build PRD's Stages 0–9). Kept for reference — their engineering content was
absorbed, not discarded:

- `06-dashboard-experience.md` → decision/approval endpoint design, stream-reducer and
  session-management salvage → v2 phases 08 and 11. (Its banner references
  "PRD - Nova UI Build.md", which was itself absorbed into
  `docs/prd/PRD - Nova Master Build.md`.)
- `07-trust-safety-scale.md` → guardrails-v2 + policy-seam → v2 phase 07; undo CI
  check → 06; decision expiry → 08; budgets/audit/injection/red-team → 15.
- `08-scale-observability-production.md` → OTel/economics/caching/load/chaos/SLOs/
  rollout → v2 phase 15 (rollout reconciled with the earned-level model).

Do not implement from these documents.
