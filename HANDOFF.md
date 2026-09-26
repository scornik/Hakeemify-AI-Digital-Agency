# Handoff — P7, the section library

P0 through P6 are complete. `pnpm verify` is green and `pnpm e2e:fixture` builds one business
from its fact registry through all sixteen stages to a green gate — the static pass on every
page, the browser pass across the five-project matrix, and the resource budgets on the median of
three Lighthouse runs — emitting `build-rationale.json` and `gap-report.json`.

What is not done is the part that cannot be automated, and this document is about that.

> A constraint system prevents bad design; it does not produce great design. Great design enters
> exactly once, when a human authors a variant. — v4 §11

Everything built so far can only *remove failure*. Nothing in it can add quality. The machine
now refuses ungrounded claims, ungraded photos, missing alt text, over-budget JavaScript, broken
links, stale copyright, duplicate titles, banned phrases, house clichés and pages with no
rhythm — and it will happily let you ship five correct, characterless sections. The library is
what makes the output worth buying.

---

## 1. What a human must author

Eight families × 3–5 arrangements. The numbers below are enforced by the manifest schema's entry
gate (`packages/library/src/manifest/family-standards.ts`), transcribed from v4 §11 — a manifest
that does not meet them fails to load, with the reason named.

| Family | Min arrangements | Reviewers | Extra rubric (all must be true, at both content extremes) |
| --- | --- | --- | --- |
| `hero` | **5** | 2 | `works_with_4_word_headline`, `works_with_12_word_headline`, `works_with_no_photo`, `mobile_cta_visible_without_scroll`, `lcp_element_is_text_or_preloaded_image`, `holds_up_at_intensity_1.0` |
| `proof` | **4** | 2 | `degrades_to_fewer_items`, `no_implied_claim_without_fact` |
| `cta` | 3 | 2 | `label_is_specific_not_generic`, `works_under_every_positioning_register` |
| `problem`, `services`, `process`, `faq`, `team`, `footer` | 3 | 2 | — |

The hero additionally carries an ELO floor at the 75th percentile **within its own family**, and
first call on the diversity budget. Nothing in P0–P6 computes an ELO; pairwise comparison is a
P7 activity and the field is recorded, not derived.

The base rubric, required on every graded arrangement regardless of family, is the nine keys in
`RUBRIC_KEYS`: single dominant focal element, type scale respected, consistent optical alignment,
whitespace rhythm consistent, survives long content, survives sparse content, readable at 360px,
focus states visible, grade survives art directions.

**Two library-wide invariants to check as you go**, because they fail silently and are expensive
to discover late:

1. Every family needs at least one `fallback: true` variant with `requires: []`.
2. Every archetype's beats must be fillable by fallback sections alone, *and* that fallback-only
   sequence must satisfy the archetype's own rhythm profile.

---

## 2. Where things go, and what the fields mean

A section is a directory containing a manifest and the component beside it. The component must
live next to its manifest: the drift check resolves `files[]` relative to the manifest directory,
so a component anywhere else is a component nothing validates.

```
packages/library/assets/sections/<family>/<variant>/
  manifest.yml          # the contract — schema in src/manifest/schema.ts
  <variant>.astro       # the component
  lib/*.ts              # optional helpers, each declared in files[]
```

Read `packages/library/assets/sections/hero/service_statement/` as the shape to copy. It is a
**scaffold**, so it deliberately has no `signature_move`, no grade and no authoring record — the
three things you are adding.

### The fields that matter most

| Field | What it is |
| --- | --- |
| `name` | `family/variant`, lower_snake_case both halves. This is the id the model selects and the renderer resolves. |
| `status` | `active` once graded. `scaffold` is excluded from every non-fixture build. |
| `requires[]` | **Hard gate.** Predicate strings, parsed at load. Never relaxed by anything, ever. |
| `serves_beats[]` / `serves_rhythm_roles[]` | Which beat this can fill, and at what intensity role. |
| `design_compat` | Which design systems, art directions, composition families and energy range. Relaxed first by the retreat ladder. |
| `composition` | `density`, `background_weight`, `focal_weight`, `approx_vh`, `media_dependency`, `text_volume`. Feeds the computed intensity; nothing here is decorative. |
| `motion` | An effect id from the motion registry, plus tier and density. `tier_0` ships no JavaScript. |
| `slots[]` | Each slot binds to a fact query, an asset, or generated copy with a `grounded_in` list. |
| `arrangements[].signature_move` | **One deliberate, non-obvious compositional decision, in one sentence.** If you cannot name one, the variant is the average of its category, which is the definition of slop. Leaving it empty is the rejection signal and costs nothing to run. |
| `arrangements[].asset_constraints` | Aspect and width bounds. This is what stops arrangements being cosmetic: the one that runs is the one the business's actual photo can carry. |
| `authoring` | `negative_example` (a screenshot and why it was rejected), author, date, `reviewed_by[]`. |

### The commands

```bash
pnpm install
pnpm verify                 # licences, format, lint, typecheck, 519 tests
pnpm build:fixture          # compile tokens, render the fixture site, emit the build manifest
pnpm e2e:fixture            # the whole pipeline, end to end, all three gate passes
pnpm library:grade          # record a human grade — refuses to run without a TTY
pnpm --filter @ada/library test
```

`pnpm library:grade` will not invent a rubric value, suggest one, or run in CI. It exits 2 with a
named reason when there is no terminal. That is deliberate and should stay that way.

---

## 3. The shortest path from one authored arrangement to a green client build

Roughly a day's work for the first one, then faster.

1. **Pick the niche first.** It decides which photos and facts you need, and it is
   `[P6] V1 niche` in `BLOCKED.md`. Asset availability is the bottleneck.
2. **Author one design system** beside `assets/design-systems/reference-v1.yml`. Set `status:
   active` (the reference one is `status: reference` and is not selectable). The compiler will
   fail the build on any foreground/background pair below 4.5:1, in every condition, including
   dark — so check contrast as you choose, not afterwards.
3. **Author one art direction** with a real grade, crop grammar and `no_photo_fallback`. Its
   `requires` gate how many gradeable photos it needs.
4. **Author the `service_clarity` beats first** — hero, services, proof, faq, cta — because that
   archetype has `requires: []` and is the mandatory fallback. Five variants at the family
   minimums is 5 + 3 + 4 + 3 + 3 = 18 arrangements.
5. **Grade them** with `pnpm library:grade`, two reviewers, rubric true at both content extremes.
6. **Flip `status: scaffold` → `active`.** The moment one authored section is placed,
   `no_signature_section` becomes blocking again (see §4), which is the system asking for the
   moment you have just authored.
7. **Author a real niche playbook** at `assets/playbooks/<niche>.yml`, and the positioning and
   archetype files, moving them out of `packages/pipeline/src/e2e/fixture-assets.ts`.
8. **Delete the scaffolds.** They exist only so the pipeline was testable before you arrived.

A client build differs from the fixture build in exactly one flag: `allowScaffold` is false, which
is also the default. If the library is empty, a client build finds nothing eligible and stops —
correctly.

---

## 4. What is stubbed, scaffolded or faked, and where

Nothing below is hidden in the code; each has a comment at the site and an entry in `PROGRESS.md`.

| Thing | Where | Status |
| --- | --- | --- |
| **Section library** | `packages/library/assets/sections/` | Five `service_clarity` **scaffolds**, `status: scaffold`, `grade: ungraded`, no signature move. Excluded from every non-fixture build. |
| **Design system** | `assets/design-systems/reference-v1.yml` | One, `status: reference` — compiler input, not selectable. |
| **Archetypes, positioning, playbook** | `packages/pipeline/src/e2e/fixture-assets.ts` | Fixture data transcribed from v4 §5–§7, deliberately outside the library's `assets/` tree. |
| **Model provider** | `packages/pipeline/src/model/fake.ts` | Every test and the e2e use a deterministic fake. **No real provider has ever been called by this code.** |
| **Copy generation** | `packages/pipeline/src/build.ts` (`SlotPlanner`) | Stage 10 takes copy from a planner the caller supplies. The fixture writes its own strings, held to the same `grounded_in` leash. The model call is not wired. |
| **Anti-slop tier 2** | `packages/pipeline/src/antislop/tier2.ts` | **Built, warning only.** `tier2Blocks()` returns false unconditionally. Writes proposals to `/_proposed/anti-slop-bans.jsonl`; there is no code path from the queue back to `BANNED_COPY` — promotion is a human editing `tier1.ts`. Not wired into `build.ts`: it needs a provider. |
| **Browser half of the gate** | `packages/gate/src/browser-pass.ts` | **Wired in and green** across the five-project matrix. |
| **Resource budgets** | `packages/gate/src/lighthouse-pass.ts` | **Wired in and green.** Lighthouse's Node API, three runs, the median asserted against the same `LHCI_ASSERTIONS` in `policy.ts`. An error-level budget that produced no value is fatal, not a pass. |
| **Reduced-motion assertion** | `packages/gate/src/browser-pass.ts` | **Done.** The `reduced-motion` project counts running animations in a real browser and asserts zero. |
| **Reference renders** | `packages/library/src/references/` | Addressing, storage contract and resolver are done. No render has been produced — that needs authored arrangements. |
| **Telemetry, priors, diversity ledger** | — | Event contract designed in v4 §10/§18; not implemented. Nothing depends on them yet. |
| **Postgres** | `packages/db/`, `packages/pipeline/src/postgres-store.ts` | **Connected.** `DATABASE_URL=… pnpm e2e:fixture` applies the migration, persists the site, version, run, both logs and the gate report, then reads them back. Idempotent: CI runs it twice. Without `DATABASE_URL` the run reports `not persisted` rather than staying silent. The path is covered on every `pnpm verify` by Postgres-in-WASM, so it does not rot from being optional. Regenerate the migration with `pnpm --filter @ada/db run db:generate`; there is still no automatic drift check. |
| **Visual editor** | — | Post-V1 by design. The renderer stamps `data-sd-path` and `data-sd-id` on every section and field so it stays possible. |

---

## 5. Decisions you must make, grouped by what they block

Full context in `BLOCKED.md`. None of them halted P0–P6, because all four are decisions about a
real client build and everything so far is exercised by a fixture.

**Blocks the first real playbook, and therefore the first client build**
- `[P6] V1 niche`. Placeholder: `roofing`, as fixture data only.

**Blocks any build that is not a fixture**
- `[P4] Model provider, routing per call type, and the per-run USD ceiling`. Placeholder:
  24 calls / $2, chosen to make tests deterministic, not costed.

**Blocks the launch stage and the gate's transport rows (checklist 79–80)**
- `[P5] Hosting target`. Output is host-agnostic static; transport checks are `notApplicable`
  locally.

**Blocks the first arrangement that wants a live shader**
- `[P5] Whether tier C WebGL ships in V1 at all`. Every scaffold is `tier_0`; nothing has
  exercised tier C.

---

## 6. Three decisions in the code worth knowing before you change anything

**`no_signature_section` is scoped, and the scoping is load-bearing.** A signature section is
`focal_weight == 3` **and** an arrangement naming a `signature_move`. Only a human writes one, so
a page of scaffolds cannot satisfy the rule however it is composed. The exemption is keyed on
`isScaffoldOnly(sections)` — every section being a scaffold — not on "is this a fixture build",
so it self-limits the moment you author anything. If you find yourself widening it, the thing to
widen is the library.

**The retreat ladder has no step for `requires`.** `design_compat → art direction → positioning →
sibling archetype`, and then failure. This is enforced structurally: `compatFilter` receives the
already-eligible set, so it cannot re-admit a variant whose `requires` failed, because it never
sees one. `retreatOrder()` exports the ladder as data and a test asserts it contains no step for
`requires`. If that ever inverts, the entire grounding guarantee goes with it.

**The manifest contains no free text.** Every client-readable sentence is a template over a
recorded value, and a test re-derives each one from the predicate snapshot. A model may write a
one-line summary *from* a finished manifest, clearly marked non-authoritative. It may never be the
source of a reason.

---

## 7. Where to read

- `PROGRESS.md` — every milestone, its DoD command, and the decisions behind it. The
  **Decisions** subsections are the useful part; each explains something non-obvious or somewhere
  the spec was silent and had to be read a particular way.
- `BLOCKED.md` — the four open decisions.
- `docs/EXTENDING.md` — how to add a model provider, wire a model call, author a section, and
  review the Bangladesh claim pack. Start here for any of those four.
- `docs/ARCHITECTURE.md` — authoritative on technical decisions.
- `docs/section-metadata-schema.md` — the domain model (v4).
- `docs/gate-checklist.md` — 125 rows; `packages/gate/src/checks/` cites row numbers.
- `docs/SYNTHESIS.md` — the 65-repository evidence behind the architecture.
