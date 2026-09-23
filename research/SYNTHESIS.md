# Autonomous Digital Agency — Competitive Intelligence Synthesis

Companion to `section-metadata-schema.md` (v4) and `implementation-strategy.md`.
Sources: 65 repository analyses in `repos/*.json` (aggregate: `repo-analysis.json`,
matrix: `REPO-MATRIX.md`), the consolidated 125-row gate inventory in
`notes/gate-checklist.md`, and raw repository data in `raw/`. Verified 2026-09-23.

Everything below is a conclusion drawn from reading source, not READMEs. Where a number
appears it was measured by an analyst (esbuild/rollup bundle, registry counts, file reads).

---

## 0. Executive summary

**Nothing in the open-source landscape does what v4 specifies. Every mechanism v4 needs
exists somewhere, in pieces, and none of the 65 projects combine more than two of them.**

The recommendation counts:

| Recommendation | Count | Meaning |
|---|---|---|
| Adopt | 7 | Use the library directly: Playwright, axe-core, Lighthouse/LHCI, GSAP, Crawl4AI (research sidecar), react-aria (islands only), plus json-render's core pattern borderline |
| Adapt | 33 | Take a named mechanism, rewrite for Astro/TS/Zod |
| Ignore | 25 | Nothing worth the dependency, or license-toxic, or dormant |

Seven findings change the v4 spec or the implementation strategy:

1. **The 140 kB WebGL ceiling is unachievable with three.js.** Measured tree-shaken floor
   for one basic mesh is 508 kB min / 123 kB gzip; an r3f island is 309 kB gzip; Spline's
   runtime is 263 kB gzip. Live WebGL is only viable via OGL (14 kB gzip) or a raw shader
   plane (<10 kB), or as a pre-rendered WebM/AV1 loop with 0 kB JS. three.js moves to
   library time, baking posters and loops. Spec §9 needs rewriting (see §7.3).
2. **Do not use Payload (or any CMS) as the V1 store.** Payload 3/4 requires a Next/TanStack
   host for the admin V1 cuts; its Postgres adapter creates one table per block type, so
   every section-library change is a migration. Store SiteDefinition as validated JSONB in
   Postgres via Drizzle, copy Payload's `_versions` shadow-table shape, and keep Payload's
   conventions so the post-V1 editor can adopt its live-preview bus.
3. **Section authoring language must be decided before Week 3.** Every open-source visual
   editor (GrapesJS, Craft, Puck, react-page, Builder, Plasmic, Onlook, blocks) makes the
   editor runtime the renderer. `.astro`-authored sections can never be rendered inside a
   React canvas. The only architecture that keeps SiteDefinition as the single source of
   truth is: Astro emits stable `data-sd-path` attributes, the editor is an overlay
   (iframe + typed postMessage RPC) that maps DOM → JSON pointer → patch, and undo is a
   persisted inverse-action log. Decide `.astro` for V1; the editor cost is then bounded.
4. **A full agent framework is not warranted.** The pipeline is a linear DAG with four
   constrained model calls. The useful 20% of OpenHands, CrewAI, LangGraph, AutoGen and
   agent-zero (event log, status enum, dual budget, guardrail retry, interrupt/resume,
   triggered playbooks) is roughly 800 lines of TypeScript. LangGraph.js is the only
   TypeScript-native option if a library is wanted; everything else is a Python second runtime.
5. **License hygiene is a real risk in this list.** Origin UI is now Cal.com's `coss`
   under AGPL-3.0 (copying its components into client deliverables contaminates them);
   Directus moved from BSL to a source-available "MSCL 1.0" with runtime entitlement keys;
   pennysite is GPL-3.0; ai-website-powerhouse is FSL-1.1 (forbids competing use);
   Aceternity is proprietary with no redistribution. GSAP is now free for all commercial
   use under a proprietary no-charge license whose only prohibition is building a competing
   no-code animation builder, which touches the post-V1 visual editor.
6. **Reduced motion is nobody's responsibility in the animation and 3D ecosystem.** 0 of 16
   sampled Aceternity components, 5 of 78 MagicUI components, and none of r3f/drei/three/
   Spline/Theatre honour `prefers-reduced-motion`. It must be a static QA-gate assertion
   and a CSS rule in every design-system token file, never a component contract.
7. **The gate can be built almost entirely from existing tools, but ~40 checks are ours.**
   Of ~110 distinct check ids, ~85 are deterministic on a static build. None of Lighthouse,
   axe, pa11y or Unlighthouse asserts link status, canonical uniqueness, duplicate titles,
   schema.org validity, form end-to-end, reduced-motion behaviour, LCP element identity,
   JS budget per page, or art-direction grade coverage.

---

## 1. Recurring patterns across repositories

Patterns that appeared independently in three or more unrelated codebases. Independent
convergence is the strongest signal in this research: it means the pattern is a property
of the problem, not of a community.

| # | Pattern | Seen in | What it means for us |
|---|---|---|---|
| P1 | **Typed block list discriminated by a slug** | Payload `blockType`, Strapi `__component`, Puck `type`, Builder `@type`, json-render `type`, OpenPage `type`, Craft resolver names | `SiteDefinition.sections[]` is a Zod `discriminatedUnion('family')`; the discriminator is the only vocabulary the model sees |
| P2 | **Invariants at the write boundary, not in the UI or prompt** | Payload field hooks, Keystone `addValidationError`, Strapi middleware chain, frappe/builder `WorkingTree`, pennysite `write_page`, OpenThorn done-gate | One path-addressed invariant runner over SiteDefinition; nothing partial ever enters state |
| P3 | **Catalogue compiles to prompt + schema + validator** | json-render `defineCatalog`, browser-use `create_action_model`, Stagehand protocol package, frappe `BlockCodec` | Per-build strict JSON Schema whose enums are exactly the eligible ids; the model cannot name an ineligible option |
| P4 | **Flat id-keyed document with parent pointers and named slots** | Craft `Record<id,Node>` + `linkedNodes`, json-render `elements`, Onlook oid index, Plasmic `@WeakRef` tree | Sections and slots keyed by stable instance ids; patches, manifests, telemetry and the editor all address the same ids |
| P5 | **Stable ids stamped into rendered output at build time** | Onlook `data-oid`, blocks `___uuid`, GrapesJS `data-gjs-*`, Directus `data-directus`, totalum `data-tlm-loc`, powerhouse `data-aiwp-slot` | Astro renderer emits `data-sd-path` (JSON pointer) and `data-sd-id` on every section and editable field |
| P6 | **Bounded structured-output retry with the violation fed back** | CrewAI guardrails, OpenPage coerce-then-validate, pennysite validating tool, Onlook schema repair, OpenThorn structured rejections | Shared model-call wrapper: safeParse → coerce → re-ask with codes → deterministic fallback, each stage attempt-bounded |
| P7 | **Explicit run status enum with a human-wait state + event log** | OpenHands `ConversationExecutionStatus`, SuperAGI DB status, CrewAI pending feedback, LangGraph `interrupt`, Unlighthouse task status | Build runs are Postgres rows with `WAITING_FOR_OWNER`; positioning is a literal pause, not a polling flag |
| P8 | **Loop/stuck detection with nudge-then-stop** | OpenHands StuckDetector, OpenThorn failing-call detector, agent-zero repeat counters, browser-use soft loop | Re-proposing the same rejected id twice terminates the selection call and triggers substitution |
| P9 | **Versioned document + ordered migrations** | react-page migrations, Puck `migrate()`, Builder `@version`, Theatre `definitionVersion`, AutoGen `ComponentModel` | Every section variant, design system, playbook and motion profile carries `schema_version`; migrations are pure `(doc) => doc` with fixtures |
| P10 | **Tokens as a tiered, derived, condition-keyed tree compiled to CSS variables** | antd seed→map→alias, MUI `cssVarsParser`, Chakra semantic tokens + conditions, Mantine resolver, Carbon DTCG + scheme map, S2 `{light,dark,forcedColors}`, coss `color-mix` | DTCG-shaped YAML → derivation algorithms → conditions table → static `tokens.css`; zero runtime |
| P11 | **Interaction state as `data-*` attributes, never class names** | Radix `data-state`, Zag `data-part/data-state`, react-aria `data-pressed/focus-visible`, Chakra conditions | Required attribute vocabulary in every section variant so static CSS styles state and Playwright asserts it |
| P12 | **Registry item as the distribution contract** | shadcn `registry-item.json`, MagicUI, Aceternity, coss all publish it; Tremor vendoring | Section library manifest is a superset of the shadcn registry item schema; SHA-pinned addressing |
| P13 | **Reference render as the baseline, not the previous build** | Playwright `snapshotPathTemplate`, Lighthouse fixtures, Theatre authored state | Visual regression compares against the library-time render of (variant × arrangement × design system × device) |
| P14 | **Verify the render, not the code** | Loupe verify-the-render, OpenThorn build-then-execute, totalum preview-health, Playwright | An edit or repair is complete only when the rendered DOM/pixels are asserted |
| P15 | **Behaviour-as-versioned-files with override-and-extend** | agent-zero prompt directories, OpenHands microagents/skills triggers, karero SKILL.md suite, Carbon/Chakra presets | Playbooks, archetypes and positioning overlays are ordered file layers with keyword/path triggers, reviewed via dated diffs |
| P16 | **Per-entry byte budgets enforced in CI** | Motion `bundlesize`, Motion One size map, LHCI `resource-summary`, karero skill budgets | Every allowlisted motion pattern and every island declares max gzipped bytes; CI and the gate both enforce |
| P17 | **Cheap check before expensive check, sampled by template** | Unlighthouse task pair + route grouping, LHCI representative runs, axe tag policy | Pass 1 deterministic DOM checks on every page; Lighthouse perf ×3 on one representative per archetype × arrangement |
| P18 | **Import/host/dependency allowlist shared by prompt and runtime** | OpenThorn `allowed-packages.ts`, AI-first-Builder Sandpack deps, powerhouse host scan, pennysite image allowlist, Crawl4AI config allowlist | One module defines eligible ids and allowed hosts; both the model-facing catalogue and the build resolver read it; violations are hard failures |

**The anti-pattern that recurs just as reliably** (every AI builder except pennysite and
frappe; Loupe; karero): correctness lives in the prompt. "Avoid centered heading plus three
cards" as prose, "$50,000 budget" as an instruction, "Awwwards quality" as a target. All of
them admit parser success is sensitive to phrasing. This is the strongest evidence for the
authored arrangement library over prompting that the research produced.

---

## 2. Missing opportunities: what nobody has solved

Each of these was absent from all 65 repositories, including the commercial SaaS
components that were visible through their SDKs.

1. **Content-fact-gated design eligibility.** Every constraint mechanism found (Puck slot
   allow-lists, Builder `childRequirements`, Plasmic `allowedComponents`, Payload
   `filterOptions`) is *structural*: what may nest in what. None gates a component on
   whether the business has the evidence to fill it honestly. The FactRegistry → predicate
   → eligible-set mechanism has no prior art in this corpus.
2. **The Gap Report as a product surface.** No tool tells the owner "provide four
   before/after pairs and your homepage changes shape." Every builder degrades silently
   (placeholder text, stock photo, hallucinated Unsplash id).
3. **Page rhythm and intensity as computed properties.** No layout system models the
   intensity curve across sections. react-page's grid, Puck's zones and GrapesJS's tree are
   all position-only. Composition, narrative and rhythm rules are unique.
4. **Art direction as a selectable, versioned layer applied to every photographic asset.**
   No library or builder has a photo grade, crop grammar, or "ungraded asset" check.
   The closest is Loupe's token panel, which is structure, not imagery.
5. **Asset rights and subject consent as first-class data.** Three builders hallucinate
   Unsplash ids, one uses random picsum, one AI-generates people. `rights: unknown ⇒
   ineligible` and `never: ai_generated_person` have no prior art.
6. **Reduced motion as a gate assertion.** Universally absent (finding 6 above).
7. **A self-cliché detector.** Tier 3 (n-gram frequency across your own last 100 builds)
   exists nowhere. Every anti-slop attempt found is a static prose list or an LLM judge.
8. **Decision rationale derived from a predicate snapshot.** Every "explain" feature found
   is model-narrated. No one emits `{failed: predicate, actual: value}`.
9. **Design-choice-to-conversion evidence.** Builder has `VariationEnvelope` with ratios; no
   one has evidence thresholds, hierarchical pooling, or promotion/demotion of priors.
10. **Design-system pinning for live tenants.** react-page and Puck migrate documents; no
    one pins `design_system@version` per built site so a retired system never restyles a
    live client. Theatre's `revisionHistory` is the nearest shape, for motion.
11. **Local-service trust signals.** Every component library's block taxonomy (shadcn
    blocks, Aceternity Pro, MagicUI) is SaaS-shaped: pricing, bento, logo cloud, stats.
    Licence-and-insurance bar, service-area map, written-warranty terms, before/after
    slider, sticky mobile call bar exist in none of them.
12. **Art-directed no-photo fallback.** Every builder substitutes stock or generated
    imagery when photos are missing. Typographic/abstract fallbacks selected by design
    system, with posters baked at library time, are unique.

Items 1, 2, 8 and 9 are the moat (§10). Items 4, 5, 6, 11 and 12 are the visible quality
difference a client notices in the first ten seconds.

---

## 3. Best architecture per concern

For each concern: the pattern, its source, and the decision.

### 3.1 Design generation

**Pattern:** SchemaTriad (json-render) + AxisMatrixBuild and BitPackedPresetId (shadcn)
+ SeededDirectiveBundle (pennysite) + GuardrailRetryLoop (CrewAI).

**Decision:** The model never generates design. It makes three enum selections and writes
copy on a leash. Each selection call receives a per-build strict JSON Schema generated from
the eligible set (SchemaTriad). `design_system_id` and `art_direction_id` are decodable
preset codes over append-only axes (BitPackedPresetId), so an id is both a selection and
a full token specification. A recorded integer seed derives which eligible arrangements
are offered in which order, making variety reproducible and auditable. Output passes
safeParse → coerce → re-ask (≤2) → deterministic fallback (`service_clarity` archetype,
`fallback: true` variants).

**Rejected alternatives, with evidence:** free composition from a primitive catalogue
(json-render's shadcn catalogue, Puck, Builder) produces the Hero 1/2/3 problem; prompt-
described design (karero, Loupe skills, all ten AI builders) produces slop by the authors'
own admission.

### 3.2 Layout systems

**Pattern:** NormalizedNodeMapWithNamedSlots (Craft) + SlotAsField (Puck) + CompoundSlot
vocabulary (blocks, Aceternity anatomy) + VersionedPluginMigrations (react-page).

**Decision:** A page is `sections: Record<instance_id, SectionInstance>` with an ordered
`order[]`, not a nested tree and not a grid. A SectionInstance is `{family, variant_id,
arrangement_id, slots: Record<slot, Binding>, schema_version}`. Slots are named and typed
per variant (`hero.media`, `proof.items[]`), never anonymous children. The layout genome
(variant × arrangement, with `asset_constraints` on real photo aspect/size) is the unit of
selection. react-page's 12-column recursive grid and GrapesJS's DOM tree were both
evaluated and rejected: they express position, not composition, and would let the model
or owner produce arrangements nobody authored.

### 3.3 Art direction

**Pattern:** ConditionKeyedToken (Chakra/S2/Carbon) for grade variants + BakeAtLibraryTime
(three.js headless) + AssetDerivedPlaceholder (react-spline thumbhash) + ImageSourceAllowlist
(pennysite/powerhouse).

**Decision:** Art direction is a YAML asset with `photography.grade` (LUT, contrast,
saturation delta, grain), `crop_grammar`, `texture`, `depth_strategy`, `no_photo_fallback`.
The grade is applied in the asset pipeline at build time to *every* photographic asset;
`ungraded_asset` is a blocking tier-1 check that compares rendered image hashes against the
graded asset set. Abstract/typographic fallbacks and any ambient WebGL posters are baked at
library time with three.js + Playwright and shipped as static images or 3–6 s WebM/AV1
loops. Every image slot carries a build-time placeholder derived from the real asset. No
image, script or stylesheet may reference a host outside owned object storage; this is a
hard gate, unlike powerhouse's chat warning.

### 3.4 Visual editing (post-V1, but architecture-binding now)

**Pattern:** SourceIdSourcemap + InverseActionHistory + OverlayStylesheetPreview +
TypedIframeRPC (Onlook) + LayeredPermissions and EditModeFieldTransform (Puck) +
PermissionFlagsWithPropagation (GrapesJS) + PostMessagePreviewBus (Payload) +
CapabilityHandshake (Builder) + PatchRefinement (json-render).

**Decision:** The editor is an overlay over Astro's own render, never a second renderer.
- Astro stamps `data-sd-path` and `data-sd-id` on every section root and editable field.
- The preview iframe exposes one typed RPC object (penpal-style) and announces its
  capabilities on boot (inline text, image swap, section reorder).
- Every edit is a serializable `SiteEditAction` with a pure inverse; transactions coalesce
  continuous edits; undo/redo re-dispatches inverses over the SiteDefinition; the log is
  persisted (Craft's immer patch timeline is the reference implementation).
- Permissions are three-layer (global → per-variant → per-instance) and default to locked:
  owners edit copy, CTA labels, image slots and alt text; layout genome fields are
  read-only. `readOnly` per field is computed from the selected arrangement.
- Preview of owner edits is an overlay stylesheet keyed by `data-sd-id`; commit creates a
  new SiteDefinition version and re-runs the gates.
- The AI edit path uses RFC 6902 patches against SiteDefinition (json-render edit modes),
  never regeneration.

**Fork to resolve before Week 3:** `.astro` sections cannot be rendered by any React
canvas. Choose `.astro` and accept that the editor is an overlay only. Choosing React
sections SSR'd by Astro would allow a Puck-style canvas later at the cost of Astro-native
features and a React runtime on every island. Recommendation: `.astro`.

### 3.5 Autonomous agents

**Pattern:** EventSourcedRunState + DualBudgetGuard + LoopSignatureDetector +
TriggeredKnowledgeInjection (OpenHands) + GuardrailRetryLoop + StagedOutputCoercion
(CrewAI) + ReducerTypedState + SuperstepCheckpointing + InterruptResume + SendFanOut
(LangGraph) + LayeredPromptDirectories + NumberedHookScripts (agent-zero) +
DoneVerificationGate (OpenThorn) + ConfirmGatedTerminalTool (frappe/builder) +
DomShapeKeyedMemo (Stagehand).

**Decision:** A checkpointed state machine, not an agent. See §5.

### 3.6 QA

**Pattern:** ArtifactAuditSplit + ScoreDisplayModeEnum + EslintStyleAssertionGrammar +
RepresentativeRunSelection (Lighthouse/LHCI) + AnyAllNoneCheckAlgebra +
IncompleteReasonCodes + TagPolicySelection (axe) + DeviceProjectMatrix +
ReferenceRenderBaseline + StabilizedCapture + StructuralA11yTemplate + StepAsCheck +
NetworkAllowlistGate (Playwright) + TemplateGroupSampling + CheapThenExpensiveTaskPair
(Unlighthouse) + NeedsReviewSeverityCap (pa11y) + ObserveThenReplay (Stagehand).

**Decision:** See §8. Adopt Playwright, axe-core, Lighthouse/LHCI directly. Ignore pa11y
(redundant, LGPL, Puppeteer). Adapt Unlighthouse's scheduling, not its budget.

### 3.7 SEO

No repository in the list is an SEO tool; the relevant material is Lighthouse's SEO
category (structured-data audit is manual), karero's ai-seo/schema-markup/search-console
skills, and Payload's `plugin-seo`. **Decision:** SEO is data, not a stage. The
SiteDefinition carries `seo: {title, description, canonical, og, robots, schema_org[]}`
per page, generated deterministically from facts (LocalBusiness/Service/FAQPage/Person
schema from the FactRegistry, never from copy). Gate checks (Lighthouse `document-title`,
`meta-description`, `canonical`, `hreflang`, `robots-txt`, `crawlable-anchors`, plus our
own duplicate-title, canonical-uniqueness, sitemap/llms.txt presence and a schema.org
validator) are in `notes/gate-checklist.md` §6. Post-launch, karero's search-console and
business-listings steps become launch checklist items. OG images render from the same
SiteDefinition via Satori (json-render's image renderer pattern).

### 3.8 Accessibility

**Pattern:** react-aria hooks (Adopt, islands only), Zag machines via `@zag-js/vanilla`
over SSR'd markup (Adapt), Radix's `data-state`/Presence/roving-focus contracts (Adapt),
axe `incomplete` reason codes → human task mapping, GSAP SplitText `aria:'auto'`.

**Decision:**
- Native elements first: `<details name>` for FAQ (0 kB) beats a Radix accordion island
  (~53 kB gzip). Scroll-snap carousel with JS only for indicators and `aria-live`.
- Where a widget needs a state machine (tabs, carousel autoplay), hydrate SSR'd markup
  with `@zag-js/<machine>` + `@zag-js/vanilla` (10–17 kB gzip each); never `@ark-ui/react`
  (290 kB gzip, 69 deps).
- React islands that genuinely need dialogs/menus use react-aria hooks; the
  `data-pressed/hovered/focus-visible/disabled` attribute contract is required site-wide.
- axe runs with the full tag set (`wcag2a, wcag2aa, wcag21aa, wcag22aa, best-practice`)
  through `@axe-core/playwright`; `incomplete` results are `needs_review` rows with the
  reason code (e.g. `color-contrast: bgImage`) mapped to a specific human check recorded
  in the Decision Manifest. Lighthouse's a11y category is not used for gating: it runs a
  subset and drops `incomplete`.
- Checks no tool provides and we write: focus visibility (screenshot on `:focus-visible`
  per interactive element), reduced-motion behaviour (project with `reducedMotion:
  'reduce'` asserting zero running animations and poster presence), reading order vs
  visual order, meaningful alt (alt must resolve to an asset record with `alt` set by
  ingest, not model-generated), coarse-pointer 44 px targets.
- Any text-split animation must keep `aria-label` on the container and `aria-hidden` on
  fragments (GSAP SplitText semantics), asserted by the gate.

### 3.9 Performance

**Pattern:** EntrySizeBudgetCI (Motion), `resource-summary` LHCI assertions, WAAPI-first
compositor-only properties (Motion One), DemandFrameLoop + QualityGovernor + ClampedDpr
(r3f/drei), PosterFallbackSlot / HiddenUntilFirstFrame (react-spline), CapabilityEntryPoints
(three.js), BakeAtLibraryTime.

**Decision:**
- Budgets are LHCI assertions on deterministic resource summaries, not on the performance
  score: `resource-summary:script:size ≤ 184320`, fonts ≤ 2 files / 200 kB, third-party
  requests ≤ 2, `unsized-images` = 0, `render-blocking` = 0, `non-composited-animations`
  = 0 (this last one enforces the motion budget mechanically).
- Timing metrics (LCP, TBT, CLS) gate on the median of three serial runs on one
  representative page per archetype × arrangement group; CLS is near-deterministic on a
  static build and gates at 0.1.
- Two-tier motion runtime (see §7.3): `motion/mini` + `inView` (~10.5 kB gzip) for reveal
  and scroll-linked opacity/transform; GSAP core + ScrollTrigger (46.5 kB gzip) only for
  arrangements declaring pinning, labelled timelines or SplitText. CSS
  `animation-timeline: scroll()` emitted statically where supported.
- The single allowed WebGL section: OGL or raw shader (≤ 15 kB gzip), lazy-mounted on
  intersection behind a real poster, `gl.compile` + one hidden frame before crossfade,
  demand-driven frame loop, dpr clamped by token (1.5 mobile / 2 desktop), quality governor
  with hysteresis, poster-only under reduced motion or low GPU tier.

### 3.10 Compliance

**Pattern:** TenantGuardTriplet (Payload), ThreeTierAccess (Keystone), UntrustedConfigAllowlist
(Crawl4AI), PathSanitizer (powerhouse), GenerationAuditRow (Bloom), VersionedFatalWarningRulePack
(Ghost gscan), Directus's licence-entitlement model as a warning.

**Decision:**
- Legal pages are generated from `legal.*` facts; `legal.privacy_contact` and
  `contact.address` missing are `blocking` Gap Report entries (LocalBusiness schema and
  privacy policy cannot be completed).
- Consent: cookie categories from facts; analytics is first-party, consent-gated, respects
  DNT, no PII in event props (v4 §10). No third-party script may load before consent; the
  network allowlist gate asserts it.
- Assets: `rights != unknown`, `subject_consent` for portraits, `consented` for
  testimonials, are predicates, not prompts. Every model call, every fetch, every
  publish is an audit row (provider, model, prompt hash, output hash, cost, duration,
  finish reason).
- Licence policy for code that ships to clients: MIT/Apache/BSD/MPL only. AGPL (coss),
  GPL (pennysite), FSL (powerhouse), MSCL (Directus), proprietary-no-redistribution
  (Aceternity) are pattern sources, never dependencies. GSAP's no-charge licence is
  acceptable for shipped sites; re-read it before shipping a visual animation editor.
- Multi-tenancy: `site_id` on every row, a filter layer on every query, a write hook that
  rejects cross-tenant references (Payload's triplet).

---

## 4. Unified system architecture

```
                        ┌──────────────────────────────────────────────────────┐
                        │                    AUTHORED ASSETS (git, versioned)   │
                        │  section library   design systems   art directions   │
                        │  playbooks         archetypes       positioning      │
                        │  anti-slop rulepack   gate policy   motion registry  │
                        │  (each: schema_version, status, reviewed, pinned SHA)│
                        └───────────────┬──────────────────────────────────────┘
                                        │ loaded + validated at boot (Zod, strict id grammar)
   ┌──────────────┐   ┌─────────────────▼──────────────────┐   ┌─────────────────────┐
   │   INTAKE     │   │          PIPELINE RUNNER            │   │   RESEARCH SIDECAR  │
   │ owner forms  │──▶│ checkpointed state machine (TS)     │◀──│ Crawl4AI (Docker,   │
   │ uploads      │   │ one Postgres row per (run, stage)   │   │ LLM off, robots on) │
   │ positioning  │   │ event log, status enum, budgets     │   │ → FactSource records│
   │ (declared)   │   │ interrupt: WAITING_FOR_OWNER        │   │ → playbook drafts   │
   └──────────────┘   └───┬────────────────────────────┬────┘   │   (/_proposed only) │
                          │                            │        └─────────────────────┘
        ┌─────────────────▼─────────────┐   ┌──────────▼──────────────────────────┐
        │  DETERMINISTIC STAGES (code)   │   │  CONSTRAINED MODEL CALLS (4 + 1)     │
        │  ingest → FactRegistry         │   │  creative direction  (enum schema)   │
        │  predicate eval → snapshot     │   │  beat selection      (enum schema)   │
        │  eligibility sets              │   │  arrangement         (enum schema)   │
        │  playbook + positioning boosts │◀─▶│  copy on grounded_in leash (Zod)     │
        │  compat filter, retreat order  │   │  tier-2 cliché judge (warning only)  │
        │  assembly: composition/rhythm  │   │  wrapper: parse→coerce→re-ask→fallback│
        │  populate + grade all photos   │   │  memo key = hash(eligible set+prompt)│
        │  anti-slop tiers 1 + 3         │   └─────────────────────────────────────┘
        │  SEO/schema/legal from facts   │
        └───────────────┬────────────────┘
                        │ SiteDefinition (Zod, JSONB) + DecisionManifest + GapReport
        ┌───────────────▼────────────────┐
        │  RENDERER (Astro)              │  tokens.css per design system (compiled)
        │  variant_id → .astro component │  data-sd-path / data-sd-id on every node
        │  islands: zag-vanilla / motion │  posters + graded assets from object storage
        │  static HTML, ≤180 kB JS       │
        └───────────────┬────────────────┘
                        │ build output + build manifest (routes, hashes)
        ┌───────────────▼────────────────────────────────────────────────────────┐
        │  LAUNCH QA GATE                                                        │
        │  artifact bundle per page → ~110 checks → GateReport (scoreDisplayMode)│
        │  Playwright project matrix · axe full tags · LHCI budgets · our ~40    │
        │  repair: substitute → regenerate copy → fail ; done-gate on doc hash   │
        └───────────────┬────────────────────────────────────────────────────────┘
                        │ green
        ┌───────────────▼──────────┐   ┌──────────────────────┐   ┌────────────────────┐
        │  PUBLISH                 │   │  CLIENT SURFACES     │   │  TELEMETRY         │
        │  site_versions row       │──▶│  "why your site      │   │  event contract    │
        │  pinned ds@ver ad@ver    │   │   looks like this"   │   │  pooling, priors   │
        │  playbook@ver lib@sha    │   │  Gap Report          │   │  promotion/demotion│
        │  never auto-migrate      │   │  gate report PDF     │   │  diversity ledger  │
        └──────────────────────────┘   └──────────────────────┘   └────────────────────┘
```

**Packages (four, per the strategy doc):**

| Package | Contents | Borrowed mechanisms |
|---|---|---|
| `contract` | Zod SiteDefinition, FactRegistry types, predicate parser/evaluator, JSON-schema generation, migrations | SchemaTriad, TypedBlockUnion, FlatIdDocument, OrderedDataMigrations |
| `pipeline` | state machine, stages, model-call wrapper, assembly, anti-slop, manifest, gap report | EventSourcedRunState, GuardrailRetryLoop, InterruptResume, DoneVerificationGate, LayeredPromptDirectories |
| `library` | section variants (.astro), arrangements, design systems, art directions, playbooks, archetypes, positioning, motion registry, token compiler | RegistryItemContract, DtcgTokenFile, SeedMapAlias, RecipeAsData, ConditionTable, VersionedMotionState |
| `gate` | Playwright specs, artifact bundle, check registry, GateReport, LHCI config, axe policy, reference renders | ArtifactAuditSplit, ScoreDisplayModeEnum, ReferenceRenderBaseline, StructuralA11yTemplate, NetworkAllowlistGate |

Split only when a boundary hurts.

---

## 5. Agent architecture

**Verdict from the seven agent frameworks: do not adopt one.** The pipeline is a linear
DAG with four constrained model calls and one optional explorer. What the frameworks
contribute, in order of value:

```
PipelineState (Zod, per-key reducers)
  facts, predicate_snapshot, eligible: {positions, archetypes, systems, ads, variants, arrangements}
  playbook@ver, positioning, creative_direction, beats[], arrangements[], site_definition
  gate_report, manifest, gap_report, cost_usd, model_calls, status

Run row: { run_id, site_id, stage, status, checkpoint(jsonb), cost_usd, iterations, created_at }
status ∈ IDLE | RUNNING | WAITING_FOR_OWNER | WAITING_FOR_REVIEW | FINISHED | ERROR | STUCK | BUDGET_EXCEEDED

Event log (append-only, parent_id): StageStarted, StageCompleted, ModelCallRequested{schema_hash},
  ModelCallReturned{cost, finish_reason}, GuardrailFailed{code, attempt}, SubstitutionApplied{from,to,reason},
  GateRan{report_hash}, OwnerInterrupted{question}, OwnerResumed{answer}, LimitReached{kind}
```

**Stages** (each a pure function `(state) => state` except the four model nodes):

1. `ingest` → 2. `evaluate_predicates` → 3. `playbook` → 4. `positioning` (**interrupt** if
   undeclared; resumes with the owner's answer on the same run id) → 5. `creative_direction`
   (model) → 6. `compat_filter` → 7. `beat_selection` (model; **Send fan-out**: one call
   per beat in parallel, merged by beat id) → 8. `arrangement` (model, fan-out) →
   9. `assemble` → 10. `populate` (model: copy on leash, fan-out per slot group) →
   11. `anti_slop` → 12. `render` → 13. `gate` → 14. `manifest` → 15. `gap_report` →
   16. `publish` (**confirm-gated**: ends the turn as a proposal).

**Model-call wrapper (one implementation, used by every model node):**

```
input:  eligible set E, prompt fragments (layered dirs: base → niche → archetype → positioning), seed
schema: strict JSON Schema generated from E (enums are exactly the eligible ids)      [SchemaTriad]
memo:   key = hash(E, prompt fragments, seed, options); model id excluded             [DomShapeKeyedMemo]
loop:   safeParse → coerce toward E (record every coercion) → re-ask with codes (≤2)
        → deterministic fallback (fallback variant / service_clarity)                 [GuardrailRetryLoop]
stuck:  same rejected id proposed twice → terminate, substitute                       [LoopSignatureDetector]
limits: per-run max model calls AND max USD; either → BUDGET_EXCEEDED event            [DualBudgetGuard]
audit:  one GenerationAuditRow per call (provider, model, prompt hash, output hash, cost, duration, finish_reason)
```

`finish_reason == length` is a hard failure, never a partial accept.

**Playbooks as triggered knowledge:** each playbook YAML declares `triggers: {keywords[],
niches[]}` and is injected only when a trigger fires; per-niche and per-archetype prompt
overrides resolve through ordered directories with include-original semantics. Drift review
writes to `/_proposed/`; a human lands it.

**Human-in-the-loop points, all typed:** positioning (owner), blocking Gap Report entries
(owner), `needs_review` gate rows (reviewer), publish (owner or agency), any `/_proposed`
asset (agency). The model has no tool that can publish, change positioning, or land an
asset.

**If a library is wanted:** LangGraph.js (`@langchain/langgraph` with the Postgres
checkpointer) is the only TypeScript-native option and maps one-to-one onto the above.
Estimated cost of hand-rolling instead: 300–500 lines for the machine, ~800 with the
wrapper, budgets and event log. Recommendation: hand-roll for V1; the schema is the
valuable part and it is identical either way.

**Explorer pass (optional, post-V1, warning-only):** a Stagehand-style `observe()` on the
reference render resolves a natural-language user journey ("book an appointment from the
mobile home page") into `Action[]` with `data-sd` selectors once at library authoring
time; the gate replays deterministically; inference is entered only on replay failure and
the outcome is labelled. Playwright MCP in accessibility-snapshot mode is the cheapest way
to run it.

---

## 6. Data model

Relational core with JSONB documents; the Zod contract is the single source from which
JSON Schema, DB column types and generated TypeScript are derived (Keystone's
"code schema prints DB schema" direction, never the reverse).

```
sites            { site_id, tenant_id, niche, positioning, published_version_id, created_at }
site_versions    { version_id, site_id, parent_version_id, site_definition(jsonb), manifest(jsonb),
                   gap_report(jsonb), gate_report_id, status: draft|published|archived,
                   pinned: {design_system, art_direction, playbook, library_sha, gate_policy_ver},
                   schema_version, created_by: pipeline|owner_edit|migration, created_at }
                   -- drafts never touch the published row (Payload _versions shape)
facts            { fact_id, site_id, path, value(jsonb), provenance(jsonb), quotable, verification, created_at }
fact_sources     { source_id, site_id, url, final_url, status_code, fetched_at, etag, content_hash,
                   extraction_schema_id, citations(jsonb) }            -- Crawl4AI CrawlResult shape
assets           { asset_id, site_id, path, width, height, aspect, rights, subject_consent, tags[],
                   grade_safe, alt, placeholder_data_uri, graded_variants(jsonb) }
runs             { run_id, site_id, version_id, stage, status, checkpoint(jsonb), cost_usd, iterations, seed }
run_events       { event_id, run_id, parent_id, kind, payload(jsonb), ts }
model_calls      { call_id, run_id, stage, provider, model, schema_hash, prompt_hash, output_hash,
                   cost_usd, duration_ms, finish_reason, attempts, guardrail_codes[] }
gate_reports     { report_id, version_id, policy_ver, checks(jsonb[]), summary, created_at }
edit_actions     { action_id, version_id, seq, action(jsonb), inverse(jsonb), txn_id, actor, ts }   -- post-V1 editor
telemetry_events { event_id, site_id, version_id, kind, section_instance_id, props(jsonb), ts }    -- first-party, consent-gated
priors           { arrangement_id, stratum(jsonb), status, evidence(jsonb), window, updated_at }
diversity_ledger { window_start, key, value, share }
```

**SiteDefinition (Zod), abbreviated:**

```ts
SiteDefinition = {
  schema_version: number,
  site: { id, niche, positioning, locale },
  pinned: { design_system: "id@ver", art_direction: "id@ver", playbook: "id@ver", library: sha },
  pages: Record<page_id, {
    route, archetype, seo: {...}, order: instance_id[],
    sections: Record<instance_id, SectionInstance>
  }>,
  assets: Record<asset_id, AssetRef>,
  legal: {...}
}
SectionInstance = z.discriminatedUnion("family", [...]) & {
  instance_id, variant_id, arrangement_id, schema_version,
  slots: Record<slot, { kind: "fact", fact_id } | { kind: "generated", text, grounded_in: fact_id[] } | { kind: "asset", asset_id }>,
  motion: MotionProfileRef, computed: { intensity, focal_weight, density }   // written by assembly, read by gate
}
```

Rules enforced by the invariant runner (path-addressed hooks, accumulate all violations):
every `generated` slot's numbers/names/dates/quotes resolve to `quotable: true` facts;
every asset `rights != unknown`; every portrait `subject_consent`; every variant's
`requires` satisfied by the predicate snapshot; single art direction per site; no
cross-tenant ids.

**Library manifest (per variant/arrangement), a superset of the shadcn registry item:**

```yaml
name: hero/founder-editorial          # family/variant
type: section:variant
schema_version: 3
files: [{ path: hero/FounderEditorial.astro, type: section }]
dependencies: []                       # npm, must be on the allowlist
registryDependencies: [island:zag-tabs] # islands/effects this variant may pull in
cssVars: {}                            # side-effects, merged at assembly
budget: { js_kb_gz: 0, main_thread_ms: 0 }
a11y_template: hero/founder-editorial.aria.yml     # toMatchAriaSnapshot partial
reference_renders: [ {design_system, project, path} ]
meta: { signature_move, negative_example, authoring, grade, requires, enhanced_by, design_compat, composition, motion, priors, arrangements[] }
```

---

## 7. Design genome

The genome is four addressable layers, all selected by id, none emitted by the model.

### 7.1 Design system (tokens)

Authored as DTCG-shaped YAML (Carbon): `$type`, `$value`, `$description`,
`$extensions.agency.{schemes, properties, state}`. Compiled once at build to a static
`tokens.css` layer per design system:

```
seeds (antd)            accent hue, neutral temperature, base font size, unit, radius base, motion switch
  ↓ algorithms          palette: HSV 10-step w/ hue-band rotation (antd generate()) or color-mix derivation (coss)
                        type scale: base·ratio^i (v4) or base·e^(i/5) (antd), fluid clamp() per breakpoint (Carbon)
                        spacing: unit × steps; radius scale; elevation system
                        contrast: on-colour computed at compile time with WCAG ≥ 4.5 assertion (Mantine/MUI augmentColor)
  ↓ semantic roles      bg.base, bg.raised, fg.primary, fg.muted, accent.bg, accent.fg, border.hairline
                        role = index into generated palette (antd RoleIndexTable) → hue_adaptable for free
  ↓ conditions table    _dark, _highContrast, _forcedColors, _motionReduce, _touch, _print  (Chakra/S2)
                        each semantic token: value: {base, dark, forced_colors}
  ↓ recipes             family visual variants as {base, variants, defaultVariants, compoundVariants} (Chakra)
  ↓ emit                --ds-<path> custom properties + channel tokens (r g b) for tints (MUI), scheme selector strategy
                        @layer reset < base < tokens < recipes; reduced-motion kill switch in the same file (coss)
```

`visual_dna` (composition_family, typography_voice, visual_energy, motion_language) is the
model-facing surface. The `design_system_id` is a versioned, decodable preset code over
append-only axes (shadcn BitPackedPresetId): the id *is* the specification, and two ids
can be diffed.

### 7.2 Art direction

As in v4 §4, plus: grade variants keyed by condition (`_dark` may switch LUT), posters for
`no_photo_fallback` baked at library time, `forbids` photo tags checked against ingest
classifier tags, `crop_grammar` checked against actual rendered aspect.

### 7.3 Motion (replaces v4 §9 budget numbers for WebGL)

Motion is data, compiled to one of two runtimes; the model never writes an animation.

```
motion registry (closed vocabulary, ~10 named effects, each with declared max gz bytes and allowed properties)
  reveal-fade, reveal-lines (SplitText, aria-safe), counter, parallax-subtle, pin-scroll-story, flip-reorder, ...
  properties allowed: opacity, transform, clip-path only (compositor-threaded)              [Motion One rule]

motion profile per arrangement (versioned JSON, Theatre shape: definitionVersion, tracks by sectionId.role.property)
  pattern ∈ registry ∩ design_system.pattern_allowlist
  trigger, budget_ms, density, stagger_ms, toggle_actions: 4-slot enum (GSAP grammar)
  reduced_motion_fallback: semantics not a flag (Lenis): programmatic→instant, gesture→1:1, loop→poster
  main_thread_ms_est: measured at library build

compile target
  tier A  motion/mini + inView (~10.5 kB gz)            reveal, scroll-linked opacity/transform; CSS animation-timeline where supported
  tier B  GSAP core + ScrollTrigger (46.5 kB gz)         pinning, labelled timelines, SplitText; gsap.matchMedia contexts w/ revert
  tier C  WebGL island: OGL/raw shader ≤ 15 kB gz        ≤1 per site, below fold, intersection lazy-mount, poster stays until first frame,
                                                          demand frame loop, dpr token clamp, quality governor, GPU-tier predicate
  tier 0  pre-rendered WebM/AV1 + poster (0 kB JS)       default for ambient/abstract; baked with three.js at library time

page budget: total_js_kb ≤ 180 (LHCI), motion main_thread ≤ 120 ms, non-composited-animations = 0, mean density ≤ 0.35
static guarantee: @media (prefers-reduced-motion: reduce) rules exist in tokens.css independent of JS
```

Ban list additions from the corpus (tier 1): smooth scroll (Lenis), infinite Lottie loops,
floating 3D blobs (drei `Float`), orbiting primitives, cursor-follow, 3D text, Spline glass
scenes, everything-fades-up-on-scroll, shimmer/gradient text, marquee logo clouds, bento
grids, border beams, meteors, sparkles, lamp, aurora, spotlight, typewriter headlines,
globe, pattern backgrounds.

### 7.4 Layout genome

Unchanged from v4 §8 (variant × arrangement with `asset_constraints`), plus: each
arrangement carries an ARIA partial template and a reference render per design system per
device project, its manifest declares `registryDependencies` for islands and effects, and
its motion profile is a versioned JSON document. A ts-morph import scan verifies the
manifest against the `.astro` source in CI (MagicUI's `--check`).

---

## 8. Anti-slop engine

v4's three tiers stand. The research adds a tier 0, hardens tier 1 with measured corpora,
and adds mechanical checks that no prompt can defeat.

**Tier 0 — library entry (human, once).** `signature_move` and `negative_example`
required; rubric at both content extremes; ≥2 reviewers; ELO within family; min
arrangements per family. A variant that cannot name one non-obvious decision is rejected.
Nothing downstream can add quality; it can only remove failure.

**Tier 1 — deterministic bans (blocking), now sourced from real corpora:**

| Source harvested | What it yields |
|---|---|
| Aceternity public registry (284 items, 169 depend on `motion`) | effect-name and class-fingerprint ban list: `conic-gradient` + `blur-3xl` stacks, `animate-*` names, `tsparticles`/`three` deps |
| MagicUI (78 items, 32 need `motion`, 5 honour reduced motion) | same, plus zero-JS keyframe ports that are *allowed* if parameterised by CSS vars |
| Tutorial builder prompts (AI-first-Builder, Ratna-Babu, powerhouse) | literal utility-class bans: `from-indigo-500 via-purple-500 to-pink-500`, `backdrop-blur`, glassmorphism, `hover:scale-105`, gradient text |
| Motion/3D idioms | the §7.3 ban list |

Mechanical tier-1 checks added: **PaletteConsistencyCheck** (only the selected design
system's token values may appear in rendered CSS; zero foreign hex); **ImportHostAllowlist**
(any `<script src>`, `<link href>`, `url()` or import outside the pinned allowlist fails
the build); **ungraded_asset** (rendered image hash ∉ graded set); **reduced-motion
assertion** (project with `reducedMotion: 'reduce'` finds zero running animations);
**per-effect byte ceiling** (each pattern id's measured gz bytes ≤ declared); **structural
DOM rules expressed as axe-style rules** (`{selector, matches, any/all/none}`): icon-card
triplet, centred twin-CTA hero without media, emoji bullets, three consecutive same-density
sections, no focal moment, no signature section. Rule pack is versioned with fatal/warning
classes; `canShip = !hasFatal` (Ghost gscan).

**Tier 2 — semantic cliché judge (warning only).** Unchanged: generated copy only, output
to `/_proposed/anti-slop-bans.jsonl`, human promotion to tier 1.

**Tier 3 — self-cliché detector (blocking, no model).** Unchanged n-gram method, plus a
**DOM fingerprint** per page (`section_sequence_hash`, per-section text hash) across the
last 100 builds: a section sequence or a hero text shape appearing in >6% / >15% of builds
is flagged (browser-use PageFingerprint idea, applied to our own output). Feeds the
diversity ledger.

**Repair order on a blocking hit:** substitute from `eligible[]` → regenerate copy →
fail the build. Never relax `requires`. Repeat proposal of a rejected id terminates the
call (stuck detection).

---

## 9. Explainable design engine

Rationale is a projection over data the pipeline already recorded. No model narrates a
decision; a model may summarise the manifest and the summary is marked non-authoritative.

```
inputs (all already persisted)
  predicate snapshot           { predicate, actual, result } per gate           → "Transformation needs 4 before/after pairs; you provided 1."
  eligible sets per stage      ids in / ids out with the failing predicate       → ruled_out[]
  playbook + positioning boosts numeric influence per candidate                   → influenced_by
  model call record            schema_hash, attempts, guardrail_codes[], memo hit → "chosen from 3 eligible; first attempt valid"
  seed                         integer                                            → reproducibility claim
  substitutions                { from, to, reason_code }                          → "swapped proof-quote-lead for proof-licence-bar: rhythm_profile_breach"
  gate report                  check id → status, evidence                        → "63 checks, 4 repaired, re-verified green"
  pinned versions              ds@ver, ad@ver, playbook@ver, lib@sha              → "built with editorial_v3@3.1"

projections
  build-rationale.json         full manifest (v4 §16 shape) + typed codes
  client page                  templated sentences per decision; ruled-out lines double as Gap Report unlocks, ordered by impact
  gate report PDF              from the same JSON (react-pdf / Satori pattern)
  reviewer view                needs_review rows with axe incomplete reason → specific human task
```

Two properties make it trustworthy: every sentence is a template over a recorded value,
and every model call is memoised on the eligible-set hash, so re-running the manifest
re-derives the same decisions.

---

## 10. Autonomous QA loop

Built from the 125-row inventory in `notes/gate-checklist.md` (~110 distinct ids, ~85
deterministic, ~40 written by us).

```
1  BUILD CHECKS (no browser)         invariant runner, JS budget per page from build manifest, allowlists,
                                     duplicate titles, canonical uniqueness, sitemap/robots/llms.txt, schema.org validation,
                                     placeholder scan, every route from SiteDefinition (no crawl needed)
2  ARTIFACT BUNDLE per page          Playwright project matrix: desktop-chrome, mobile-safari, tablet,
   (gather once, check many)         reduced-motion, dark; after document.fonts.ready
                                     DOM snapshot · ARIA snapshot · axe JSON (full tags) · console/pageerror log ·
                                     network log (allowlist, failures, bytes) · screenshots (stabilised, masked dynamic slots)
                                     · form submit trace → thank-you reachability · tab-order walk · focus-visible captures
3  CHECKS = pure fns(bundle)         Lighthouse Audit contract: {id, title, failureTitle, requiredArtifacts, scoreDisplayMode}
                                     status ∈ binary | numeric | manual | informative | notApplicable | error ; plus needs_review (axe incomplete + reason)
                                     severity mapped critical/serious/moderate/minor → weight 10/7/3/1
4  VISUAL                            toHaveScreenshot vs library-time reference render keyed (arrangement, design_system, project)
                                     toMatchAriaSnapshot vs the variant's authored partial template (contain semantics)
5  PERF (only flaky stage)           LHCI: resource-summary assertions hard; LCP/TBT/CLS median of 3 serial runs on one representative
                                     per archetype × arrangement group (Unlighthouse sampling, deterministic not random)
6  REPORT                            GateReport rows {id, status, impact, target[], evidence, screenshot_ref}; Playwright JSON reporter
                                     steps = checks; null on any errored weighted check ⇒ fail closed
7  REPAIR LOOP                       classify failure → substitute from eligible[] → regenerate copy → fail
                                     re-render only pages whose HTML hash changed (per-page cache keyed by hash + policy version)
                                     verify-the-render: after every substitution assert the new section is present by data-sd-id
                                     stuck: same substitution twice → stop
8  DONE GATE                         publish refused unless current SiteDefinition hash == hash the green report was produced for
9  HUMAN                             needs_review rows and manual checks (focus visibility screenshots, reading order, alt meaning)
                                     recorded in manifest with reviewer id before publish
```

Adopt directly: Playwright, `@axe-core/playwright`, Lighthouse + `@lhci/cli`. Ignore
pa11y. Adapt Unlighthouse scheduling and report columns. Explorer pass (Stagehand-style
observe→replay, Playwright MCP) is post-V1 and warning-only.

---

## 11. Competitive moat analysis

### What each competitor structurally cannot do

| Capability | Lovable / Bolt / v0 | Framer / Webflow | Traditional agency | This system |
|---|---|---|---|---|
| Refuse to render a claim without evidence | No (hallucinated testimonials, Unsplash ids) | No (designer's judgement) | Sometimes (account manager) | Predicate-gated, non-overridable |
| Tell the owner what to provide to unlock a better site | No | No | Verbally, unevenly | Gap Report, ordered by impact |
| Explain every design decision from recorded facts | Model narration | No | Deck, after the fact | Manifest from predicate snapshot |
| Guarantee no AI-generated people / stock substitution | No | N/A | Policy | `never:` rule + graded-asset check |
| Reproduce the same site from the same inputs | No (temperature) | Manual | No | Seeded, memoised, pinned |
| Detect its own emerging clichés | No | N/A | No | Tier 3 n-gram + DOM fingerprint |
| Never restyle a live client when the design language changes | N/A | Global style changes propagate | Manual | Pinned versions, opt-in migration |
| Promote layouts on measured evidence | No | No | Anecdote | Thresholded, pooled priors |
| Ship ≤180 kB JS with a motion budget by construction | No (Tailwind CDN, Alpine, AOS) | Partially | Varies | Budget is a gate assertion |
| 60+ deterministic checks before "done" | Preview health at best | Publish button | QA checklist | Gate report is the deliverable |

### Where the moat actually is

The moat is not any single mechanism; most are a few hundred lines each and this report
tells anyone how to build them. The moat is three compounding assets that take time and
cannot be prompted into existence:

1. **The human-authored section library** with signature moves, negative examples,
   reference renders and ARIA templates, graded within family. Weeks 3–6 are the product.
   Competitors have component libraries (SaaS-shaped, effect-heavy); nobody has an
   authored arrangement library for local-service trust signals.
2. **The priors dataset.** Once `measured` arrangements exist per niche × positioning ×
   device, every new site benefits from every previous one, and the data cannot be bought.
3. **The niche playbooks and ban lists**, versioned, reviewed, and grown from the
   system's own tier-2 flags and drift reviews.

### Honest weaknesses

- Library authoring is expensive and slow; eight families × 3–5 arrangements × two
  reviewers is the critical path and cannot be parallelised with models.
- Priors are cold for a year or more; cross-business pooling is confounded; early "measured"
  claims must be resisted.
- Niche breadth is bounded by playbook authoring; a competitor with a generic generator can
  claim any vertical on day one.
- The visual editor is post-V1; owners used to Framer/Webflow will notice.
- The constraint model produces *correct* sites by construction; it produces *great* sites
  only where the library is great. Tier 0 is the whole game.

### Positioning that follows

Not "AI website builder". The demo is the gate report and the manifest: N checks, M
failures caught and repaired, re-verified green, and a page that says why every section is
there and what the owner can provide to change it.

---

## 12. Decisions this research forces (action list)

| # | Decision | Owner of the change | Where |
|---|---|---|---|
| 1 | Section authoring language = `.astro`; editor = overlay over Astro render with `data-sd-path` stamping | strategy §2, schema §8 | before Week 3 |
| 2 | Rewrite WebGL budget: live WebGL ≤ 15 kB gz (OGL/raw shader) or pre-rendered WebM; three.js library-time only; poster fallback and GPU-tier predicate mandatory | schema §9 | Week 1 (schema) |
| 3 | Store = Postgres + Drizzle + Zod JSONB with `site_versions` shadow table; no CMS in V1 | strategy §2 stack | Week 1 |
| 4 | Orchestration = hand-rolled checkpointed state machine (~800 lines) or LangGraph.js; no Python runtime | strategy §2 | Week 1 |
| 5 | Two-tier motion runtime (`motion/mini`+`inView`, GSAP for pin/timeline/SplitText); closed effect registry with byte ceilings | schema §9 | Week 3–6 |
| 6 | Islands: native elements first, `@zag-js/vanilla` over SSR markup, react-aria only inside React islands; `data-state` vocabulary required | schema §8 a11y | Week 3–6 |
| 7 | Token files DTCG-shaped with seeds + algorithm ids + conditions table; compile to static CSS; `design_system_id` is a decodable preset code | schema §3 | Week 3–6 |
| 8 | Gate = Playwright + axe (full tags) + LHCI resource budgets + ~40 own checks; pa11y out; perf gates on median-of-3 per group representative | strategy §4 Week 2 | Week 2 |
| 9 | Per-build strict JSON Schema from eligible sets for all model calls; memo on eligible-set hash; seed recorded | schema §13 | Week 1 |
| 10 | Licence policy: no AGPL/GPL/FSL/MSCL/proprietary code in deliverables; GSAP accepted for sites, re-review for editor | strategy §2 | now |
| 11 | Tier-1 ban corpus harvested from Aceternity/MagicUI registries and tutorial prompts; motion/3D idiom bans added | schema §14 | Week 2 |
| 12 | Reduced motion: CSS rule in every token file + gate project; never a component contract | schema §9, §14 | Week 2 |
| 13 | Library manifest = superset of shadcn registry item; ts-morph import check in CI; reference render + ARIA template per arrangement | schema §11 | Week 3 |
| 14 | Add post-launch items to launch checklist: Search Console, business listings, llms.txt (karero) | strategy §4 | Week 8 |

---

## Appendix A — Repository status corrections to `repo list.txt`

| Listed | Actual | Note |
|---|---|---|
| blocks/blocks-ui | blocks/blocks | 404; real repo is abandoned 2020 alpha, renovate-bot pushes only |
| shadcnblocks/aceternity-ui | (none) | No open-source repo exists; analysed from ui.aceternity.com public registry |
| origin-space/originui | cosscom/coss | Now Cal.com's design system, AGPL-3.0; legacy Origin UI frozen under `apps/origin` (MIT) |
| OpenDevin/OpenDevin | OpenHands/OpenHands | Same repository as All-Hands-AI/OpenHands; now "Agent Canvas", Python core moved to `OpenHands/software-agent-sdk` |
| frdel/agent-zero | agent0ai/agent-zero | Redirect |
| measuredco/puck | puckeditor/puck | Redirect |
| motiondivision/motionone | archived | Successor is `motion/mini` in motiondivision/motion |
| microsoft/autogen | maintenance mode | Microsoft redirects to Agent Framework; code MIT via LICENSE-CODE |
| theatre-js/theatre | dormant | 1.0 moved private; no public push since 2024-08 |
| TransformerOptimus/SuperAGI | dormant | Last push 2025-01 |
| tremorlabs/tremor | frozen | Since Vercel acquisition, last push 2025-10 |
| directus/directus | licence changed | MSCL 1.0 with runtime entitlement keys, not BSL |
| greensock/GSAP | licence changed | Proprietary no-charge "Standard License" (2025-04-30), all plugins free; no LICENSE file in repo |

## Appendix B — Files in this research package

- `repos/*.json` — 65 per-repository analyses (schema in `ANALYST-BRIEF.md`)
- `repo-analysis.json` — aggregate array, sorted by category then stars
- `REPO-MATRIX.md` — one-line matrix with recommendation, novelty, difficulty
- `notes/gate-checklist.md` — 125-row consolidated gate inventory (tool → check id → detects → deterministic? → policy)
- `raw/<owner>__<repo>/` — metadata, README, tree, manifests as fetched 2026-09-23
- `aggregate.py`, `fetch.sh`, `repos.txt` — reproducible tooling
