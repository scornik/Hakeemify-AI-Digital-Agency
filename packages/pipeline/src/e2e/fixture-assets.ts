/**
 * Fixture assets for the end-to-end build.
 *
 * These are **fixture data, not the authored library**. Archetypes, positioning files and niche
 * playbooks are authored offline and human-reviewed (v4 §5, §6, §7); what is here is the minimum
 * structure needed to prove the sixteen stages run, transcribed from the spec rather than
 * designed. They live under `src/e2e/` rather than in the library's
 * `assets/` tree precisely so nothing here can be mistaken for an authored library asset. Authoring the real ones is P7.
 */
import type {
  ArchetypeView,
  ArtDirectionView,
  DesignSystemView,
  PlaybookView,
  PositioningView,
} from '../library-view.js';

/** v4 §7's mandatory fallback: `requires: []`, fillable by fallback sections alone. */
export const SERVICE_CLARITY: ArchetypeView = {
  id: 'service_clarity',
  requires: [],
  beats: [
    { id: 'hook', families: ['hero'], required: true, focal_weight: 3 },
    { id: 'mechanism', families: ['services'], required: true },
    { id: 'evidence', families: ['proof'], required: true, min: 1, max: 2 },
    { id: 'objection', families: ['faq'], required: true },
    { id: 'offer', families: ['cta'], required: true },
  ],
  narrative_rules: ['single_offer_beat', 'objection_immediately_precedes_offer'],
  rhythm_profile: {
    roles: ['impact', 'explanation', 'proof', 'relief', 'offer'],
    intensity_targets: [1.0, 0.5, 0.7, 0.28, 0.85],
    tolerance: 0.15,
  },
  siblings: [],
  status: 'active',
};

/** Gated on before/after pairs. The fixture business has two, so this is ruled out. */
export const TRANSFORMATION: ArchetypeView = {
  ...SERVICE_CLARITY,
  id: 'transformation',
  requires: ['count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4'],
  siblings: ['service_clarity'],
};

/** Gated on attributable testimonials. The fixture business has one, so this is ruled out too. */
export const PROOF_FIRST: ArchetypeView = {
  ...SERVICE_CLARITY,
  id: 'proof_first',
  requires: ['count(proof.testimonials[attributable]) >= 3'],
  siblings: ['service_clarity'],
};

export const ARCHETYPES: readonly ArchetypeView[] = [SERVICE_CLARITY, TRANSFORMATION, PROOF_FIRST];

export const DESIGN_SYSTEMS: readonly DesignSystemView[] = [
  {
    id: 'reference_v1',
    version: '1.0',
    composition_family: 'minimalist',
    visual_energy: 3,
    motion_pattern_allowlist: ['none', 'reveal'],
    art_direction_compat: ['quiet_authority'],
    positioning_compat: ['local_trust', 'premium', 'specialist'],
    // `reference`, not `active`: it is compiler input, and calling it active would make it
    // selectable by a real client build.
    status: 'reference',
  },
];

export const ART_DIRECTIONS: readonly ArtDirectionView[] = [
  {
    id: 'quiet_authority',
    version: '2',
    requires: [],
    compatible_systems: ['reference_v1'],
    positioning_compat: ['local_trust', 'premium', 'specialist'],
    grade_id: 'warm_lift',
    status: 'active',
  },
  {
    // Photo-led, and gated on having enough gradeable photos. The fixture business has five, so
    // this is ruled out and lands in the Gap Report as something the owner can go and fix.
    id: 'documentary_real',
    version: '1',
    requires: ['count(media.photos[rights != "unknown" && grade_safe]) >= 12'],
    compatible_systems: ['reference_v1'],
    positioning_compat: ['local_trust'],
    grade_id: 'documentary_flat',
    status: 'active',
  },
];

export const POSITIONS: readonly PositioningView[] = [
  {
    id: 'local_trust',
    requires: [],
    archetype_boosts: {},
    preferred_art_directions: ['documentary_real', 'quiet_authority'],
    visual_energy_range: [1, 7],
    rhythm_bias: 'neutral',
  },
  {
    id: 'premium',
    requires: [],
    archetype_boosts: { authority: 3, founder_story: 2, comparison: -2 },
    preferred_art_directions: ['quiet_authority'],
    visual_energy_range: [2, 5],
    rhythm_bias: 'spacious',
  },
  {
    // v4 §6: every business believes it is the best one; the only version of that claim a
    // website may carry is one somebody else verified.
    id: 'leader',
    requires: ['count(proof.metrics[verification == "third_party"]) >= 1'],
    archetype_boosts: {},
    preferred_art_directions: [],
    visual_energy_range: [1, 10],
    rhythm_bias: 'neutral',
  },
];

export const PLAYBOOKS: readonly PlaybookView[] = [
  {
    id: 'roofing',
    version: '4',
    supported_positions: ['local_trust', 'volume_value', 'premium', 'specialist'],
    default_position: 'local_trust',
    preferred_archetypes: ['transformation', 'authority'],
    preferred_systems: ['reference_v1'],
    preferred_art_directions: ['documentary_real', 'quiet_authority'],
    section_boosts: { 'proof/credential_bar': 3 },
    reviewed: '2026-09',
    status: 'active',
  },
];
