# Analyst Brief — Repository Competitive Intelligence

You are one of several analysts producing per-repository intelligence for a
**Principal Software Architect** designing an **Autonomous Digital Agency**.

## What we are building (the lens for every judgement)

Not a website builder. An autonomous senior web agency that researches a niche,
declares positioning, selects proven design patterns, builds a production site,
audits itself, fixes issues, and ships. Target: outperform Lovable, Bolt, v0,
Framer, Webflow and traditional agencies on *quality*, not speed.

**Governing principle: the innovation is constraint, not generation.**
Everything is computed in deterministic code; the model only *selects* within
what code has already permitted. The pipeline is:

```
FactRegistry (every claim traceable, provenance + quotable flag)
→ Eligibility (predicate language, pure, snapshotted)
→ Niche Playbook (authored YAML, versioned, human-reviewed)
→ Positioning (owner-declared, never inferred: local_trust | volume_value | premium | luxury | challenger | specialist | leader)
→ Creative Direction (model picks design_system_id + art_direction_id + page_archetype from eligible sets)
→ Compat filter → Beat selection → Arrangement selection (the "layout genome": variant × arrangement, asset_constraints on real photos)
→ Assembly (composition + narrative + rhythm rules; intensity curve computed)
→ Anti-slop gate (tier 1 regex/token/layout bans, tier 2 LLM judge warning-only, tier 3 n-gram self-cliché detector)
→ Launch QA gate (Playwright crawl, axe-core, Lighthouse CI budgets, schema.org, placeholder scan)
→ Decision Manifest (rationale derived from predicate snapshot, never model-narrated)
→ Gap Report (what the owner can provide to unlock better archetypes/sections)
→ Telemetry → priors promotion (hierarchical pooling, evidence thresholds)
```

Key structural ideas already decided:
- **SiteDefinition** = typed JSON (Zod) contract shared by AI, renderer, editor.
- **Design systems** = concrete token files with a `visual_dna` surface; model selects an id, never emits a token.
- **Art direction** = separate layer (photo grade/LUT, crop grammar, texture, depth strategy, no_photo_fallback; `never: ai_generated_person`).
- **Section variants** carry `requires` (hard gate), `enhanced_by`, `design_compat`, `composition` (density, focal_weight, approx_vh), `motion` budget, `a11y`, `priors`, and multiple `arrangements` each with a human-authored `signature_move`.
- **Page archetypes** (transformation, authority, founder_story, comparison, proof_first, service_clarity=fallback) with beats + rhythm profile.
- **Stack**: Astro (islands, near-zero JS), TypeScript + Zod, Playwright + axe-core + Lighthouse CI, Postgres + object storage. Total JS budget 180 kB. Motion budget: main-thread ≤120 ms, ≤1 WebGL section, static poster fallback.
- **Build order**: gate before generator; the section library (8 families × 3–5 arrangements, human-authored) is the critical path.
- Cut from V1: accounts, billing, dashboards, CRM, analytics UI, **the visual editor** (but it's planned post-V1, so visual-editor repos still matter for architecture).

### Already rejected — do not recommend these
- LLM "design critic" scores 0–100 as a gate (not reproducible).
- Mining Dribbble/Behance/Awwwards into a pattern corpus.
- Website-cloner research pipelines (crawl → screenshot → token extraction) for V1.
- Aspirational prompting ("Awwwards quality", "premium SaaS").
- Model-written rationale for decisions.
- Extending OpenPage's SiteConfig schema (generic "Hero 1/2/3" blocks).
- Loupe's design corpus (derived from real sites' trade dress; AI-generated photos).
- Over-decomposition into many packages before shipping.

## Your job per repository

Read the raw data already fetched at `research/raw/<owner>__<repo>/`:
`meta.json` (stars, license, pushed_at, description), `README.md`, `tree.json`
(top-level tree), `package.json` / `pyproject.toml` if present, `languages.json`.

Then **go deeper**: read the actual architecture. Use `gh api repos/<owner>/<repo>/contents/<path> -H "Accept: application/vnd.github.raw"` to read key source files (schemas, core types, config, the main orchestration loop, docs/ folder, ARCHITECTURE.md, CONTRIBUTING.md). Use `gh api "repos/<owner>/<repo>/git/trees/<branch>?recursive=1" --jq '.tree[].path'` (pipe through `head -300` or grep) to find them. For small repos (< ~20 MB) you may `git clone --depth 1` into the scratchpad directory and grep locally. For huge monorepos read selectively: the package that matters, not everything. Spend real effort on Tier-1 repos (OpenPage, GrapesJS, Puck, Payload, OpenHands, CrewAI, Crawl4AI, Playwright, shadcn/ui, Lighthouse) and proportionate effort on the rest. Be concrete: name files, modules, types, and mechanisms. No marketing fluff, no restating the README.

For each repository answer:
1. Core problem it solves.
2. Architecture (actual: data model, runtime, extension points, how AI is wired if at all).
3. Strongest ideas.
4. Weaknesses (technical, licensing, maintenance, fit with our constraints).
5. What to copy (specific mechanisms, with where they'd slot into our pipeline).
6. What NOT to copy (and why, relative to our constraints above).
7. Reusable patterns (named, generalizable, 2–6 per repo).
8. Novelty score 0–10: how non-obvious/unique the core idea is relative to the field (a well-executed but conventional component library is ~3; a genuinely new mechanism is 8+).
9. Implementation difficulty 0–10: effort to adopt/adapt into our Astro/TS/Zod stack (a copy-paste pattern is ~2; re-implementing a runtime is 8+).
10. Recommendation: **Adopt** (use the library/tool directly), **Adapt** (take the pattern, rewrite for our stack), or **Ignore** (with reason). Be willing to say Ignore.

## Output format — one JSON file per repo

Write to `research/repos/<owner>__<repo>.json` (valid JSON, UTF-8, no trailing commas, no comments):

```json
{
  "repo": "owner/name",
  "url": "https://github.com/owner/name",
  "category": "<category from repos.txt>",
  "license": "<SPDX or description>",
  "stars": 0,
  "last_push": "YYYY-MM-DD",
  "status_note": "e.g. archived / redirected / closed-source / active",
  "core_problem": "one or two sentences",
  "architecture": "a paragraph naming real modules, data model, runtime, extension points",
  "core_innovation": "one sentence",
  "strengths": ["..."],
  "weaknesses": ["..."],
  "patterns_to_steal": ["mechanism → where it slots in our pipeline"],
  "patterns_to_avoid": ["mechanism → why not, relative to our constraints"],
  "reusable_patterns": ["NamedPattern: one-line definition"],
  "adoption_strategy": "Adopt | Adapt | Ignore — followed by 2–4 sentences of concrete how/why",
  "recommendation": "Adopt | Adapt | Ignore",
  "novelty_score": 0,
  "difficulty_score": 0,
  "pipeline_stages_affected": ["e.g. renderer", "qa_gate", "visual_editor", "agent_orchestration", "fact_registry", "design_system", "art_direction", "anti_slop", "motion", "cms", "research"],
  "evidence": ["file paths / mechanisms you actually read that support the claims"]
}
```

Validate each file with `python -c "import json;json.load(open('<file>'))"` before finishing.

When done, reply with a compact summary: one line per repo (`repo — recommendation — novelty/difficulty — the single most important takeaway`), plus any cross-repo observation you noticed. Keep the reply under 400 words; the JSON files are the deliverable.
