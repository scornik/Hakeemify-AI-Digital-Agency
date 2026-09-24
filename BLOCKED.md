# Blocked — decisions an agent must not settle

None of these halted a milestone. P0–P6 are complete and green without them, because every one
is a decision about a **real client build**, and everything built so far is exercised by a
fixture. They are recorded here because ARCHITECTURE §11 says explicitly: *"Genuinely unresolved.
Do not let an agent settle these silently."* Where a value was needed to make code run, a
placeholder was used and is named below.

---

# Part 1 — Decided by the owner

## [P6] V1 niche → **doctors / medical practice** — decided 2026-09-24

The owner is building an appointment app for doctors, so the site product and the app share a
customer. That is the right reason to pick a niche: distribution, not domain interest.

**What this unblocks:** the first real playbook at `assets/playbooks/`, and with it the first
client build.

**What it costs, stated plainly, because it is the harder of the two niches I laid out.**
Medicine is the proof-poor case. The strategy document's own decision rule was *pick the niche
where real facts and real photos can be obtained this month*, and a medical practice has fewer of
both than a roofer:

- **Patient testimonials are restricted or prohibited.** In the UK the GMC's advertising guidance
  and ASA/CAP rules constrain them; several US state boards and most EU regulators go further.
  The Fact Registry already carries a `quotable` flag and the invariant engine already refuses an
  ungrounded claim — but neither knows that a *grounded, accurate* testimonial can still be
  disallowed. That is a new class of constraint, not an existing one.
- **Outcome claims are the regulated core of the domain.** "Faster recovery", "success rate",
  "best in the city" are exactly the phrases a slop engine reaches for, and exactly the ones that
  attract a regulator.
- **Photography is people, which means consent.** Staff portraits need releases; anything that
  could identify a patient needs much more.
- **The `transformation` archetype — before/after — is the one that makes output look
  deliberate, and it is the one medicine can least often use.** Expect the eligibility engine to
  fall back more often than it did on roofing. That is the system working; it will look plainer.

**What a human must still author, and I must not:** the playbook itself, and the honesty
constraints for the jurisdiction the first client practises in. Which regulator applies —
GMC/CQC, a US state board, an EU competent authority — changes which claims are eligible, and I
have no way to derive it. Name the jurisdiction and I can encode the constraints; I cannot choose
it, and I should not guess at medical advertising law.

**Placeholder in the repo, unchanged:** `roofing`, fixture-only, in
`packages/pipeline/src/e2e/fixture-assets.ts`.

---

## [P4] Per-run ceiling → **configurable, minimum default** — decided 2026-09-24

**Implemented.** `resolveBudgets()` in `packages/pipeline/src/state.ts` resolves the ceilings for
each run: an explicit override wins, then the environment, then the default.

```bash
ADA_MAX_COST_USD=10 ADA_MAX_MODEL_CALLS=100 pnpm e2e:fixture
```

Two decisions inside that are mine and worth contesting if you disagree:

**The default is the smallest ceiling a real build fits under, not a costed figure**:
`{ max_model_calls: 24, max_cost_usd: 0.50, max_wall_clock_ms: 300_000 }`. A default is what runs
when nobody thought about it, so it should make a runaway cheap. A fixture build makes three
calls and spends about $0.003. Raise it per run; do not raise it here.

**There is now a third ceiling, because of the local-model decision below.** A dollar ceiling
stops guarding anything the moment Ollama answers a call: the run spends $0.00 and can still hang
forever. Cost and time are different resources and each needs its own bound.

**A malformed value throws.** `ADA_MAX_COST_USD=ten` is an error, not a silent fall back to the
default — an operator who believes they raised the ceiling and did not is the one outcome a spend
guard must not produce.

---

## [P4] Model provider → **a router, not a provider** — decided 2026-09-24

OpenRouter as an aggregator, hosted providers directly (Anthropic, OpenAI), and local models
(Ollama and similar). `ModelProvider` is a one-method interface and needs no change; what this
adds is a **routing table keyed by call type** and a **fallback order**.

**Still open, and still owner-only:**

- **Which model answers each of the four call types.** The three enum selections are cheap and
  structured — a small local model may be enough, and every one of them is memoised. Copy is the
  only call where quality is visible to a client. Routing them all to the same model wastes money
  on the selections or quality on the copy.
- **Three names from the owner's list I could not map to a provider, and did not guess at:**
  "Xkiro", "jev", "lay ai". Spell these out before they go in a routing table.

**Note on the memo key:** it deliberately excludes the model id, so changing which model answers
a call does not silently re-decide anything already decided. That property is load-bearing under
a router and must not be "fixed".

---

## [P5] Hosting → **Vercel, Northflank, Netlify** — decided 2026-09-24

Three targets, so the answer is a **deploy adapter per target** rather than one assumption. Each
owns its redirect and 404 mechanism, its header policy, and whether assets are served from the
same origin.

The output stays a plain static directory plus `_ada/build-manifest.json`; that does not change.
What changes is that the gate's transport rows (`is-on-https`, `has-hsts`, `csp-xss`, checklist
79–80) finally have something to assert against. Headers are declared differently on each:
`vercel.json`, `netlify.toml` / `_headers`, and a Northflank service config. This is engineering,
not a decision, and is the next thing I can build.

---

## [P5] Tier C WebGL → **ships in V1** — decided 2026-09-24

Live WebGL is in scope, under the bounds ARCHITECTURE §1.1 already sets: a ≤ 15 kB gzip OGL or
raw-shader plane, below the fold, lazy-mounted, poster until first frame.

**What this adds to the gate, and none of it exists yet:**

- a hard **15 kB gzip ceiling** on the tier-C bundle, which the existing 180 kB page budget does
  not express;
- **GPU tier detection** with a defined fallback when detection fails or the GPU is weak — the
  answer must be the tier-0 poster, not a degraded shader;
- **poster-until-first-frame**, asserted in a real browser, because the failure mode is a blank
  rectangle where the hero should be;
- **`prefers-reduced-motion`**: a shader must not animate under it. The `reduced-motion` project
  counts running animations and asserts zero; a WebGL render loop is not a CSS animation and will
  not be counted by that check as written.

**What a human must still author:** the shader itself, and the arrangement that uses it. Every
scaffold is `tier_0` and nothing has exercised tier C.

---

# Part 2 — Still open

## [P6] Medical jurisdiction and its advertising constraints

Blocks the first real playbook. See the niche entry above. I need the jurisdiction named; I will
not infer medical advertising law.

## [P4] Routing per call type, and three unmapped provider names

Blocks wiring stage 10 copy generation to a real provider.

## [P5] Header mechanism per host

Not a decision — work. Three adapters, then the gate's transport rows stop being
`notApplicable`.
