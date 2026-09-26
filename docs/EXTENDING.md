# Extending the engine

Four things you will want to add, in the order they are likely to come up. Each section is
self-contained: what to write, where, what will refuse you and why, and how to check you are done.

One rule cuts across all four. **Every mechanism in this system is built so that the unsafe
version is an error rather than an omission.** If something refuses you, the fix is almost never
to relax the check — it is that the check has found the thing it was written for. Each section
below names the refusals you should expect so you can tell a guard from a bug.

| I want to… | Section | Needs a human decision? |
| --- | --- | --- |
| Add a model provider | [1](#1-adding-a-model-provider) | No |
| Wire a real model call | [2](#2-wiring-a-model-call) | Yes — which model, per call type |
| Author a section | [3](#3-adding-to-the-section-library) | **Yes — this is the only part a machine must not do** |
| Extend the Bangladesh claim pack | [4](#4-the-bangladesh-claim-pack) | **Yes — a qualified lawyer** |

---

## 1. Adding a model provider

**Files:** `packages/pipeline/src/model/providers.ts`, `pricing.ts`, `router.ts`

### The contract

A provider is one method. Nothing downstream knows which one answered.

```ts
export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse> | ModelResponse;
}
```

### If it speaks the OpenAI protocol

Most aggregators do. One line:

```ts
export const myProvider = openAiStyle(
  'myprovider',                      // add to PROVIDER_NAMES first
  'https://api.example.com/v1',      // omit a default only if you do not know it — see below
  'MYPROVIDER_API_KEY',
  () => ({}),                        // extra headers, if any
);
```

Then add it to `PROVIDER_FACTORIES`. The `PROVIDER_NAMES` tuple is the source of truth and a test
asserts every name has a factory.

**If you do not know the endpoint, do not guess one.** Follow what `omniRouteProvider` does: throw
`MissingBaseUrlError` and require the URL from configuration. A guessed hostname that 404s looks
like an outage and costs somebody an afternoon; a missing one that says *"registered as an
OpenAI-protocol endpoint — if it speaks a different protocol it needs its own adapter, not a base
URL"* does not.

### If it does not

Write the adapter. The only thing that genuinely differs between providers is **how you force a
JSON shape**, and the four in the repo cover the four approaches you will meet:

| Provider | Mechanism |
| --- | --- |
| OpenAI, OpenRouter | `response_format.json_schema` with `strict: true` |
| Anthropic | one tool whose `input_schema` is the schema, `tool_choice` pinned to it |
| Gemini | `responseSchema` — an **OpenAPI subset**: strip `additionalProperties` or it errors |
| Ollama | the schema directly as `format` |

Three things your adapter must do:

1. **Map the finish reason through `finishReason()`,** and let anything unrecognised become
   `error`. An unknown terminal state is not a successful one; calling it `stop` hands the wrapper
   a truncated body to validate as though it were complete.
2. **Throw on a non-2xx.** Returning an empty string reaches the wrapper as `unparseable_json` and
   burns a re-ask on what is actually an outage.
3. **Never retry internally.** The wrapper owns the re-ask loop and counts every attempt against
   the call budget. A provider that retried would spend budget the ledger cannot see.

You do **not** need to make the model obey the schema. `validateSelection` checks the answer
against the eligible enums whatever the provider claimed to enforce — which is why "schema support
varies by model" is tolerable here and would not be elsewhere.

### Pricing is not optional

```bash
export ADA_PRICE_BOOK='{"myprovider/model-x": {"inputPerMillion": 1.5, "outputPerMillion": 6}}'
```

A model with no recorded price throws `UnpricedModelError`. That is deliberate: prices change
without notice, so none is baked in, and a missing price costed as zero does not fail loudly — it
under-reports, and the run sails past a ceiling you believe is holding. Local providers listed in
`FREE_PROVIDERS` are exempt because they genuinely cost nothing per token, which is why the
wall-clock ceiling exists.

### Routing

```ts
const routes = selectionAndCopyRoutes(
  [ollamaProvider({ model: 'qwen3' })],              // six selection stages: cheap, memoised
  [anthropicProvider({ model: 'claude-opus-5', apiKey })], // copy: the only visible one
);
assertRoutesKnown(routes);                            // rejects a stage the pipeline never calls
const provider = routedProvider('beat_selection', { routes, fallback: [] });
```

`assertRoutesKnown` exists because a typo is otherwise invisible: the misspelled entry is never
looked up, the real stage silently takes the default chain, and a call quietly goes to the wrong
model.

**The rule that makes fallback safe:** a fallback is taken only when a provider could not answer at
all — network error, 5xx, missing credential. **Never because the answer was bad.** Re-asking is
the wrapper's job and it counts against the budget. If you make the router judge answers, attempts
multiply by the chain length behind the ledger's back and both ceilings stop meaning anything.

### Testing it

Inject `fetch`. No test in this repository has ever called a real endpoint, and adding the first
one would make the suite depend on a third party's uptime and your credit card:

```ts
const provider = myProvider({ model: 'm', apiKey: 'k', fetch: fakeFetch(cannedBody).fetchLike });
```

Assert the request you **build** and how you read a response back. That is the half that goes
wrong quietly.

### Done when

`pnpm verify` is green, `PROVIDER_NAMES` contains your name, and `check:licences` still reports
`2 in the shipped closure`. If the closure grew, your provider pulled a dependency into client-
facing code; it belongs in `devDependencies` or behind a dynamic import.

---

## 2. Wiring a model call

**Files:** `packages/pipeline/src/build.ts`, `model/wrapper.ts`

### The invariant you must not break

> The model never generates design or markup. It makes enum selections against a per-build JSON
> Schema whose enums are exactly the eligible ids, plus copy on a `grounded_in` leash.

So there are exactly two kinds of call, and adding a third kind is a change to the architecture,
not to this file.

### A selection call

```ts
const outcome = await select(
  {
    stage: 'beat_selection',              // must be in SELECTION_STAGES
    fields: { beat_hook: eligibleIds },   // the schema's enums ARE this list
    promptFragments: [base, niche, archetype, positioning],
    seed: state.seed,
    fallback: { beat_hook: eligibleIds[0] }, // must itself be eligible; asserted, not trusted
  },
  { provider, memo, ledger },
);
```

Eligibility is computed in code **before** the call. The model cannot propose an ineligible id
because the schema does not contain one. Never pass an empty set — `buildSelectionSchema` throws
`EmptyEligibleSetError` rather than emitting `enum: []`, which some providers accept and then
satisfy with an arbitrary string.

Handle all three outcomes. `budget_exceeded` is not an error to swallow:

```ts
if (outcome.kind === 'budget_exceeded') return { ...state, status: 'BUDGET_EXCEEDED' };
if (outcome.kind === 'fell_back') { /* record the substitution */ }
```

### A copy call

Stage 10 (`populate`) currently takes copy from a `SlotPlanner` the caller supplies. To make it a
model call, the generated text must carry `grounded_in`: the fact ids it is allowed to draw on.

Then **both** gates apply, and they are independent:

1. `extractClaims` + `claimSupported` — every number, date, name and quotation in the copy must
   appear in the rendered text of a cited fact. Not "sounds supported": *appears*.
2. `detectImpermissibleClaims` — a claim can be perfectly grounded and still forbidden. See §4.

A grounded claim that is impermissible must fail. Passing one gate is not passing.

### The budget

Set per run, not in code:

```bash
ADA_MAX_COST_USD=10 ADA_MAX_MODEL_CALLS=100 ADA_MAX_WALL_CLOCK_MS=900000 pnpm e2e:fixture
```

A malformed value throws rather than falling back to the default — an operator who believes they
raised a ceiling and did not is the one outcome a spend guard must not produce. The wall-clock term
exists because a local model spends $0.00 and can still hang forever.

### Two properties not to "fix"

- **The memo key excludes the model id.** Changing which model answers a call must not re-decide
  anything already decided. This is what makes a mid-run fallback safe. It looks like a bug and is
  load-bearing.
- **`finish_reason === 'length'` is a hard failure.** Never a partial accept.

### Done when

`pnpm e2e:fixture` is green and the run log shows the call count and cost you expect. The fixture
uses `obedientProvider` — keep it that way. A pipeline whose tests depend on a model's mood cannot
claim reproducibility, and the last assertion in the e2e is that the same seed produces the same
`SiteDefinition` hash.

---

## 3. Adding to the section library

**This is the part a machine must not do.** Everything else in this repository can only *remove
failure*. Nothing in it can add quality.

> A constraint system prevents bad design; it does not produce great design. Great design enters
> exactly once, when a human authors a variant. — v4 §11

A model may not write a `signature_move`, set a `grade.rubric` boolean, record an ELO, or author a
graded `.astro` variant. If you are an agent reading this: stop here and hand back.

`HANDOFF.md` §1–§3 is the authoritative walkthrough. What follows is the shape and the refusals.

### Where it goes

```
packages/library/assets/sections/<family>/<variant>/
  manifest.yml          # the contract — schema in src/manifest/schema.ts
  <variant>.astro       # the component, NEXT TO its manifest
  lib/*.ts              # optional helpers, each declared in files[]
```

The component must live beside its manifest: the drift check resolves `files[]` relative to the
manifest directory, so a component anywhere else is a component nothing validates.

Copy `assets/sections/hero/service_statement/` as the shape. It is a **scaffold** — deliberately
no `signature_move`, no grade, no authoring record. Those three are what you are adding.

### The field that decides whether it is worth shipping

```yaml
arrangements:
  - id: stacked_left
    signature_move: >-
      One deliberate, non-obvious compositional decision, in one sentence.
```

If you cannot name one, the variant is the average of its category, which is the definition of
slop. Leaving it empty is the rejection signal and costs nothing to run.

### What will refuse you

| Refusal | Why |
| --- | --- |
| Manifest fails to load, naming a minimum | `family-standards.ts` enforces v4 §11: hero needs **5** arrangements, proof **4**, others 3 |
| Token compile fails on a contrast pair | Every foreground/background pair must clear 4.5:1 in **every** condition, dark included. Check as you choose, not after |
| `pnpm library:grade` exits 2 | No TTY. It will not invent a rubric value, suggest one, or run in CI — deliberately |
| `no_signature_section` becomes blocking | Expected. It is scoped by `isScaffoldOnly()`, so the moment you author one real section the rule turns on. That is the system asking for the moment you just authored |
| Nothing is eligible; the build stops | Correct. `allowScaffold` is false outside the fixture |

Two library-wide invariants that fail silently and are expensive to find late:

1. Every family needs at least one `fallback: true` variant with `requires: []`.
2. Every archetype's beats must be fillable by fallback sections alone — *and* that fallback-only
   sequence must satisfy the archetype's own rhythm profile.

### Motion, now that tier C ships

`tier_0` (pre-rendered loop + poster, 0 kB JS) covers most ambient motion and cannot regress. If
you reach for `tier_c`:

- the 15 kB gzip ceiling is measured against your real source by `byte-ceiling.ts` at load time;
- **one WebGL context per page** — `motion.tier-c-island-budget`;
- it must draw at least one frame, or `motion.webgl-renders-something` fails. The failure mode of
  a lazy-mounted shader is not a slow page, it is a blank rectangle;
- it must **stop** under `prefers-reduced-motion`. `motion.no-render-loop-under-reduced-motion`
  instruments `requestAnimationFrame` and the GL draw calls, so a render loop is visible to it even
  though `getAnimations()` cannot see one.

### Done when

```bash
pnpm verify && pnpm build:fixture && pnpm e2e:fixture
```

…and you have flipped `status: scaffold` → `active`, with two reviewers recorded and the rubric
true at **both** content extremes. Then delete the scaffolds; they existed only so the pipeline was
testable before you arrived.

---

## 4. The Bangladesh claim pack

**File:** `packages/contract/src/invariants/packs/bd-medical.ts`

### What this pack is, and is not

It is a machine's reading of publicly described regulation. It is **not legal advice**, and
`reviewedBy` is `null`, which makes `assertPackUsable()` throw `UnreviewedPackError` for any build
that is not a fixture.

That refusal is the feature. The rules are useful as a starting list for a lawyer to work through
and dangerous as an authority.

### Why it exists separately from grounding

`claims.ts` asks *is this claim grounded* — does every number and name appear in a cited fact.
`permissibility.ts` asks *may this be said at all*. A Bangladeshi practice can state a perfectly
true, fully grounded success rate and still be in breach, because the rule is not about truth. The
two gates are independent and a claim must pass both.

### Reviewing it

Work rule by rule, not file by file. Each carries its own `needsLegalReview`, and a reviewer should
end up flipping each one individually or changing its disposition:

```ts
{
  claimClass: 'testimonial',
  disposition: 'forbidden',      // forbidden | requires_evidence | requires_disclaimer | allowed
  patterns: { en: ['\\bwhat our (?:patients?|clients?)\\b'] },
  reason: 'Patient testimonials are restricted for registered practitioners.',
  citation: null,                // null where I could not name an instrument
  needsLegalReview: true,        // → false, by a named human
}
```

Then, once:

```ts
reviewedBy: { name: 'A Reviewer', date: '2026-10-01', role: 'advocate, Bangladesh' },
```

Two things to know before you review:

- **I was conservative where I was unsure.** Testimonials are `forbidden` because I have not read
  the BM&DC conduct code and say so in the file header. Being wrong that way costs a plainer
  website; being wrong the other way lands on your client. Expect to relax some of these.
- **`citation` is `null` wherever I could not name a real instrument** rather than something
  plausible-looking. An invented citation survives review in a way a null does not. If you add a
  citation, a test asserts it names an Act, Ordinance or Code.

### The Bangla gap — the most important open item here

`languages: ['en']`. A bilingual practice site scanned with an English-only pack **passes every
rule while saying anything at all**. `packCoversLanguage(pack, 'bn')` returns false so the gate can
report blindness rather than a pass.

I did not add Bangla patterns I half-trusted, because a partly-populated set reads as coverage,
which is worse than an honest hole. Filling it needs a Bangla-speaking reviewer who knows the
marketing idiom. When you do:

```ts
patterns: {
  en: ['\\b(?:best|finest|top)\\b'],
  bn: ['…'],
},
```

…and add `'bn'` to `languages`. Do not add the language tag before the patterns exist — that
converts an honest hole into a false claim of coverage, which is the one change here that makes
things worse rather than merely incomplete.

### Adding a jurisdiction

Copy the file, change `id`, `jurisdiction` and `languages`, set `reviewedBy: null`, and write the
rules. Export it from `packages/contract/src/index.ts`. The mechanism is jurisdiction-agnostic;
only the contents are local.

### Done when

`pnpm verify` is green, `packCoversLanguage(pack, 'bn')` is true if your clients write Bangla, and
`assertPackUsable(pack)` no longer throws — which is to say, when a named human has signed it.
