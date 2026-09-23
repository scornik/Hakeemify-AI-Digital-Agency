# Research package — Autonomous Digital Agency competitive intelligence

Generated 2026-09-23 from live GitHub data (`gh api`) and source reads.

Start here:

1. **[SYNTHESIS.md](SYNTHESIS.md)** — the report: recurring patterns, missing opportunities,
   best architecture per concern, unified system / agent / data model / design genome /
   anti-slop / explainable design / QA loop / moat, and the 14 decisions this research forces.
2. **[REPO-MATRIX.md](REPO-MATRIX.md)** — 65 repos, one line each: recommendation, novelty, difficulty.
3. **[repos/](repos/)** — one JSON per repository in the requested schema (plus `core_problem`,
   `architecture`, `reusable_patterns`, `recommendation`, `pipeline_stages_affected`, `evidence`).
   Aggregate: [repo-analysis.json](repo-analysis.json).
4. **[notes/gate-checklist.md](notes/gate-checklist.md)** — 125-row Launch QA gate inventory
   (Lighthouse / axe / LHCI / Unlighthouse / pa11y / our own), with determinism and policy per check.

Tooling: `fetch.sh` (raw fetch), `aggregate.py` (rebuild aggregate + matrix), `ANALYST-BRIEF.md`
(the brief every analysis was written against), `repos.txt` (the corrected repo list),
`raw/<owner>__<repo>/` (metadata, README, tree, manifests as fetched).
