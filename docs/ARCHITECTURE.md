# Architecture — Autonomous Digital Agency

**Status:** buildable. Supersedes the implementation portions of
`implementation-strategy.md` and amends `section-metadata-schema.md` v4 where noted in §1.

**Document layering**

| Document | Answers | Authority |
|---|---|---|
| `section-metadata-schema.md` (v4) | *What* the system decides — fact registry, predicates, eligibility, archetypes, layout genome, positioning, anti-slop tiers, manifest | Domain model. Authoritative except §1 amendments below |
| `ARCHITECTURE.md` (this) | *How* it is built — packages, data model, runtime, interfaces, stack | Implementation. Authoritative on all technical decisions |
| `SYNTHESIS.md` + `gate-checklist.md` | *Why* — 65-repo evidence, 125-row check inventory | Evidence. Cite, do not re-derive |
| `AGENT-BUILD-PROMPT.md` | Build instruction for the coding agent | Execution |

---

## 1. Amendments to v4

Seven research findings change the spec. These override v4 where they conflict.

**1.1 — Motion and WebGL (replaces v4 §9 budgets).** The 140 kB WebGL ceiling is
unachievable with three.js: measured tree-shaken floor for one basic mesh is 508 kB min /
123 kB gzip; an r3f island is 309 kB gzip; Spline's runtime is 263 kB gzip. Four tiers
replace `motion_tier`:

```
tier 0  pre-rendered WebM/AV1 + poster, 0 kB JS      DEFAULT for ambient/abstract
tier A  motion/mini + inView, ~10.5 kB gz            reveal, scroll-linked opacity/transform
tier B  GSAP core + ScrollTrigger, 46.5 kB gz        pinning, labelled timelines, SplitText
tier C  OGL or raw shader plane, <= 15 kB gz         max 1 per site, below fold, poster until first frame
```

three.js is a **library-time tool only** — it bakes posters and loops that ship as static
assets. Tier C additionally requires: intersection lazy-mount, `gl.compile` plus one
hidden frame before crossfade, demand-driven frame loop, dpr clamped by token
(1.5 mobile / 2 desktop), quality governor with hysteresis, and poster-only under reduced
motion or low GPU tier.

**1.2 — Reduced motion is a gate assertion and a CSS rule, never a component contract.**
0 of 16 sampled Aceternity components, 5 of 78 MagicUI components, and none of
r3f/drei/three/Spline/Theatre honour `prefers-reduced-motion`. Every design system's
`tokens.css` carries the kill switch independent of JS; a Playwright project with
`reducedMotion: 'reduce'` asserts zero running animations and poster presence.

**1.3 — Section authoring language is `.astro`.** Every open-source visual editor makes
the editor runtime the renderer; `.astro` sections can never render inside a React canvas.
Choosing `.astro` means the post-V1 editor is an **overlay** (iframe + typed postMessage
RPC mapping DOM → JSON pointer → patch), never a second renderer. This decision is binding
before any section is authored.

**1.4 — No CMS in V1.** Payload 3/4 requires a Next/TanStack host, and its Postgres
adapter creates one table per block type, making every library change a migration. Store
`SiteDefinition` as validated JSONB in Postgres via Drizzle. Copy Payload's `_versions`
shadow-table shape so drafts never touch the published row.

**1.5 — No agent framework.** The pipeline is a linear DAG with four constrained model
calls. The useful part of OpenHands/CrewAI/LangGraph/AutoGen is ~800 lines of TypeScript
(event log, status enum, dual budget, guardrail retry, interrupt/resume). Hand-roll for
V1. LangGraph.js is the only TS-native fallback if one is wanted later.

**1.6 — Licence policy.** Code shipped to clients: MIT/Apache/BSD/MPL only. AGPL (coss /
Origin UI), GPL (pennysite), FSL (ai-website-powerhouse), MSCL (Directus) and proprietary
no-redistribution (Aceternity) are **pattern sources, never dependencies**. GSAP's
no-charge Standard License is acceptable for shipped sites; re-read it before building any
visual animation editor, since its one prohibition is a competing no-code animation
builder.

**1.7 — Tier-1 ban corpus is harvested, not invented.** Effect-name and class-fingerprint
bans come from the Aceternity public registry (284 items) and MagicUI (78 items), plus
literal utility-class bans from tutorial builder prompts, plus the motion/3D idiom list in
SYNTHESIS §7.3.

---

## 2. System shape

```
AUTHORED ASSETS (git, versioned, SHA-pinned)
  section library · design systems · art directions · playbooks
  archetypes · positioning · anti-slop rulepack · gate policy · motion registry
        │ loaded + Zod-validated at boot, strict id grammar
        ▼
INTAKE ──▶ PIPELINE RUNNER (checkpointed state machine)
                │                          │
   DETERMINISTIC STAGES (code)      CONSTRAINED MODEL CALLS (4)
   ingest → predicate eval →        creative direction | beat selection
   eligibility → playbook →         arrangement | copy-on-leash
   positioning → compat filter →    (+ tier-2 cliché judge, warning only)
   assemble → populate →            wrapper: parse → coerce → re-ask ≤2 → fallback
   anti-slop 1+3 → SEO/legal
        ▼
SiteDefinition (Zod/JSONB) + DecisionManifest + GapReport
        ▼
RENDERER (Astro) — tokens.css per design system, data-sd-path/data-sd-id stamped
        ▼
LAUNCH QA GATE — ~110 checks, artifact bundle per page, repair loop, done-gate
        ▼
PUBLISH (pinned) ──▶ client surfaces ──▶ telemetry ──▶ priors
```

### Packages

| Package | Owns | Depends on |
|---|---|---|
| `contract` | Zod `SiteDefinition`, `FactRegistry` types, predicate parser + evaluator, per-build JSON Schema generation, migrations, invariant runner | nothing |
| `library` | `.astro` section variants, arrangements, design systems, art directions, playbooks, archetypes, positioning, motion registry, token compiler, manifest schema | `contract` |
| `pipeline` | state machine, stages, model-call wrapper, assembly, anti-slop tiers 1+3, manifest, gap report | `contract`, `library` |
| `gate` | Playwright specs, artifact bundle, check registry, `GateReport`, LHCI config, axe policy, reference renders | `contract` |

Four packages. Split only when a boundary hurts.

---

## 3. Contract

### SiteDefinition

```ts
SiteDefinition = {
  schema_version: number,
  site: { id, niche, positioning, locale },
  pinned: { design_system: "id@ver", art_direction: "id@ver", playbook: "id@ver", library: sha },
  pages: Record<page_id, {
    route,
    archetype,
    seo: { title, description, canonical, og, robots, schema_org[] },
    order: instance_id[],                      // flat, ordered — not a tree
    sections: Record<instance_id, SectionInstance>
  }>,
  assets: Record<asset_id, AssetRef>,
  legal: { ... }
}

SectionInstance = {
  instance_id, family, variant_id, arrangement_id, schema_version,
  slots: Record<slot,
      { kind: "fact",      fact_id }
    | { kind: "generated", text, grounded_in: fact_id[] }
    | { kind: "asset",     asset_id }>,
  motion: MotionProfileRef,
  computed: { intensity, focal_weight, density }   // written by assembly, read by gate
}
```

A page is a flat `Record<instance_id, SectionInstance>` with an ordered `order[]` — not a
nested tree, not a grid. Trees and grids express *position*; they would let the model or
owner produce arrangements nobody authored. Slots are named and typed per variant, never
anonymous children.

`family` is the discriminator of a Zod `discriminatedUnion` and is the **only vocabulary
the model ever sees**.

### Predicate evaluator

Grammar per v4 §2. Implementation requirements:

- Pure, deterministic, no I/O. Missing path → `false`/`0`/empty, never throws.
- Returns a **snapshot**: `{ predicate, actual, result }[]` — this is the sole input to
  the Decision Manifest. No model narrates a decision.
- Parser produces a JSON-serialisable AST; the AST is cached per predicate string.

### Per-build JSON Schema generation

For every model call, generate a **strict JSON Schema whose enums are exactly the eligible
ids**. The model cannot name an ineligible option because the grammar does not contain it.
This is the single most important mechanism in the system; it replaces prompt instruction
with structural impossibility.

### Invariant runner

Path-addressed hooks over `SiteDefinition`, accumulating **all** violations (never
first-fail). Nothing partial enters state.

1. Every `generated` slot's numbers, names, dates and quotations resolve to a
   `quotable: true` fact
2. Every asset `rights != "unknown"`
3. Every portrait `subject_consent == true`
4. Every variant's `requires` satisfied by the predicate snapshot
5. Exactly one art direction per site
6. No cross-tenant ids
7. Every `order[]` entry exists in `sections`, and vice versa

---

## 4. Data model

Relational core, JSONB documents. The Zod contract is the single source from which JSON
Schema, DB column types and TypeScript are derived — code schema prints DB schema, never
the reverse.

```
sites            { site_id, tenant_id, niche, positioning, published_version_id, created_at }
site_versions    { version_id, site_id, parent_version_id, site_definition(jsonb), manifest(jsonb),
                   gap_report(jsonb), gate_report_id, status: draft|published|archived,
                   pinned(jsonb), schema_version, created_by: pipeline|owner_edit|migration, created_at }
facts            { fact_id, site_id, path, value(jsonb), provenance(jsonb), quotable, verification }
fact_sources     { source_id, site_id, url, final_url, status_code, fetched_at, etag, content_hash, citations(jsonb) }
assets           { asset_id, site_id, path, width, height, aspect, rights, subject_consent,
                   tags[], grade_safe, alt, placeholder_data_uri, graded_variants(jsonb) }
runs             { run_id, site_id, version_id, stage, status, checkpoint(jsonb), cost_usd, iterations, seed }
run_events       { event_id, run_id, parent_id, kind, payload(jsonb), ts }
model_calls      { call_id, run_id, stage, provider, model, schema_hash, prompt_hash, output_hash,
                   cost_usd, duration_ms, finish_reason, attempts, guardrail_codes[] }
gate_reports     { report_id, version_id, policy_ver, checks(jsonb[]), summary, created_at }
edit_actions     { action_id, version_id, seq, action(jsonb), inverse(jsonb), txn_id, actor, ts }
telemetry_events { event_id, site_id, version_id, kind, section_instance_id, props(jsonb), ts }
priors           { arrangement_id, stratum(jsonb), status, evidence(jsonb), window, updated_at }
diversity_ledger { window_start, key, value, share }
```

Multi-tenancy: `site_id` on every row, a filter layer on every query, and a write hook
that rejects cross-tenant references.

---

## 5. Runtime

### Run state

```
status ∈ IDLE | RUNNING | WAITING_FOR_OWNER | WAITING_FOR_REVIEW
       | FINISHED | ERROR | STUCK | BUDGET_EXCEEDED
```

Append-only event log with `parent_id`: `StageStarted`, `StageCompleted`,
`ModelCallRequested{schema_hash}`, `ModelCallReturned{cost, finish_reason}`,
`GuardrailFailed{code, attempt}`, `SubstitutionApplied{from, to, reason}`,
`GateRan{report_hash}`, `OwnerInterrupted{question}`, `OwnerResumed{answer}`,
`LimitReached{kind}`.

### Stages

Each is a pure `(state) => state` except the four model nodes.

```
1  ingest                2  evaluate_predicates    3  playbook
4  positioning  ← INTERRUPT if undeclared; resumes on the same run id
5  creative_direction (model)                      6  compat_filter
7  beat_selection (model, fan-out per beat)        8  arrangement (model, fan-out)
9  assemble               10 populate (model, fan-out per slot group)
11 anti_slop              12 render                13 gate
14 manifest               15 gap_report            16 publish ← CONFIRM-GATED
```

### Model-call wrapper

One implementation, used by every model node.

```
input:  eligible set E, layered prompt fragments (base → niche → archetype → positioning), seed
schema: strict JSON Schema from E — enums are exactly the eligible ids
memo:   key = hash(E, prompt fragments, seed, options); model id EXCLUDED
loop:   safeParse → coerce toward E (record every coercion)
        → re-ask with violation codes (max 2) → deterministic fallback
stuck:  same rejected id proposed twice → terminate call, substitute
limits: per-run max model calls AND max USD → BUDGET_EXCEEDED
audit:  one model_calls row per call
```

`finish_reason == "length"` is a hard failure. Never a partial accept.

### Compat filter retreat order

On an empty candidate set for a beat, relax in this order and no other:

```
design_compat → art_direction preference → positioning preference → sibling archetype
```

**`requires` and honesty constraints are never relaxed.** This is the invariant that
carries the entire grounding guarantee; it is also the one most likely to come under
deadline pressure. Unit-test it.

### Human-in-the-loop points (typed, non-bypassable)

| Point | Actor |
|---|---|
| Positioning undeclared | Owner |
| Blocking Gap Report entries | Owner |
| `needs_review` gate rows | Reviewer |
| Publish | Owner or agency |
| Any `/_proposed/` asset landing | Agency |

The model has no tool that can publish, change positioning, or land an asset.

---

## 6. Renderer

Astro, static output, islands only where a state machine is genuinely required.

- Every section root and editable field carries `data-sd-path` (JSON pointer) and
  `data-sd-id` (stable instance id). The gate, the repair loop, telemetry and the post-V1
  editor all address the same ids.
- `tokens.css` per design system, compiled from DTCG-shaped YAML at build time. Zero
  runtime token resolution.
- Interaction state is expressed as `data-*` attributes, never class names, so static CSS
  styles state and Playwright asserts it.

### Islands policy, in order of preference

1. **Native elements.** `<details name>` for FAQ (0 kB) beats a Radix accordion island
   (~53 kB gzip). Scroll-snap carousel with JS only for indicators and `aria-live`.
2. **`@zag-js/<machine>` + `@zag-js/vanilla`** hydrating SSR'd markup (10–17 kB gzip each)
   where a state machine is needed. **Never `@ark-ui/react`** (290 kB gzip, 69 deps).
3. **react-aria hooks** only inside a React island that genuinely needs dialogs/menus.

The `data-pressed / hovered / focus-visible / disabled` attribute contract is required
site-wide regardless of which tier is used.

---

## 7. Gate

Source of truth is `gate-checklist.md` — 125 rows, ~110 distinct ids, ~85 deterministic on
a static build, ~40 written by us. None of Lighthouse, axe, pa11y or Unlighthouse asserts
link status, canonical uniqueness, duplicate titles, schema.org validity, form
end-to-end, reduced-motion behaviour, LCP element identity, per-page JS budget, or
art-direction grade coverage.

```
1  BUILD CHECKS (no browser)   invariant runner · JS budget from build manifest · allowlists
                               duplicate titles · canonical uniqueness · sitemap/robots/llms.txt
                               schema.org validation · placeholder scan
                               routes come from SiteDefinition — no crawl needed
2  ARTIFACT BUNDLE per page    Playwright projects: desktop-chrome, mobile-safari, tablet,
   (gather once, check many)   reduced-motion, dark; captured after document.fonts.ready
                               DOM · ARIA snapshot · axe JSON (full tags) · console/pageerror
                               network log · stabilised screenshots · form-submit trace
                               tab-order walk · focus-visible captures
3  CHECKS = pure fns(bundle)   { id, title, failureTitle, requiredArtifacts, scoreDisplayMode }
                               status ∈ binary | numeric | manual | informative | notApplicable
                                      | error | needs_review
                               severity critical/serious/moderate/minor → weight 10/7/3/1
4  VISUAL                      toHaveScreenshot vs library-time reference render
                               keyed (arrangement, design_system, project)
                               toMatchAriaSnapshot vs the variant's authored partial
5  PERF (only flaky stage)     LHCI resource-summary assertions HARD
                               LCP/TBT/CLS median of 3 serial runs on one representative
                               per archetype × arrangement group
6  REPORT                      GateReport rows; null on any errored weighted check ⇒ fail closed
7  REPAIR LOOP                 substitute from eligible[] → regenerate copy → fail
                               re-render only pages whose HTML hash changed
                               after every substitution assert presence by data-sd-id
                               same substitution twice → stop
8  DONE GATE                   publish refused unless current SiteDefinition hash
                               == the hash the green report was produced for
9  HUMAN                       needs_review + manual rows recorded with reviewer id
```

Budgets gate on **deterministic resource summaries, not the performance score**:
`resource-summary:script:size ≤ 184320`, fonts ≤ 2 files / 200 kB, third-party requests
≤ 2, `unsized-images` = 0, `render-blocking` = 0, `non-composited-animations` = 0 (this
last one enforces the motion budget mechanically).

Adopt directly: Playwright, `@axe-core/playwright`, Lighthouse + `@lhci/cli`. Ignore pa11y
(redundant, LGPL, Puppeteer). Adapt Unlighthouse's scheduling, not its budget.

---

## 8. Anti-slop

v4's three tiers stand; the research adds tier 0 and hardens tier 1.

**Tier 0 — library entry (human, once).** `signature_move` and `negative_example`
required; rubric at both content extremes; ≥2 reviewers; ELO within family; family minimum
arrangements. *Nothing downstream can add quality; it can only remove failure.*

**Tier 1 — deterministic, blocking.** Harvested corpora (§1.7) plus mechanical checks no
prompt can defeat:

- `PaletteConsistencyCheck` — only the selected design system's token values may appear in
  rendered CSS; zero foreign hex
- `ImportHostAllowlist` — any `<script src>`, `<link href>`, `url()` or import outside the
  pinned allowlist fails the build
- `ungraded_asset` — rendered image hash ∉ graded set
- reduced-motion assertion — `reducedMotion: 'reduce'` project finds zero running animations
- per-effect byte ceiling — each pattern id's measured gz bytes ≤ declared
- structural DOM rules as axe-style `{selector, matches, any/all/none}`: icon-card triplet,
  centred twin-CTA hero without media, emoji bullets, three consecutive same-density
  sections, no focal moment, no signature section

Rule pack is versioned with fatal/warning classes; `canShip = !hasFatal`.

**Tier 2 — semantic cliché judge.** Warning only, generated copy only, writes to
`/_proposed/anti-slop-bans.jsonl`, human promotion to tier 1.

**Tier 3 — self-cliché detector.** Blocking, no model. N-gram frequency plus a DOM
fingerprint per page (`section_sequence_hash`, per-section text hash) across the last 100
builds: a sequence >6% or a hero text shape >15% is flagged.

---

## 9. Build order

| Phase | Deliverable | Definition of done (machine-checkable) |
|---|---|---|
| **P0** | Repo, CI, `verify` script | `pnpm verify` exits 0 on empty repo |
| **P1** | `contract` | Predicate grammar 100% branch-covered; golden fixtures round-trip; invariant runner accumulates all violations; JSON Schema generation produces enums == eligible ids |
| **P2** | `gate` | Runs against two committed fixture sites (one deliberately broken), emits expected pass/fail rows for every check id in `gate-checklist.md` marked `D` |
| **P3** | `library` **infrastructure** (not content) | Token compiler emits `tokens.css` from one reference DTCG file with WCAG ≥ 4.5 assertion; manifest schema + ts-morph import check green in CI; reference-render harness; grading CLI; motion registry with byte ceilings |
| **P4** | `pipeline` | All 16 stages; model calls stubbed deterministically in tests; retreat order unit-tested; budget guard trips; interrupt/resume round-trips on the same run id |
| **P5** | Renderer + scaffold sections | Astro build emits `data-sd-path` on every section; `service_clarity` fallback sections render; JS ≤ 180 kB on fixture |
| **P6** | End-to-end | One committed fixture business → green gate → manifest + gap report emitted |
| **P7** | **Section library — human** | 8 families × 3–5 arrangements, tier-0 gate passed |

**P0–P6 are autonomous.** P7 is not, and this is not a scheduling detail — it is the
conclusion of the research (SYNTHESIS §11: *"Tier 0 is the whole game"*).

---

## 10. The human boundary

Autonomous agents may build anything whose correctness is machine-checkable. They may not
author or grade the library.

| Agent may | Agent may not |
|---|---|
| All of `contract`, `gate`, `pipeline`, renderer plumbing | Author graded `.astro` section variants |
| Token compiler, manifest tooling, reference-render harness, grading CLI | Write `signature_move` or `negative_example` |
| `service_clarity` scaffold sections, marked `status: scaffold, grade: ungraded` | Set `grade.rubric` values or ELO |
| Harvest ban corpora into the rulepack | Land anything from `/_proposed/` |
| Propose playbook or ban diffs to `/_proposed/` | Choose positioning, or publish |
| Fixtures, migrations, CI, docs | Add a dependency outside the licence policy (§1.6) |

Scaffold sections are excluded from the eligible set for any real client build until
human-graded. They exist so the pipeline is end-to-end testable without polluting the
library.

---

## 11. Open decisions

Genuinely unresolved. Do not let an agent settle these silently.

1. **V1 niche.** Asset availability beats domain knowledge. Law is proof-poor
   (confidentiality, bar advertising rules) so the demo renders mostly fallbacks; a
   visual-outcome trade unlocks `transformation` and the full rhythm curve. Pick where
   real facts and real photos exist this month.
2. **Model provider and routing** per call type, and the per-run USD ceiling.
3. **Hosting target** for generated sites (Cloudflare Pages assumed, not decided).
4. **Whether tier C WebGL ships in V1 at all.** Tier 0 pre-rendered loops may cover every
   V1 arrangement, which would remove a whole class of gate flakiness.
