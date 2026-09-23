# Progress

Running log of milestones, their definition of done, and decisions taken. Authority for
*what* is being built: `docs/section-metadata-schema.md` (v4). Authority for *how*:
`docs/ARCHITECTURE.md`.

| Phase | Status | DoD command |
| --- | --- | --- |
| P0 Scaffold | ✅ done | `pnpm verify` |
| P1 `contract` | ✅ done | `pnpm --filter @ada/contract test` |
| P2 `gate` | ⏳ not started | `pnpm --filter @ada/gate test` |
| P3 `library` infra | ✅ done | `pnpm --filter @ada/library test` |
| P4 `pipeline` | ⏳ not started | `pnpm --filter @ada/pipeline test` |
| P5 Renderer + scaffold sections | ⏳ not started | `pnpm --filter @ada/library build:fixture` |
| P6 End to end | ⏳ not started | `pnpm e2e:fixture` |
| P7 Section library | 🚫 human only | — |

---

## P0 — Scaffold

**DoD:** `pnpm verify` exits 0. ✅

`verify` = `check:licences → format:check → lint → typecheck → test`.

### Decisions

**Dependency versions are the current published ones, not the ones the spec-era docs imply.**
At build time the registry offers TypeScript 7.0.2, ESLint 10.11.0 and Vitest 5.0.1. Pinned
TypeScript 6.0.3 rather than 7.x because `typescript-eslint@8.70.1` does not yet declare
support for the 7.x compiler rewrite, and a lint stack that silently degrades is worse than a
minor version behind. Everything else is on latest stable.

**`pnpm verify` runs `check:licences` first.** `pnpm licences` collides with pnpm's own
`licenses` subcommand (pnpm normalises the British spelling), hence the `check:` prefix.

**Licence gate is mechanical, and splits shipped from toolchain.** ARCHITECTURE §1.6 scopes
the strict MIT/Apache/BSD/MPL list to "dependencies shipped to clients". `scripts/check-licences.mjs`
therefore computes the transitive production closure of `licence-policy.json:shippedRoots`
(currently `@ada/library`, the only package whose code reaches a client's site) and holds that
closure to the strict list. The toolchain closure additionally admits ISC, 0BSD, BlueOak-1.0.0
and the other unavoidable permissive licences of the Node toolchain — permissive only, never
copyleft. AGPL/GPL/LGPL/SSPL/BUSL/FSL/MSCL/Elastic/UNLICENSED and any *missing* licence field
are fatal anywhere, shipped or not, because "if a package's licence is unclear, do not add it".
This is a faithful reading of the policy's own scope, not a widening of it; the distinction is
recorded here because it is the kind of thing that should never be silent.

**`js-yaml` (MIT) over `yaml` (ISC) for the token compiler.** The token compiler's YAML parser
is the one toolchain dependency likely to end up in a shipped closure later, so it was chosen
from the strict list to keep that option open without a licence question.

**Vitest projects, not the deprecated workspace file.** `vitest.config.ts` at the root lists the
four packages as projects; each package config excludes `**/dist/**` so compiled
`dist/tests/*.js` are not collected twice.

**Postgres on port 55432.** Avoids colliding with a local 5432.

---

## P1 — `contract`

**DoD:** `pnpm --filter @ada/contract test` exits 0, with the predicate grammar at 100%
branch coverage. ✅ — 192 tests, predicate coverage 100% statements/branches/functions/lines,
enforced as a per-glob threshold in `packages/contract/vitest.config.ts` so it cannot regress.

Delivered: Zod `SiteDefinition` + `FactRegistry`; predicate lexer, parser (cached
JSON-serialisable AST) and total evaluator with snapshot output; per-build JSON Schema
generation; invariant runner; migration harness; canonical hashing.

### Decisions

**The published predicate grammar is incomplete, and two readings were forced.** v4 §2 writes
`expr := term (('&&' | '||') term)*`, which is flat and therefore ambiguous; `&&` was given
higher precedence than `||`. The same grammar lists `term` as call / comparison / group, yet
v4's own examples use bare paths as booleans (`grade_safe`, `attributable`), so `term` admits a
bare path evaluated for truthiness. Both readings are recorded at the top of `parser.ts`.

**A missing path fails every comparison, `!=` included.** v4 says "a missing path evaluates to
false / 0 / empty" without enumerating operators. Had `!=` been left with JavaScript semantics,
`rights != "unknown"` would have *admitted* an asset with no `rights` field at all — the exact
opposite of the intent. Gates fail closed. There is a test for it, and a second test proving it
holds inside filters.

**An empty array is falsy.** `media.photos` as a bare term means "has photos", not "has a
photos key". `exists()` remains available when presence is the question.

**Filters see the item, never the registry root.** A filter that could reach past its item would
make `count(a[x])` depend on where it was written.

**Derived fields are materialised by the schema, not by the evaluator.** v4 declares
`attributable` as a TypeScript getter on `Testimonial`; a getter cannot survive JSONB. Rather
than teach the evaluator about testimonials, `attributable`, `has_before_after` and `aspect` are
computed by Zod transforms at parse time, and are always recomputed so a stored registry cannot
carry a forged one. Test: a registry with `attributable: true` planted on an unconsented,
unattributed testimonial parses to `false`.

**Name claims are extracted from prose only.** The leash must catch an invented number, date,
quotation or name. Numbers, dates and quotations are unambiguous. Names are not: in a Title Case
headline every word is capitalised, so "Dana Whitlock" and "Storm Damage Repair" are
indistinguishable, and flagging both would block ordinary copy on every build. Name extraction
therefore runs only on text containing a lower-case-initial word after the first. **Residual
gap, stated plainly:** a fabricated name inside a Title Case headline is not caught at this
layer. It is caught at the DOM layer by `content.facts-provenance` (gate-checklist row 112),
which compares rendered text against the registry. This is a decision about *where* the check
lives, not a relaxation of it — numbers and dates are still extracted from headlines.

**An empty eligible set throws rather than emitting `enum: []`.** Some providers accept an
empty enum and then satisfy it with an arbitrary string, which is precisely a model naming a
section that does not exist. A call with nothing eligible is a programming error; the pipeline
must fall back deterministically instead.

**Canonical JSON refuses what JSON cannot represent faithfully.** `NaN`, `Infinity`, `bigint`,
functions and symbols throw with the offending path rather than serialising to something that
hashes differently on the way back. The done gate compares hashes, so silent drift there would
mean publishing a site no green report was ever produced for.

**Stack exhaustion is a parse error, not an exception.** Recursive descent on 60k nested parens
overflows; totality is a promise to the eligibility engine, so it returns
`{ ok: false, error: 'predicate nests too deeply to parse' }`. This is a test, not a comment.

---

## P2 — `gate`

**DoD:** `pnpm --filter @ada/gate test` exits 0; `site-clean` produces zero fatal rows;
`site-broken` fails exactly the expected set of check ids, asserted as a set equality; an
errored weighted check nulls the report. ✅ — 44 tests, 45 checks, two committed fixture sites.

Delivered: the check contract and registry, the serialisable artifact model, a static (jsdom)
gatherer, 45 checks covering every `build` row and every `D` row decidable without a browser,
the Playwright/axe/LHCI policy as data, the `GateReport` with fail-closed aggregation, the
repair-loop interface and the done gate.

### Decisions

**Checks are pure functions of a JSON artifact, and there are two gatherers.** Lighthouse's
artifact/audit split, taken for the property that makes it work: gather once, check many. The
static gatherer parses the build output with jsdom; the Playwright gatherer adds what only a
browser knows. Both produce the same `DomArtifact`, so ~30 checks run on every page in CI in
seconds with no browser, and a failing check can be reproduced from stored artifacts rather than
by re-running the site. This is also why the artifact is JSON and not a live DOM.

**A missing artifact is `notApplicable`, and a throwing check is `error`. Neither is a pass.**
Both rules live in the registry rather than in each check, so no individual check can get them
wrong. There is a third state that matters: when the run policy *promised* an artifact and the
gatherer did not produce it, the check `error`s rather than excusing itself, because otherwise a
broken gatherer silently shrinks the gate to the checks that happened to have data.

**The fail-closed rule was inert on first implementation, and the test caught it.** `weightFor`
originally zeroed the weight of every non-scored mode, `error` included — which made
"a *weighted* check errored" unreachable, so a thrown check would have been invisible in the
score. `error` now carries the check's severity weight while staying out of the score's
denominator. Recorded because it is exactly the class of bug that leaves a green report on a
gate that stopped gating.

**A report where nothing ran is not green.** `score === null` when no check carried weight, and
`canShip` requires a non-null score. An empty gate has verified nothing.

**axe `incomplete` becomes `needs_review`, which blocks shipping without being a failure.**
"The machine could not decide" is a fact about the machine, not about the page. Lighthouse
discards `incomplete` entirely and runs a narrower tag set, so axe is run directly with
`wcag2a/2aa/21a/21aa/22aa/best-practice` and `a11y.axe-tag-policy` fails if a run used fewer
tags — a gate that silently narrows its own rule set is worse than no gate, because the report
still says green.

**`a11y.meaningful-alt` is a permanent `manual` row.** No rule anywhere can decide whether alt
text describes an image. The deterministic half (filename-as-alt, "image", "photo") is caught by
the placeholder scan; the rest is carried as a reviewer question on every build, including a
clean one, and is excluded from the fixture set-equality assertion for that reason.

**Budgets gate on resource summaries, never on the performance score.** Sizes and counts are
exact on static output, so they are `error`; LCP, TBT and FCP move run to run and are `warn` on
the median of three. `categories:performance` is absent from the assertion list on purpose. A
test asserts that absence, so it cannot drift back in.

**Route sampling is deterministic.** Unlighthouse samples representatives at random;
`representativeRoutes` sorts and takes the first per (archetype × arrangement) group, so the same
site always audits the same pages and a report is reproducible.

**`structure.cta-present` exempts legal routes.** Checklist row 96 asks for a primary CTA on each
page. Applied literally that would push a "Call now" button onto a privacy policy. The check is
scoped to non-legal routes — a scoping decision, recorded here rather than made silently.

**The broken fixture's failures are split across two pages.** Some checks are mutually exclusive
on a single page: a page cannot both lack a title and ship a duplicate of another page's title.
The set-equality assertion is therefore over the union across the site, and a second test asserts
that the union covers every static check, so no check ships untested.

**Uniqueness is asserted against the SiteDefinition, not by crawling.** Titles, descriptions,
sitemap membership and internal link targets are all decidable before anything is deployed,
because the routes come from the contract.

---

## P3 — `library` infrastructure

**DoD:** `pnpm --filter @ada/library test` exits 0, and `pnpm verify` exits 0 at the root. ✅ —
122 tests. Infrastructure only: no graded variant, no `signature_move`, no rubric boolean, no ELO.
`assets/sections/` is empty on purpose, and a test asserts it stays that way
(`status: active` count is zero) so nothing machine-authored can be mistaken for the library.

Delivered:

**Token compiler** — DTCG-shaped YAML → static `tokens.css`, the whole SYNTHESIS §7.1 pipeline:
seeds → algorithms (10-step palette, `base·ratio^i` type scale, `unit·step` spacing, radius) →
v4 §3's seven semantic roles as ramp indices → conditions table (`dark`, `reduced_motion`,
`forced_colors`, `print`, `touch`) → `--ds-*` custom properties under `@layer reset, base, tokens,
recipes`. Contrast is WCAG 2.x, computed here with our own sRGB luminance maths, and a failure
**fails the build**. One reference design system, `reference_v1`, `status: reference`.

**Manifest schema + drift check** — a superset of the shadcn registry item, with v4 §8's layout
genome and §11's authoring standard. Every `requires` string is parsed with `parsePredicate` at
validation time; every id is checked against the contract's strict grammar at boot; problems
accumulate. The ts-morph check extracts the `.astro` frontmatter fence and parses it as
TypeScript. Eligibility excludes `scaffold` from any build that is not a fixture build.

**Reference-render harness** — pure addressing, a Zod storage contract for `index.json`, a
resolver and a coverage report. No Playwright: the gate owns browser execution.

**Grading CLI** — `pnpm library:grade`, which collects and refuses to invent.

**Motion registry** — the four tiers, five named effects, and a `zlib` byte-ceiling check.

### Decisions

**`reference` is a fourth design-system status, and it cannot widen anything.** v4 §12 lists
`active | frozen | retired`. The reference design system is infrastructure input for a compiler,
not a design decision, and calling it `active` would have made it selectable by a real build.
Eligibility filters *on* `active`, so adding a value to the enum cannot widen what may be chosen —
it can only exclude. Same reasoning for `scaffold` on manifests, which ARCHITECTURE §10 already
names.

**Contrast is checked in every condition that moves either side of a pair, not only in the base
scheme.** The spec says "every declared foreground/background pair". A dark scheme that quietly
drops below 4.5:1 is the normal way a palette fails and is invisible to a base-only check, so
there is a fixture whose light pair is 15:1 and whose dark pair is 2:1, and it does not compile.
Forced-colors pairs resolve to system colours (`Canvas`, `CanvasText`), which have no computable
ratio; those are recorded as *skipped with a reason* rather than passed. Asserting over a
palette the user chose would be theatre.

**The palette seed contributes hue and saturation; lightness comes from the curve.** Two seeds
with the same hue and different lightness therefore produce the same ramp. That is the point — an
author picks a colour, not a position on a scale — but it is surprising enough to be worth
stating, and it is what makes a role an index rather than a value.

**Token names are CSS-safe rather than faithful.** Step `-1` becomes `n1` and `0.5` becomes `0-5`
(`--ds-type-size-n1`, `--ds-space-0-5`). Both are legal in a custom property; both are a nuisance
to grep, and the gate greps token names.

**Roles are emitted as resolved values, not as `var()` indirection.** ARCHITECTURE §6 requires
zero runtime token resolution, and a condition that swaps a role to a system colour
(`forced_colors: CanvasText`) has no palette variable to point at. One mechanism for every
condition beat a debuggable one that needs a special case.

**`name` in the manifest carries the strict id grammar.** shadcn registry names are free strings.
Ours are `family/variant`, and `family` must agree with the family half. The alternative — a
kebab slug beside a variant id — is two ids for one thing, which is two ids that can drift.

**v4 §11's entry gate is a schema rule, not a review convention.** An `active` manifest must carry
an authoring record, the family's minimum arrangements, a full rubric on each, the family's extra
rubric, and the family's reviewer count. A `scaffold` may carry *none* of it and must be
`ungraded` throughout — a scaffold that could hold a grade is a scaffold that could be mistaken
for library content, which is the one failure the boundary exists to prevent. The accept branch of
that gate is exercised from a synthetic object built inside the test process and named
`NOT_A_REAL_GRADE`; no `signature_move`, `negative_example` or rubric boolean was written to any
asset file.

**`files[].path` is relative to the manifest's own directory.** shadcn's paths are
repo-relative. A manifest that describes its own folder moves without editing, and the import
scan resolves relative specifiers against the file that wrote them.

**The import scan follows type-only imports and resolves `.js` to `.ts`.** A type-only import is
still a real coupling to a real package, and in TypeScript ESM `./lib/format.js` means
`./lib/format.ts` on disk. `node:` and `astro:` specifiers are ignored: Astro's virtual modules
are supplied by the renderer, so there is nothing for a manifest to declare. Unused dependencies
are reported but off by default — that is the harmless direction of the same drift.

**The reference key's arrangement half is qualified as `family/variant#arrangement`.**
ARCHITECTURE §7.4 and the gate checklist both key on the triple *(arrangement, design_system,
project)*, but the contract's `ARRANGEMENT_ID` (`portrait-left`) is only unique within a variant.
Rather than silently widen the key to four fields, the arrangement id carries its variant. The key
stays the triple the spec names and is unambiguous. **This is a reading of an under-specified
line, and it is the one place in P3 where a later worker might reasonably have chosen
differently.**

**A missing reference render is a result; an unaddressable key is an exception.** The gate's job
on a gap is to record `needs_review` and carry on gathering the bundle. A malformed id is a
programming error and throws. Likewise, an absent `index.json` reads as an empty index — before
P5 renders anything there is no index, and throwing would make "nothing rendered yet"
indistinguishable from "the index is corrupt".

**The grading CLI's refusal lives in a plain `.mjs` that imports nothing first.** If the check sat
behind an `import`, a missing `dist/` would turn "refuses to run" into "crashes" — and a crash is
not a refusal, it is an outcome somebody works around. It also means the DoD test needs no build
step, so the assertion runs on every test invocation rather than when someone remembers. Exit
code 2, and the message names which condition tripped.

**The grading CLI does not touch `signature_move` or `negative_example`.** Those are *authoring*
fields, recorded when the variant is authored, not when it is graded. Folding them into the
grading flow would have put an agent-runnable CLI one prompt away from filling them in. It also
offers no default answer anywhere: a blank response to a rubric item is re-asked, never taken as a
no, and a test asserts the prompts are `[y/n]` and never `[Y/n]`. A tool that nudges a tired
reviewer towards `y` grades for them.

**Grades append to a JSONL ledger, one line per reviewer.** v4 §11 wants two reviewers per
variant; a file per arrangement would have made the second reviewer an edit to the first's
record, which is the shape in which a disagreement quietly disappears.

**The reduced-motion arm is derived from the kind of motion, not declared freely.** SYNTHESIS
§7.3's tri-mode reading is a function: programmatic → instant, gesture → 1:1, loop → poster. An
effect pairing a kind with a different arm does not load. `respects_prefers_reduced_motion` is
*not* a manifest field at all — v4 declares it literal and unsettable, and a boolean nobody may
set to false is better expressed by not existing.

**Per-effect byte ceilings are measured over un-minified source, at gzip level 9.** That
over-states what a client downloads, which is the safe direction; the level is fixed because
zlib's default is a property of whoever compiled node, and a budget that differs between a laptop
and CI is not a budget. Two effects were re-declared upwards (700 → 1536, 400 → 1024) when the
check found the original guesses too tight — the numbers are budgets with headroom, not a ratchet
set to the current size, and both sit far under tier A's 10,752-byte runtime.

**Two of the five motion effects are `status: planned`, and the check reports them as
`not_measured` rather than as a pass.** `pin_scroll_story` (tier B) and `shader_plane` (tier C)
have no implementation until P5 — and ARCHITECTURE §11.4 has not decided whether tier C ships in
V1 at all. They are in the registry so the vocabulary is closed; a ceiling nobody has measured
should not read as a ceiling that has been met.

**`literal` tokens exist beside DTCG's types, with a `string` escape hatch.** A shadow list and a
`none` are raw CSS. Naming the escape hatch rather than leaving it implicit means a reviewer can
see every place the compiler stops understanding a value.

**The library's own drift checks run as tests, not as a separate CI step.** `pnpm verify` runs
the suite, and the suite loads the real `assets/`, compiles the real design system, measures the
real motion sources and runs the real import scan. Adding a `library:check` script would have
given the same coverage a second, forgettable entry point; `pnpm library:grade` was added to the
root scripts because the DoD names it, and every existing script is untouched.

### Residual gaps, stated plainly

- **`assets/sections/` is empty.** The brief permits `service_clarity` scaffold *sections*, but
  the `.astro` files are P5's job, and a manifest whose `files[]` points at a file that does not
  exist fails the very import check it would be demonstrating. The manifest and eligibility
  plumbing that will classify them is done and tested against fixtures under
  `tests/fixtures/library*/`; P5 moves a fixture-shaped manifest into `assets/sections/` beside
  its `.astro` and nothing else changes.
- **No `.astro` section variant is rendered by anything yet**, so the manifest's `composition`,
  `budget` and `a11y` numbers are declarations no build has checked against a real render. P5 and
  the gate close that loop.
- **`references/index.json` does not exist**, because nothing has rendered a reference. The
  harness reads that as an empty index and reports full coverage as missing, which is the honest
  answer.
- **The compositor-property audit is a narrow regex pass over CSS**, reading
  `transition-property`, `will-change` and `@keyframes` declarations. It catches the mistake at
  library-build time, where it is cheap. It does not prove the absence of a non-composited
  animation — Lighthouse's `non-composited-animations = 0` does that in a real browser, and it
  remains the authority.
- **ELO is recorded, never computed.** There is no pairwise comparison tool and no percentile
  check against `family_standards.elo_floor_percentile`. That needs a populated library to
  compare within, so it belongs with P7.

---

## P4 — `pipeline` (in progress)

**DoD:** `pnpm --filter @ada/pipeline test` exits 0, with the retreat order, interrupt/resume,
both budget ceilings, stuck detection, manifest derivation and the tier-3 detector each asserted.
✅ for everything except the four model-call stages themselves, which land with P6's wiring.
105 tests.

Delivered: run state and the append-only event log, the checkpointed stage machine with
interrupt/resume, the model-call wrapper and its deterministic fakes, eligibility and the compat
retreat ladder, assembly (composition, narrative, rhythm, computed intensity), anti-slop tiers 1
and 3, and the Decision Manifest and Gap Report projections.

### Decisions

**The pipeline depends on a `LibraryView` interface, not on the library's file layout.** The
library package satisfies it and tests satisfy it with fixtures. It keeps the boundary honest: a
field the pipeline needs that is not on the interface is a visible change to the contract between
them, rather than a quiet reach into another package's internals.

**Eligibility and compatibility are separate mechanisms, and only one of them relaxes.**
Eligibility asks what the evidence supports and its answer is `requires`. Compatibility asks what
fits the chosen design system, art direction and positioning. The retreat ladder is a list of
*filters over already-eligible candidates*, so `compatFilter` structurally cannot re-admit a
variant whose `requires` failed — it never sees one. This is ARCHITECTURE's "invariant most
likely to come under deadline pressure", and the defence is the shape of the code rather than a
comment. `retreatOrder()` exports the ladder as data and a test asserts it contains no step for
`requires`.

**The memo key excludes the model id.** A decision made from a given eligible set, prompt and
seed is the same decision whoever answered. Including the model would silently invalidate every
cached decision on a model upgrade, which is a re-decision nobody asked for.

**Stuck detection fires on the second identical rejection, not the third.** Re-proposing a value
that was already rejected will not become right on another attempt, and spending the rest of the
re-ask budget to discover that is the cost worth avoiding. The test asserts the call count.

**`finish_reason === 'length'` breaks the loop rather than re-asking.** A truncated selection is
not a partial selection, and re-asking the same question after a truncation usually truncates
again. It goes straight to the deterministic fallback.

**The wrapper refuses a fallback that is not itself eligible.** A pipeline that falls back to
something it has just decided the evidence does not support has defeated its own gate. It throws
rather than returning an outcome, because it is a programming error, not a run state.

**Coercion is recorded, never silent.** Trimming whitespace and matching case are worth doing
without another round trip; doing them invisibly produces a system nobody can debug. Anything
beyond that is left alone rather than guessed at.

**Tier 3 separates what a person reads from what a build is blocked on.** A nine-word cliché
surfaces as several overlapping six-grams, which is one finding presented four times, so they are
chained back into the full phrase for the review queue. But blocking on that reassembled phrase
would be wrong in the other direction: a build reusing six words of a nine-word cliché is reusing
the cliché, and matching only the full chain would flag house slop and then wave it through. The
flag therefore carries `value` (the readable phrase) and `matches` (the n-grams that actually
crossed the threshold). Both halves have a test.

**Proper nouns are dropped, not replaced.** A business name appearing in every one of its own
builds is not a cliché. The dropped word leaves a sentinel so no n-gram can span the hole and
make a phrase look repeated when only the name was.

**The manifest has no free text anywhere.** Every sentence is a template over a recorded value,
and an unfamiliar predicate is quoted verbatim rather than paraphrased — a wrong paraphrase of a
gate is worse than an unfriendly one. The test asserts each sentence is reproducible from the
snapshot by calling the same template, so a hand-written string would fail it.

**A predicate that was never evaluated is recorded as such.** `ruledOutFor` emits
`actual: null` with an explicit note rather than omitting the row, because a missing gate that
reads as "passed" is the failure mode this whole layer exists to prevent.

**Positioning interrupts the run rather than defaulting.** v4 §6 is explicit that a model
guessing "premium" for a budget operator misrepresents a business to its own customers in its own
voice. The stage returns `WAITING_FOR_OWNER` and does not advance, so resuming re-enters the same
stage with the answer. `resume` refuses a run that is not waiting, so an answer cannot be
silently dropped.
