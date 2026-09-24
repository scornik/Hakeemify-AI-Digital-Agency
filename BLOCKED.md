# Blocked — decisions an agent must not settle

None of these halted a milestone. P0–P6 are complete and green without them, because every one
is a decision about a **real client build**, and everything built so far is exercised by a
fixture. They are recorded here because ARCHITECTURE §11 says explicitly: *"Genuinely unresolved.
Do not let an agent settle these silently."* Where a value was needed to make code run, a
placeholder was used and is named below.

---

## [P6] V1 niche — 2026-09-23

**What I was doing:** building the end-to-end fixture, which needs a niche playbook.

**What I need decided:** which niche V1 actually targets.

**Options I see (with the trade-off of each):**

- **A visual-outcome trade** (roofing, renovation, dental, detailing). Unlocks the
  `transformation` archetype and the full rhythm curve, which is what makes output look
  deliberate rather than merely correct. Needs real before/after photo pairs in hand.
- **Law or another proof-poor profession.** Strong domain knowledge, but client confidentiality
  and bar advertising rules mean the eligibility engine emits mostly fallbacks. An excellent test
  of the fallback path, a poor first impression.
- **Split them:** build for the distribution niche, demo on the visual one.

The decision rule from the strategy document still holds: pick the niche where real facts and
real photos can be obtained *this month*. Asset availability is the bottleneck, not domain
knowledge.

**What I did instead:** used `roofing` as the **fixture** niche only. It is not a product choice;
the playbook lives in `packages/pipeline/src/e2e/fixture-assets.ts`, outside the library's
`assets/` tree, precisely so it cannot be mistaken for an authored one.

**Blocks:** authoring the first real niche playbook; the first client build.

**Files touched:** `packages/pipeline/src/e2e/fixture-assets.ts`,
`packages/pipeline/src/e2e/fixture-business.ts`.

---

## [P4] Model provider, routing per call type, and the per-run USD ceiling — 2026-09-23

> **Partly decided by the owner, 2026-09-24.** Not one provider: a router over several —
> OpenRouter as an aggregator, plus Anthropic, OpenAI and other hosted providers directly, plus
> local models (Ollama and similar). The `ModelProvider` interface already permits this
> unchanged; what it adds is a **routing table keyed by call type** and a **fallback order**,
> which is now the design work rather than a procurement question.
>
> Still open, and still owner-only: (a) which model answers each of the four call types — the
> three enum selections are cheap and structured, copy is the only one where quality shows;
> (b) the per-run ceiling. A ceiling in dollars alone stops meaning anything once a local model
> can answer a call for $0.00 but take ninety seconds, so this likely becomes a
> `{ max_model_calls, max_cost_usd, max_wall_clock_ms }` triple.
>
> One name from the owner's list I could not map to a provider with confidence, so I have not
> guessed at it: "Xkiro", "jev" and "lay ai" need to be spelled out before they go in a routing
> table.

**What I was doing:** implementing the model-call wrapper and its dual budget guard.

**What I need decided:** which provider and model answers each of the four constrained calls, and
what a single build may cost.

**Options I see:** the wrapper is provider-agnostic by design — `ModelProvider` is a one-method
interface, and the memo key deliberately excludes the model id so a provider change does not
silently re-decide anything already decided. The open questions are commercial, not technical:
which provider, whether the three enum-selection calls and the copy call use the same model (the
selections are cheap and structured; copy is the only one where quality shows), and what ceiling
makes a failed build cheap enough to be worth retrying.

**What I did instead:** `DEFAULT_BUDGETS = { max_model_calls: 24, max_cost_usd: 2 }` in
`packages/pipeline/src/state.ts`. That is a **placeholder that makes tests deterministic**, not a
costed figure. Every test uses the deterministic fake in `src/model/fake.ts`; no real provider has
ever been called by this code.

**Blocks:** any build that is not a fixture.

**Files touched:** `packages/pipeline/src/state.ts`, `packages/pipeline/src/model/wrapper.ts`.

---

## [P5] Hosting target for generated sites — 2026-09-23

> **Decided by the owner, 2026-09-24.** Vercel and comparable free static hosts as the primary
> target, plus Hostinger, including a Node application where a host needs one. That is more than
> one target, so the answer is a **deploy adapter per target** rather than a single assumption:
> each one owns its redirect and 404 mechanism, its header policy, and whether assets are served
> from the same origin.
>
> Still open, and it is a real decision rather than a detail: the gate's transport rows
> (`is-on-https`, `has-hsts`, `csp-xss`, checklist 79–80) assert headers, and headers are set
> differently on each host — `vercel.json`, an `.htaccess`, or Express middleware. Those checks
> stay `notApplicable` until at least one adapter exists to assert against.

**What I was doing:** the Astro renderer and its build output.

**What I need decided:** where a built site is deployed. ARCHITECTURE §11 assumes Cloudflare
Pages but does not settle it.

**Options I see:** the renderer emits a plain static directory (`dist-site/`) plus
`_ada/build-manifest.json`, so any static host works. What the decision actually changes is
downstream: the redirect and 404 mechanism, the header policy the gate's transport checks
(`is-on-https`, `has-hsts`, `csp-xss`) will assert, and whether image assets are served from the
same origin, which the allowlist check reads.

**What I did instead:** kept the output host-agnostic and left the transport rows of the gate as
`notApplicable` on a local build — they require a deployed origin.

**Blocks:** the transport and header checks in the gate (`gate-checklist.md` rows 79–80); the
launch stage.

**Files touched:** `packages/library/scripts/build-site.mjs`, `packages/gate/src/policy.ts`.

---

## [P5] Whether tier C WebGL ships in V1 at all — 2026-09-23

**What I was doing:** the motion registry and the scaffold sections.

**What I need decided:** whether any V1 arrangement may run live WebGL.

**Options I see:** ARCHITECTURE §1.1 already reduces tier C to a ≤ 15 kB gzip OGL or raw-shader
plane, below the fold, lazy-mounted, poster until first frame. Tier 0 (a pre-rendered WebM loop
with a poster, 0 kB JS) may well cover every V1 arrangement, and dropping tier C would remove a
whole class of gate flakiness — GPU tier detection, `gl.compile` timing, and the poster-crossfade
assertion all disappear.

**What I did instead:** the motion registry defines all four tiers, and every scaffold is
`tier_0`. Nothing in the build has ever exercised tier C, so removing it later costs one registry
entry and one gate check.

**Blocks:** nothing today. It blocks the first arrangement that wants a live shader.

**Files touched:** `packages/library/assets/motion/registry.yml`,
`packages/library/src/motion/registry.ts`.
