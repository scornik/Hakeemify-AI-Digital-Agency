# Section Metadata & Fact Eligibility Schema — v4

v4 adds positioning, page rhythm, family-tiered authoring standards, asset
lifecycle/versioning, the decision manifest, and a three-tier anti-slop engine.

```
FactRegistry
   ↓  (predicates, code)
Eligibility ─────────────────────────────┐
   ↓                                      │
Niche Playbook (authored, versioned)      │
   ↓                                      │
Positioning         ← owner-declared, never inferred
   ↓                                      │
Creative Direction  ← model: design_system + art_direction + page_archetype
   ↓                                      │
Compat Filter (code)                      │
   ↓                                      │
Beat Selection      ← model: variant per beat
   ↓                                      │
Arrangement         ← model: layout within variant
   ↓                                      │
Assembly (composition + narrative + rhythm)
   ↓                                      │
Anti-Slop Gate (3 tiers)                  │
   ↓                                      │
Launch QA Gate                            │
   ↓                                      │
Site ──────────── GapReport ◄─────────────┘
   ↓
DecisionManifest → client-facing rationale
Telemetry → evidence thresholds → priors promotion
```

Governing rule, unchanged: **eligibility and constraint are computed in code;
the model only chooses within what code has already permitted.**

---

## 1. Fact Registry

Every value the system is allowed to put on a page. Nothing renders that isn't
traceable to an entry here.

```ts
type FactId = string;

type Provenance =
  | { kind: "intake";   field: string }
  | { kind: "upload";   file: string; checked: boolean }
  | { kind: "external"; source: "gbp" | "registry" | "site"; url: string; fetched_at: string }
  | { kind: "derived";  from: FactId[]; rule: string };

interface Fact<T> {
  id: FactId;
  value: T;
  provenance: Provenance;
  /** false = may inform layout decisions, must never appear as a claim in copy */
  quotable: boolean;
  verification: "self_reported" | "documented" | "third_party";
}
```

### Registry shape

```ts
interface FactRegistry {
  business: {
    legal_name: Fact<string>;
    trading_name?: Fact<string>;
    type: Fact<"local_service" | "ecommerce" | "saas" | "practice" | "studio">;
    niche: Fact<string>;                 // keys into the niche playbook
    positioning: Fact<PositioningId>;    // §6 — owner-declared
    founded_year?: Fact<number>;
    story?: Fact<string>;
    problem_statement?: Fact<string>;
    differentiators?: Fact<string[]>;
    guarantees?: Fact<Guarantee[]>;
    response_time_promise?: Fact<string>;
  };

  services: Fact<Service[]>;
  people:   Fact<Person[]>;

  proof: {
    testimonials: Fact<Testimonial[]>;
    projects:     Fact<Project[]>;
    metrics:      Fact<Metric[]>;
    credentials:  Fact<Credential[]>;
    clients:      Fact<Client[]>;
  };

  media: {
    logo?:         Fact<ImageAsset>;
    brand_colors?: Fact<string[]>;
    photos:        Fact<ImageAsset[]>;
    video?:        Fact<VideoAsset[]>;
  };

  contact: {
    phone?: Fact<string>;
    email:  Fact<string>;
    address?: Fact<PostalAddress>;
    service_area?: Fact<GeoArea[]>;
    hours?: Fact<OpeningHours[]>;
    booking_url?: Fact<string>;
  };

  legal: {
    entity_jurisdiction: Fact<string>;
    privacy_contact: Fact<string>;
    refund_terms?: Fact<string>;
    cookie_categories?: Fact<CookieCategory[]>;
  };
}
```

### Entity flags that predicates read

```ts
interface Testimonial {
  quote: string;
  author_name?: string;
  author_role?: string;
  portrait?: ImageAsset;
  consented: boolean;
  verification: "self_reported" | "documented" | "third_party";
  get attributable(): boolean;   // author_name && consented
}

interface Project {
  title: string;
  summary?: string;
  before_photo?: ImageAsset;
  after_photo?: ImageAsset;
  outcome_metric?: Metric;
  location?: GeoArea;
  client_named: boolean;
}

interface Person {
  name: string;
  role: string;
  portrait?: ImageAsset;         // real photo only — never generated
  bio?: string;
  is_founder: boolean;
}

interface ImageAsset {
  path: string;
  width: number; height: number;
  aspect: number;                // read by arrangement asset_constraints (§8)
  alt?: string;
  rights: "owned" | "licensed" | "unknown";   // "unknown" is ineligible everywhere
  subject_consent: boolean;
  tags?: string[];               // ingest-time classifier; feeds anti-slop photo checks
  grade_safe: boolean;           // survives LUT application without clipping
}
```

---

## 2. Predicate Language

Pure, deterministic, JSON-serialisable after parse.

```
predicate  := expr
expr       := term (('&&' | '||') term)*
term       := '!'? (call | comparison | '(' expr ')')
call       := ('exists' | 'count' | 'sum' | 'len' | 'all' | 'any') '(' path filter? ')'
comparison := (call | path) op literal
path       := ident ('.' ident)*
filter     := '[' expr ']'
op         := '>=' | '>' | '<=' | '<' | '==' | '!='
```

**Evaluation rules**

1. A missing path evaluates to `false` / `0` / empty — never throws.
2. Same registry always yields the same eligible set.
3. Evaluation is snapshotted per build into the manifest (§16), which is what
   makes every decision explainable without a model narrating it.
4. Predicates may only gate. They may never transform a fact into a claim.

---

## 3. Design Systems

Concrete token files. The model **selects an id**; it never emits a token value.

```yaml
# /design-systems/editorial-v3.yml
id: editorial_v3
version: 3.1
status: active                        # §12

visual_dna:
  composition_family: editorial       # editorial | product_story | cinematic | minimalist | technical | magazine
  typography_voice: luxury            # luxury | corporate | modern | playful | utilitarian
  visual_energy: 4                    # 1–10
  motion_language: subtle             # none | subtle | expressive | immersive

tokens:
  font_pair:
    heading: { family: "Canela", weights: [300, 500], fallback: "Georgia, serif" }
    body:    { family: "Sohne",  weights: [400, 600], fallback: "system-ui, sans-serif" }
  type_scale:  { base: 17px, ratio: 1.25, steps: [-1, 0, 1, 2, 3, 4, 5] }
  spacing:     { unit: 8px, steps: [0.5, 1, 2, 3, 5, 8, 13] }
  radius:      { scale: [0, 2, 4], default: 2 }
  elevation:   { system: "hairline_only", shadows: ["0 1px 0 rgba(0,0,0,.06)"] }
  grid:        { columns: 12, gutter: 24px, max_width: 1180px, breakpoints: [480, 768, 1024, 1400] }
  palette:
    family: warm_neutral
    hue_adaptable: true
    roles: [bg.base, bg.raised, fg.primary, fg.muted, accent.bg, accent.fg, border.hairline]

motion:
  pattern_allowlist: [reveal, parallax_subtle]
  max_density: 0.30
  default_duration_ms: 420
  easing: "cubic-bezier(.2,.8,.2,1)"

art_direction_compat: [quiet_authority, editorial_mono]
positioning_compat: [premium, luxury, specialist, local_trust]

forbids: [gradient_hero, icon_card_triplet]
```

Ship 6–10. `visual_dna` is the addressable surface — the model reasons over DNA
fields, never over raw tokens.

---

## 4. Art Direction

Tokens control structure; art direction controls personality. Two sites on
`editorial_v3` differ mostly in imagery treatment, so imagery gets its own
selectable, versioned layer.

```yaml
# /art-direction/quiet-authority.yml
id: quiet_authority
version: 2
status: active
compatible_systems: [editorial_v3, grounded_v2]
positioning_compat: [premium, luxury, specialist]

requires:
  - count(media.photos[rights != "unknown" && grade_safe]) >= 6

photography:
  grade:
    id: warm_lift
    lut: luts/warm_lift.cube
    contrast: medium_low
    saturation_delta: -12
    shadow_tint: "#2A2118"
    grain: 0.03
    applies_to: all_photographic_assets
  crop_grammar:
    aspect_ratios: ["4:5", "3:2"]
    subject_placement: off_center_third
    headroom: tight
    allow_full_bleed: true
  forbids: [stock_gesture, centered_subject_eye_level, heavy_bokeh]

texture:      { system: paper_grain, opacity: 0.04, applies_to: [bg.raised] }
illustration: { system: none }
depth_strategy:
  mode: layered_flat
  elevation_source: hairline_and_offset
  forbids: [drop_shadow_stack, glassmorphism, neumorphism]

no_photo_fallback:
  mode: typographic_block
  never: [stock_photo, ai_generated_person, ai_generated_premises]
```

**Rules**

- The grade applies to *every* photographic asset. Partial application is the
  tell that separates an art-directed site from a collage.
- If every photo-led art direction is ineligible, the build takes a non-photo
  one. It never substitutes stock. That is a Gap Report entry.
- `never: ai_generated_person` is literal and non-overridable.

Ship 8–12.

---

## 5. Niche Playbooks

Niche intelligence, authored offline, human-reviewed, versioned.

```yaml
# /playbooks/roofing.yml
id: roofing
version: 4
reviewed: 2026-09
status: active
authored_from: [notes/roofing-market-study.md]

supported_positions: [local_trust, volume_value, premium, specialist]
default_position: local_trust          # a suggestion in intake, never an assignment

preferred_archetypes:     [transformation, authority]
preferred_systems:        [grounded_v2, editorial_v3]
preferred_art_directions: [documentary_real, quiet_authority]

trust_signals_ordered:
  - licence_and_insurance_bar
  - before_after_gallery
  - service_area_map
  - written_warranty_terms

objections: [price, warranty_length, timeline, property_damage, cleanup]

cta:
  primary_label_hint: "Get a free estimate"
  mobile: sticky_call_bar
  above_fold: required

section_boosts:
  proof-before-after-slider: +3
  proof-licence-bar: +3
  hero-quote-lead: -2

anti_patterns:
  - stock_handshake_hero
  - copy: "quality you can trust"
```

A playbook can boost, demote, or add required beats. It can **never** make an
ineligible section, archetype, art direction, or position eligible.

---

## 6. Positioning

Two roofers with identical facts should not get the same website. The facts say
what a business *is*; positioning says who it wants to be against its
competitors, and it is the difference between a luxury dentist and an affordable
family dentist built from the same registry.

**Positioning is declared by the owner in intake. It is never inferred.** A
model guessing "premium" for a budget operator misrepresents their business to
their own customers, in their own voice. The playbook supplies `supported_positions`
and a `default_position` as a suggestion; the owner picks.

```yaml
# /positioning/premium.yml
id: premium
label: "Premium — quality and craft over price"
declared_by: owner

requires: []                          # most positions need no evidence

honesty_constraints:
  grants_no_claims: true              # positioning changes emphasis, never licence
  forbidden_without_facts:
    - market_leader_claims            # needs third_party metrics
    - price_leadership_claims         # needs published comparison the owner can defend
    - speed_guarantees                # needs business.response_time_promise

affects:
  visual_energy_range: [2, 5]
  density_bias: sparse
  whitespace_multiplier: 1.25
  preferred_art_directions: [quiet_authority, editorial_mono]
  archetype_boosts: { authority: +3, founder_story: +2, comparison: -2 }
  proof_ordering: [credentials, attributed_testimonials, projects, metrics]
  cta:
    tone: consultative
    label_hints: ["Request a consultation", "Book a site visit"]
    urgency: low
  copy_register:
    sentence_length: longer
    claim_style: understated
    price_framing: value_not_number
  rhythm_bias: spacious               # §7
```

### The set

| id | posture | notable gate |
|---|---|---|
| `local_trust` | known, nearby, reliable | — |
| `volume_value` | accessible price, high throughput | price claims need defensible published pricing |
| `premium` | craft and care over price | — |
| `luxury` | scarcity, discretion, bespoke | — |
| `challenger` | explicitly better than an incumbent | `comparison` claims must be sourced and dated |
| `specialist` | narrow, deep, one thing | ≥ 1 credential or a single dominant service |
| `leader` | category leader | **`requires: count(proof.metrics[verification == "third_party"]) >= 1`** |

`leader` is gated on purpose. Every business believes it is the best one; the
only version of that claim a website may carry is one somebody else verified.

**Positioning influences ranking and register. It never widens what may be
claimed.** A premium position gets more whitespace and a consultative CTA — it
does not get to assert quality the fact registry can't support. Every
`affects.*` field is a preference or a filter; none of them touch
`quotable`, `grounded_in`, or any `requires`.

---

## 7. Page Archetypes and Rhythm

Beats are slots in a story; sections compete to fill them. Rhythm is the
intensity curve across those beats — the thing that separates an intentional
page from four heavy bands in a row that each satisfy the local constraints.

```yaml
# /archetypes/transformation.yml
id: transformation
requires:
  - count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4

beats:
  - { id: hook,      families: [hero],              focal_weight: 3, required: true }
  - { id: problem,   families: [problem, process],  required: true }
  - { id: mechanism, families: [services, process], required: true }
  - { id: evidence,  families: [proof],             required: true, min: 1, max: 2 }
  - { id: objection, families: [faq],               required: true }
  - { id: offer,     families: [cta],               required: true }

narrative_rules:
  - evidence_after_mechanism
  - no_proof_before_problem
  - single_offer_beat
  - objection_immediately_precedes_offer

rhythm_profile:
  roles:             [impact, explanation, relief, proof,  relief, offer]
  intensity_targets: [1.00,   0.50,        0.25,   0.70,   0.30,   0.85]
  tolerance: 0.15
```

### Intensity, computed not declared

```ts
intensity(section, arrangement) =
    0.40 * (focal_weight / 3)
  + 0.25 * densityScore          // sparse .2 | medium .55 | dense 1.0
  + 0.20 * min(approx_vh, 100) / 100
  + 0.15 * motion.density
```

Every input already exists on the variant or its arrangement, so intensity is
deterministic and needs no new authoring.

### Rhythm rules

```yaml
rhythm:
  match_profile_within_tolerance: true
  max_consecutive_within: 0.10        # two adjacent sections may not be near-identical intensity
  relief_required_before_offer: true  # at least one section <= 0.30 precedes the offer beat
  peak_at_index_0: true
  secondary_peaks_max: 1
  monotonic_decline_forbidden: true   # a page that only fades out has no second act
  positioning_bias:
    spacious: shift all targets -0.10, raise relief count to 2
    dense:    shift all targets +0.05
```

Archetype set, each with its own `requires`:

| id | gate |
|---|---|
| `transformation` | before/after project pairs |
| `authority` | credentials or third-party-verified metrics |
| `founder_story` | founder portrait + story ≥ 240 chars |
| `comparison` | ≥ 2 named alternatives the business can honestly contrast |
| `proof_first` | ≥ 3 attributable testimonials |
| `service_clarity` | **`requires: []`** — mandatory fallback |

**Satisfiability invariant:** every archetype's beats must be fillable by
`fallback: true` sections alone, *and* the resulting intensity sequence must
satisfy its own rhythm profile. Enforce both with a library unit test.

---

## 8. Section Variants and the Layout Genome

A variant carries **arrangements**: internally distinct compositions of the same
content contract, selected separately and tracked separately for diversity.

```ts
interface SectionVariant {
  id: string;
  family: "hero" | "problem" | "services" | "process" | "proof" | "faq" | "cta" | "team" | "footer";
  name: string;
  component: string;

  serves_beats: string[];
  serves_rhythm_roles?: string[];       // impact | explanation | proof | relief | offer
  requires: string[];                   // HARD GATE
  enhanced_by?: { predicate: string; weight: number }[];
  slots: SlotBinding[];

  affinity: { industries: string[]; exclude_industries?: string[] };
  positioning_compat?: string[];        // omit for "any"

  design_compat: {
    systems: string[];
    art_directions?: string[];
    composition_families?: string[];
    visual_energy_range?: [number, number];
  };

  composition: {
    density: "sparse" | "medium" | "dense";
    background_weight: "light" | "dark" | "accent" | "image";
    focal_weight: 0 | 1 | 2 | 3;
    approx_vh: number;
    media_dependency: "none" | "abstract" | "photo_required" | "video_optional";
    text_volume: {
      headline_max_chars: number;
      body_max_chars: number;
      items_min?: number;
      items_max?: number;
    };
  };

  motion: MotionProfile;
  budget: { js_kb: number; blocks_lcp: boolean; requires_webgl: boolean };

  a11y: {
    interactive: boolean;
    keyboard_pattern?: "accordion" | "carousel" | "disclosure" | "slider" | "tabs";
    reduced_motion_fallback: string;
    contrast_pairs: [string, string][];
  };

  priors: ConversionPrior;
  arrangements: Arrangement[];          // family minimum, §11
  authoring: AuthoringRecord;           // §11
  novelty_class: string;
  fallback?: boolean;
}
```

### Arrangement

```ts
interface Arrangement {
  id: string;                           // "portrait-left", "full-bleed-overlap"
  props: Record<string, unknown>;
  novelty_class: string;                // arrangement-level

  requires?: string[];
  asset_constraints?: {
    slot: string;
    min_aspect?: number;
    max_aspect?: number;
    min_width?: number;
    focal_safe_area?: "center" | "upper_third" | "any";
  }[];

  composition_override?: Partial<SectionVariant["composition"]>;
  motion_override?: Partial<MotionProfile>;

  signature_move: string;               // required, §11
  grade: LibraryGrade;                  // graded independently of the variant
}
```

`asset_constraints` is what stops this being cosmetic: the arrangement that runs
is the one the business's actual photo can carry.

### Slot binding

```ts
interface SlotBinding {
  slot: string;
  required: boolean;
  source:
    | { kind: "fact"; query: string }
    | { kind: "generated"; grounded_in: string[]; may_claim: false | "quotable_only" };
  max_chars?: number;
  register?: "inherit_positioning";     // §6 copy_register
}
```

`grounded_in` is the leash. A generated string containing a number, name, date
or quotation that doesn't resolve to a `quotable: true` fact is a build error.

---

## 9. Motion Profiles

```ts
interface MotionProfile {
  pattern: "none" | "reveal" | "parallax" | "scroll_story" | "depth" | "cinematic" | "webgl_scene";
  trigger: "load" | "in_view" | "scroll_linked" | "interaction";
  budget_ms: number;
  density: number;               // 0–1, also an intensity input (§7)
  stagger_ms?: number;
  main_thread_ms_est: number;    // measured at library-build time, not guessed
  reduced_motion_fallback: string;
  respects_prefers_reduced_motion: true;   // literal; no variant may set this false
}
```

```yaml
motion_page_budget:
  total_budget_ms_max: 2400
  mean_density_max: 0.35
  main_thread_ms_max: 120
  scroll_story_sections_max: 1
  webgl_sections_max: 1
  webgl_rules:
    - must_be_below_fold
    - lazy_mount_on_intersection
    - hard_kb_ceiling: 140
    - static_poster_fallback_required
  pattern_allowlist: inherited_from_design_system
```

---

## 10. Conversion Priors and the Measurement Loop

```ts
interface ConversionPrior {
  status: "unproven" | "plausible" | "measured";
  note?: string;                       // source of the belief. No invented percentages.
  evidence?: {
    lift_vs_family_baseline: number;
    interval_95: [number, number];
    n_impressions: number;
    n_conversions: number;
    n_businesses: number;
    window: string;
    stratum?: { niche?: string; positioning?: string; device?: string };
  };
}
```

```yaml
events:
  - page_view       { build_id, archetype, system, art_direction, positioning, sections[], arrangements[] }
  - section_in_view { section_instance_id, dwell_ms, viewport }
  - cta_click       { section_instance_id, cta_id }
  - lead_submit     { form_id, section_instance_id }
  - booking_complete{ booking_id }
privacy:
  first_party_only: true
  consent_gated: true
  no_pii_in_event_props: true
  respects_dnt: true

thresholds:
  min_impressions_per_arm: 2000
  min_conversions_per_arm: 40
  min_distinct_businesses: 8
  min_weeks: 4

analysis:
  method: hierarchical_partial_pooling
  pool_levels: [arrangement -> variant -> family -> global]
  stratify_by: [niche, positioning, device, traffic_source]
  report: posterior_interval

promotion:
  to_measured: interval_95 excludes the family baseline
  demotion: re-evaluated each window; `measured` can revert
  forbidden: ranking by raw lead counts, or by any arm below threshold
```

Cross-business comparison is confounded by niche, offer, positioning and ad
spend, and pooling only partly fixes it. Clean signal comes from
**within-business** splits — one site, two arrangements, randomised — which
needs traffic most early clients won't have. Build the event contract now, keep
`priors` honest, treat cross-business numbers as directional.

---

## 11. Authoring Standard

A constraint system prevents bad design; it does not produce great design. Great
design enters exactly once, when a human authors a variant.

```ts
interface AuthoringRecord {
  signature_move: string;              // one deliberate, non-obvious compositional decision
  negative_example: { screenshot: string; why_rejected: string };
  author: string;
  authored_at: string;
  reviewed_by: string[];
}

interface LibraryGrade {
  rubric: {
    single_dominant_focal_element: boolean;
    type_scale_respected: boolean;
    consistent_optical_alignment: boolean;
    whitespace_rhythm_consistent: boolean;
    survives_long_content: boolean;
    survives_sparse_content: boolean;
    readable_at_360px: boolean;
    focus_states_visible: boolean;
    grade_survives_art_directions: boolean;
  };
  extra_rubric?: Record<string, boolean>;   // family-specific, below
  elo: number;                              // pairwise WITHIN family
  graded_at: string;
  graded_by: "human" | "human_plus_model";
}
```

### Family-tiered standards

The hero is the LCP element, the first 40% of the impression, and the one band
that can sink an otherwise strong page. It gets a higher bar and more of the
library budget — not a higher absolute score, which the rubric doesn't produce,
but more arrangements, more rubric items, and an ELO floor *within its own
family*, where comparison is meaningful.

```yaml
family_standards:
  hero:
    min_arrangements: 5
    elo_floor_percentile: 75          # comparative, family-scoped
    extra_rubric:
      - works_with_4_word_headline
      - works_with_12_word_headline
      - works_with_no_photo
      - mobile_cta_visible_without_scroll
      - lcp_element_is_text_or_preloaded_image
      - holds_up_at_intensity_1.0
    reviewers: 2
    diversity_priority: first         # hero gets first call on the diversity budget
  proof:
    min_arrangements: 4
    extra_rubric: [degrades_to_fewer_items, no_implied_claim_without_fact]
    reviewers: 2
  cta:
    min_arrangements: 3
    extra_rubric: [label_is_specific_not_generic, works_under_every_positioning_register]
    reviewers: 2
  default:
    min_arrangements: 3
    reviewers: 2
```

### Entry gate

```yaml
required_to_enter_library:
  - signature_move named in one sentence
  - negative_example attached
  - arrangements >= family_standards[family].min_arrangements, each graded
  - rubric + extra_rubric: all true, at both content extremes
  - reviewed_by >= family_standards[family].reviewers
```

If the author can't name one non-obvious decision the variant makes, the variant
is the average of its category — which is the definition of slop. Failing to
fill `signature_move` is the rejection signal, and it costs nothing to run.

```yaml
signature_sections:
  min: 1        # a page needs one moment
  max: 2        # three or more and nothing is dominant
  definition: focal_weight == 3 && arrangement.signature_move != null
```

**On a reference/pattern graph:** composition, asymmetry, grid tension and
typographic rhythm live in the component a human wrote. They are not recoverable
from a table of `pattern_id` strings, and no build step would read one. Market
studies feed playbooks and new variants; the layout genome is what makes that
craft addressable at build time.

---

## 12. Lifecycle and Versioning

Playbooks go stale. So do design languages — an `editorial_v3` that felt current
in 2026 will date, and nothing in v3 of this spec noticed.

```yaml
lifecycle:
  playbook:
    review_interval_months: 9
    warn_after_months: 12
    fall_back_after_months: 18        # generic playbook, logged
  design_system:
    review_interval_months: 12
  art_direction:
    review_interval_months: 12

status_values: [active, frozen, retired]
  active:  selectable for new builds
  frozen:  no new builds; existing builds keep rendering
  retired: no new builds; existing builds keep rendering at their pinned version

version_pinning:
  every build manifest pins { design_system@version, art_direction@version,
                              playbook@version, library@commit }
  existing_sites_never_auto_migrate: true
  migration: opt-in rebuild, visually diffed, human-approved
```

Retiring a design system must never silently restyle live client sites. Pin at
build, migrate on request. This is the difference between a versioned system and
a shared mutable stylesheet with a hundred tenants on it.

### Drift review (offline, human-approved)

```yaml
drift_review:
  scope: [playbooks, design_systems, art_directions, anti_slop_bans]
  inputs:
    - refreshed manual market study
    - SERP sample for the niche's head terms
    - own telemetry (§10), filtered
    - tier-2 and tier-3 anti-slop flags (§14)
  output: /_proposed/<asset>@<date>.yml     # a diff, not a write
  merge: human approval; bumps version and `reviewed`
  never: auto-merge, never consulted at runtime
```

An agent may draft the diff. It may not land it.

---

## 13. Selection Pipeline

```
1.  INGEST              intake + uploads + external → FactRegistry
                        classify + tag photos, compute aspect and grade_safe
                        ask positioning, seeded from playbook.default_position

2.  ELIGIBILITY         variants, arrangements, archetypes, art directions,
                        positions. Empty set → fallback (guaranteed non-empty)

3.  PLAYBOOK            load /playbooks/{niche}.yml; check staleness
                        apply boosts, extra beats, cta hints

4.  POSITIONING         load /positioning/{declared}.yml
                        apply archetype boosts, AD preferences, energy range,
                        rhythm bias, copy register, proof ordering

5.  CREATIVE DIRECTION  model, constrained:
                        { design_system_id, art_direction_id, page_archetype }
                        restricted to eligible ∩ art_direction_compat ∩
                        positioning_compat ∩ playbook preferences

6.  COMPAT FILTER       drop variants failing design_compat, positioning_compat,
                        or motion allowlist
                        RETREAT ORDER on an empty beat:
                          relax design_compat → relax AD preference →
                          relax positioning preference → sibling archetype →
                          NEVER relax `requires` or honesty_constraints

7.  BEAT SELECTION      per beat, model picks from eligible[family ∈ beat.families
                        ∧ serves_beats ∋ beat.id ∧ serves_rhythm_roles ∋ role]

8.  ARRANGEMENT         model picks from arrangements whose requires and
                        asset_constraints the registry satisfies

9.  RANK TIEBREAK       base + Σ(enhanced_by) + playbook boost + positioning boost
                        − diversity_penalty(variant, arrangement, novelty_class)

10. ASSEMBLY            composition + narrative + rhythm rules
                        violations repaired by substitution, not a model call

11. POPULATE            fact slots bound; generated slots on grounded_in leash
                        copy register from positioning
                        art direction grade applied to ALL photographic assets

12. ANTI-SLOP           §14, three tiers

13. LAUNCH QA           Playwright + axe + Lighthouse + schema validator

14. MANIFEST            §16 — decision record derived from the predicate snapshot

15. GAP REPORT          locked-out positions, archetypes, ADs, sections, arrangements

16. TELEMETRY           emit event contract (§10)
```

---

## 14. Anti-Slop — three tiers

Regex lists go stale: today it's "elevate your business", next year it's
"transform your growth journey". The answer is not to replace determinism with a
model judge — a judge can't reproduce and would block legitimate copy. The
answer is three tiers with different powers.

### Tier 1 — deterministic bans (blocking)

```yaml
banned_copy:
  severity: blocking
  regex:
    - "(?i)\\belevate your\\b"
    - "(?i)\\bseamless(ly)?\\b"
    - "(?i)\\bin today'?s (fast-paced|digital) world\\b"
    - "(?i)\\bunlock the (power|potential)\\b"
    - "(?i)\\btake .{0,24} to the next level\\b"
    - "(?i)\\bwe'?re passionate about\\b"
    - "(?i)\\bcutting[- ]edge\\b"
    - "(?i)\\bquality you can trust\\b"
    - "(?i)\\byour one[- ]stop\\b"

banned_token_combos:
  - { id: gradient_saas_hero, detect: { family: hero, background: gradient, hues_within: [purple, blue, indigo] }, severity: blocking }
  - { id: single_family_typography, detect: { "font_pair.heading.family": "==font_pair.body.family" }, severity: blocking }
  - { id: uniform_large_radius, detect: { radius.applied_uniformly: true, radius.value: ">=16" }, severity: warning }

banned_layout_combos:
  - { id: icon_card_triplet, detect: "items.length == 3 && align == 'center' && item.media == 'line_icon'", severity: blocking }
  - { id: centered_twin_cta_hero, detect: "hero.align == 'center' && hero.cta.length == 2 && hero.media == 'none'", severity: blocking }
  - { id: emoji_bullets, detect: "list.marker matches emoji", severity: blocking }

art_direction_violations:
  - { id: ungraded_asset, detect: "photographic asset rendered without the selected grade", severity: blocking }
  - { id: mixed_crop_grammar, detect: "aspect outside art_direction.crop_grammar", severity: blocking }
  - { id: forbidden_photo_tag, detect: "asset.tags ∩ art_direction.photography.forbids", severity: blocking }
  - { id: synthetic_person, detect: "asset generated && depicts a person", severity: blocking }

sequence_slop:
  - { id: uniform_density_run, detect: "3 consecutive sections share density", severity: warning }
  - { id: no_focal_moment, detect: "max(focal_weight) < 3", severity: blocking }
  - { id: no_signature_section, detect: "signature_sections < 1", severity: blocking }
  - { id: rhythm_profile_breach, detect: "|intensity - target| > tolerance for any beat", severity: warning }
```

### Tier 2 — semantic cliché judge (warning only, feeds tier 1)

```yaml
tier_2:
  input: generated copy only, no screenshots
  task: flag phrasing that reads as generic marketing filler, with a rewrite
  severity: warning_only            # never blocks — not reproducible run to run
  output: /_proposed/anti-slop-bans.jsonl
  promotion: human review → tier 1 regex, versioned like any other asset
```

The judge's job is not to gate this build. It is to **grow the deterministic
list** from real output, so tier 1 stays current without anyone maintaining it
by hand.

### Tier 3 — self-cliché detector (deterministic, blocking)

```yaml
tier_3:
  method: n-gram (3–6) frequency across the last 100 builds
  flag_when: phrase appears in > 15% of builds, excluding brand and service names
  severity: blocking on new builds once flagged
  review: flagged phrases enter the same /_proposed queue
```

This is the strongest of the three and needs no model at all. A phrase becomes a
cliché *of your system* whether or not anyone wrote a regex for it. If forty of
your last hundred sites open with "Built for the way you work", that is now your
house slop, and tier 3 catches it the week it starts.

Repair order on a blocking hit: substitute from `eligible[]`, then regenerate
copy, then fail the build.

---

## 15. Composition Constraints

```yaml
page:
  min_sections: 5
  max_sections: 9
  no_repeat_family: true
  no_repeat_novelty_class: true
  no_repeat_arrangement_novelty_class: true
  focal_weight_3: { count: 1, must_be_index: 0 }
  blocks_lcp:     { count_max: 1, must_be_index: 0 }
  adjacent_density_must_differ: true
  background_weight_run_max: 2
  vertical_rhythm: single_spacing_scale_per_page
  signature_sections: { min: 1, max: 2 }
  narrative_rules: inherited_from_archetype
  rhythm: inherited_from_archetype + positioning bias

budget:
  total_js_kb_max: 180
  motion: see §9

media:
  photo_required_sections_max: 2
  single_art_direction_per_site: true
  reject_if: "any(slot.source.kind == 'fact' && asset.rights == 'unknown')"
```

---

## 16. Decision Manifest

Everything needed to explain the site is already computed. Emit it.

```json
{
  "build_id": "b_01J8…",
  "pinned": { "design_system": "editorial_v3@3.1", "art_direction": "quiet_authority@2",
              "playbook": "roofing@4", "library": "a7f31c2" },
  "decisions": [
    {
      "stage": "page_archetype",
      "chosen": "authority",
      "eligible_were": ["authority", "service_clarity"],
      "ruled_out": [
        { "id": "transformation", "failed": "count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4", "actual": 1 },
        { "id": "proof_first",    "failed": "count(proof.testimonials[attributable]) >= 3", "actual": 0 }
      ],
      "influenced_by": { "positioning": "premium", "playbook_boost": { "authority": 0 } }
    },
    {
      "stage": "art_direction",
      "chosen": "quiet_authority",
      "eligible_were": ["quiet_authority", "typographic_editorial"],
      "ruled_out": [
        { "id": "documentary_real", "failed": "count(media.photos[rights != \"unknown\" && grade_safe]) >= 12", "actual": 7 }
      ]
    }
  ]
}
```

**The rationale is derived from the predicate evaluation snapshot, not written
by the model.** Human-readable sentences are templated from `failed` plus the
actual value — "Transformation needs 4 before/after pairs; you provided 1." A
model may write a one-line summary *from* the manifest for the client-facing
page, clearly marked non-authoritative; it may never be the source of a reason.
A model-authored explanation of a code-made decision is confabulation with good
manners, and it will eventually explain a decision that wasn't made.

Two surfaces: `build-rationale.json` for you, and a client-facing "why your site
looks like this" page — which doubles as the most persuasive version of the Gap
Report, because every ruled-out line is a thing the owner can go fix.

---

## 17. Gap Report

```json
{
  "unlocks": [
    {
      "provide": "4 before/after photo pairs from completed jobs",
      "unlocks": { "archetypes": ["transformation"], "sections": ["proof-before-after-slider"] },
      "currently_using": { "archetype": "authority" },
      "impact": "high"
    },
    {
      "provide": "1 third-party verified metric (award, ranking, audited figure)",
      "unlocks": { "positions": ["leader"] },
      "impact": "high"
    },
    {
      "provide": "6 photos of your own work, 4:5 or 3:2, min 1600px",
      "unlocks": { "art_directions": ["documentary_real"], "arrangements": ["full-bleed-overlap"] },
      "currently_using": { "art_direction": "typographic_editorial", "reason": "no_photo_fallback" },
      "impact": "high"
    }
  ],
  "blocking": [
    { "missing": "legal.privacy_contact", "why": "privacy policy cannot be completed", "severity": "blocking" },
    { "missing": "contact.address", "why": "LocalBusiness schema requires a postal address", "severity": "blocking" }
  ]
}
```

Order by what changes most: positioning unlocks, then archetype (page changes
shape), then art direction (page changes personality), then sections, then
arrangements.

---

## 18. Diversity Ledger

```yaml
window: 50
max_share:
  variant_novelty_class: 0.25
  arrangement_novelty_class: 0.20
  design_system_id: 0.25
  art_direction_id: 0.25
  font_pairing: 0.20
  palette_family: 0.20
  page_archetype: 0.30
  section_sequence_hash: 0.06
  system_x_art_direction_pair: 0.15
  rhythm_signature: 0.20              # quantised intensity curve
stratify_by: positioning              # two premium sites may resemble each other
                                      # more than a premium and a volume_value one
action_on_breach: diversity_penalty at rank; alert at 1.5× cap
```

---

## Boundary

| Code (deterministic) | Model |
|---|---|
| Fact eligibility predicates | design_system_id (from compatible set) |
| Positioning honesty constraints | art_direction_id (from compatible set) |
| Archetype gates, narrative + rhythm rules | page_archetype (from eligible set) |
| design_compat, motion allowlist, asset_constraints | Section per beat (from eligible set) |
| Intensity computation | Arrangement (from eligible set) |
| Composition, motion, JS budgets | Copy for generated slots, on the grounded_in leash |
| Anti-slop tiers 1 and 3 | Anti-slop tier 2 flags (warning only) |
| Diversity ledger | Non-authoritative summary of the manifest |
| Claim grounding | — |
| Priors promotion thresholds | — |
| Decision manifest rationale | — |
| Launch QA gate | — |

| Owner (declared in intake) | Humans (once, at authoring time) |
|---|---|
| Positioning | Section variants and arrangements |
| Every fact in the registry | Design systems and art directions |
| Which gaps to close | Playbooks, drift diffs, ban promotions |
| — | signature_move, negative_example, rubric sign-off |

Anything that migrates out of columns one, three or four into column two is a
future bug report.
