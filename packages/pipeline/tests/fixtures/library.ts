/**
 * A minimal library satisfying `LibraryView`, for exercising eligibility, the compat ladder and
 * assembly. Nothing here is authored design: these are scaffold-grade shapes whose only job is
 * to have the right metadata. Authoring the real library is P7, and human.
 */
import type {
  ArchetypeView,
  ArrangementView,
  ArtDirectionView,
  DesignSystemView,
  LibraryView,
  PlaybookView,
  PositioningView,
  VariantView,
} from '../../src/library-view.js';

export const arrangement = (
  id: string,
  overrides: Partial<ArrangementView> = {},
): ArrangementView => ({
  id,
  requires: [],
  novelty_class: `arr_${id}`,
  signature_move: null,
  asset_constraints: [],
  ...overrides,
});

export const variant = (
  id: string,
  family: string,
  overrides: Partial<VariantView> = {},
): VariantView => ({
  id,
  family,
  requires: [],
  enhanced_by: [],
  serves_beats: [],
  serves_rhythm_roles: [],
  design_compat: { systems: ['reference_v1'] },
  motion_pattern: 'none',
  composition: {
    density: 'medium',
    background_weight: 'light',
    focal_weight: 1,
    approx_vh: 60,
  },
  motion_density: 0,
  novelty_class: `nc_${id}`,
  arrangements: [arrangement('single-column')],
  fallback: true,
  status: 'active',
  ...overrides,
});

export const archetype = (id: string, overrides: Partial<ArchetypeView> = {}): ArchetypeView => ({
  id,
  requires: [],
  beats: [],
  narrative_rules: [],
  rhythm_profile: { roles: [], intensity_targets: [], tolerance: 0.15 },
  siblings: [],
  status: 'active',
  ...overrides,
});

export const designSystem = (
  id: string,
  overrides: Partial<DesignSystemView> = {},
): DesignSystemView => ({
  id,
  version: '1.0',
  composition_family: 'editorial',
  visual_energy: 4,
  motion_pattern_allowlist: ['none', 'reveal'],
  art_direction_compat: ['quiet_authority'],
  positioning_compat: ['local_trust', 'premium'],
  status: 'reference',
  ...overrides,
});

export const artDirection = (
  id: string,
  overrides: Partial<ArtDirectionView> = {},
): ArtDirectionView => ({
  id,
  version: '1',
  requires: [],
  compatible_systems: ['reference_v1'],
  positioning_compat: ['local_trust', 'premium'],
  grade_id: 'warm_lift',
  status: 'active',
  ...overrides,
});

export const positioning = (
  id: string,
  overrides: Partial<PositioningView> = {},
): PositioningView => ({
  id,
  requires: [],
  archetype_boosts: {},
  preferred_art_directions: [],
  visual_energy_range: [1, 10],
  rhythm_bias: 'neutral',
  ...overrides,
});

export const playbook = (id: string, overrides: Partial<PlaybookView> = {}): PlaybookView => ({
  id,
  version: '1',
  supported_positions: ['local_trust', 'premium'],
  default_position: 'local_trust',
  preferred_archetypes: ['service_clarity'],
  preferred_systems: ['reference_v1'],
  preferred_art_directions: ['quiet_authority'],
  section_boosts: {},
  reviewed: '2026-09',
  status: 'active',
  ...overrides,
});

/**
 * A library where `service_clarity` is satisfiable by fallback sections alone, and
 * `transformation` is gated on before/after pairs the fixture registry does not have.
 */
export function fixtureLibrary(overrides: Partial<LibraryView> = {}): LibraryView {
  return {
    commit: 'a7f31c2',
    variants: [
      variant('hero/service_statement', 'hero', {
        serves_beats: ['hook'],
        serves_rhythm_roles: ['impact'],
        composition: {
          density: 'sparse',
          background_weight: 'image',
          focal_weight: 3,
          approx_vh: 86,
        },
        motion_pattern: 'reveal',
        motion_density: 0.15,
        arrangements: [arrangement('stacked-left', { signature_move: 'authored' })],
      }),
      variant('hero/founder_editorial', 'hero', {
        requires: ['exists(people[is_founder])'],
        serves_beats: ['hook'],
        serves_rhythm_roles: ['impact'],
        composition: {
          density: 'sparse',
          background_weight: 'image',
          focal_weight: 3,
          approx_vh: 90,
        },
        design_compat: { systems: ['reference_v1'], art_directions: ['documentary_real'] },
        arrangements: [arrangement('portrait-left', { signature_move: 'authored' })],
        fallback: false,
      }),
      variant('services/plain_list', 'services', {
        serves_beats: ['mechanism'],
        serves_rhythm_roles: ['explanation'],
        composition: {
          density: 'medium',
          background_weight: 'light',
          focal_weight: 1,
          approx_vh: 60,
        },
      }),
      variant('proof/credential_bar', 'proof', {
        requires: ['count(proof.credentials) >= 1'],
        serves_beats: ['evidence'],
        serves_rhythm_roles: ['proof'],
        composition: {
          density: 'dense',
          background_weight: 'dark',
          focal_weight: 2,
          approx_vh: 45,
        },
      }),
      variant('proof/testimonial_wall', 'proof', {
        requires: ['count(proof.testimonials[attributable]) >= 3'],
        serves_beats: ['evidence'],
        serves_rhythm_roles: ['proof'],
        composition: {
          density: 'dense',
          background_weight: 'dark',
          focal_weight: 2,
          approx_vh: 70,
        },
        fallback: false,
      }),
      variant('faq/native_disclosure', 'faq', {
        serves_beats: ['objection'],
        serves_rhythm_roles: ['relief'],
        composition: {
          density: 'sparse',
          background_weight: 'light',
          focal_weight: 1,
          approx_vh: 52,
        },
      }),
      variant('cta/direct_contact', 'cta', {
        serves_beats: ['offer'],
        serves_rhythm_roles: ['offer'],
        composition: {
          density: 'medium',
          background_weight: 'accent',
          focal_weight: 2,
          approx_vh: 48,
        },
      }),
    ],
    archetypes: [
      archetype('service_clarity', {
        beats: [
          { id: 'hook', families: ['hero'], required: true, focal_weight: 3 },
          { id: 'mechanism', families: ['services'], required: true },
          { id: 'evidence', families: ['proof'], required: true },
          { id: 'objection', families: ['faq'], required: true },
          { id: 'offer', families: ['cta'], required: true },
        ],
        narrative_rules: ['single_offer_beat', 'objection_immediately_precedes_offer'],
        rhythm_profile: {
          roles: ['impact', 'explanation', 'proof', 'relief', 'offer'],
          intensity_targets: [1.0, 0.5, 0.7, 0.28, 0.85],
          tolerance: 0.15,
        },
      }),
      archetype('transformation', {
        requires: ['count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4'],
        siblings: ['service_clarity'],
      }),
      archetype('proof_first', {
        requires: ['count(proof.testimonials[attributable]) >= 3'],
        siblings: ['service_clarity'],
      }),
    ],
    designSystems: [designSystem('reference_v1')],
    artDirections: [
      artDirection('quiet_authority'),
      artDirection('documentary_real', {
        requires: ['count(media.photos[rights != "unknown" && grade_safe]) >= 12'],
      }),
    ],
    positions: [
      positioning('local_trust'),
      positioning('premium'),
      positioning('leader', {
        requires: ['count(proof.metrics[verification == "third_party"]) >= 1'],
      }),
    ],
    playbooks: [playbook('roofing')],
    ...overrides,
  };
}
