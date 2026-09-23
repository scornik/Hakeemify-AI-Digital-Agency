/**
 * What the pipeline needs to read from the authored library.
 *
 * Declared here rather than imported as a concrete type so the pipeline depends on the *shape*
 * of the library, not on its file layout. The library package satisfies this interface; tests
 * satisfy it with fixtures. It also keeps the boundary honest: if the pipeline ever needs a
 * field that is not on this interface, that is a visible change to the contract between them.
 */

export interface VariantView {
  readonly id: string;
  readonly family: string;
  /** HARD GATE. Never relaxed, by anything, ever (ARCHITECTURE §5). */
  readonly requires: readonly string[];
  readonly enhanced_by: readonly { predicate: string; weight: number }[];
  readonly serves_beats: readonly string[];
  readonly serves_rhythm_roles: readonly string[];
  readonly design_compat: {
    readonly systems: readonly string[];
    readonly art_directions?: readonly string[];
    readonly composition_families?: readonly string[];
    readonly visual_energy_range?: readonly [number, number];
  };
  readonly positioning_compat?: readonly string[];
  readonly motion_pattern: string;
  readonly composition: {
    readonly density: 'sparse' | 'medium' | 'dense';
    readonly background_weight: 'light' | 'dark' | 'accent' | 'image';
    readonly focal_weight: 0 | 1 | 2 | 3;
    readonly approx_vh: number;
  };
  readonly motion_density: number;
  readonly novelty_class: string;
  readonly arrangements: readonly ArrangementView[];
  readonly fallback: boolean;
  /**
   * `scaffold` variants exist so the pipeline is end-to-end testable. They are excluded from the
   * eligible set of any build that is not explicitly a fixture build.
   */
  readonly status: 'active' | 'scaffold' | 'frozen' | 'retired';
}

export interface ArrangementView {
  readonly id: string;
  readonly requires: readonly string[];
  readonly novelty_class: string;
  readonly signature_move: string | null;
  readonly asset_constraints: readonly {
    readonly slot: string;
    readonly min_aspect?: number;
    readonly max_aspect?: number;
    readonly min_width?: number;
  }[];
}

export interface BeatView {
  readonly id: string;
  readonly families: readonly string[];
  readonly required: boolean;
  readonly focal_weight?: number;
  readonly min?: number;
  readonly max?: number;
}

export interface ArchetypeView {
  readonly id: string;
  readonly requires: readonly string[];
  readonly beats: readonly BeatView[];
  readonly narrative_rules: readonly string[];
  readonly rhythm_profile: {
    readonly roles: readonly string[];
    readonly intensity_targets: readonly number[];
    readonly tolerance: number;
  };
  /** Archetypes that tell a nearby story, tried before giving up (retreat step four). */
  readonly siblings: readonly string[];
  readonly status: 'active' | 'scaffold' | 'frozen' | 'retired';
}

export interface DesignSystemView {
  readonly id: string;
  readonly version: string;
  readonly composition_family: string;
  readonly visual_energy: number;
  readonly motion_pattern_allowlist: readonly string[];
  readonly art_direction_compat: readonly string[];
  readonly positioning_compat: readonly string[];
  readonly status: 'active' | 'reference' | 'frozen' | 'retired';
}

export interface ArtDirectionView {
  readonly id: string;
  readonly version: string;
  readonly requires: readonly string[];
  readonly compatible_systems: readonly string[];
  readonly positioning_compat: readonly string[];
  readonly grade_id: string;
  readonly status: 'active' | 'frozen' | 'retired';
}

export interface PositioningView {
  readonly id: string;
  readonly requires: readonly string[];
  readonly archetype_boosts: Readonly<Record<string, number>>;
  readonly preferred_art_directions: readonly string[];
  readonly visual_energy_range: readonly [number, number];
  readonly rhythm_bias: 'spacious' | 'neutral' | 'dense';
}

export interface PlaybookView {
  readonly id: string;
  readonly version: string;
  readonly supported_positions: readonly string[];
  readonly default_position: string;
  readonly preferred_archetypes: readonly string[];
  readonly preferred_systems: readonly string[];
  readonly preferred_art_directions: readonly string[];
  readonly section_boosts: Readonly<Record<string, number>>;
  readonly reviewed: string;
  readonly status: 'active' | 'frozen' | 'retired';
}

export interface LibraryView {
  readonly commit: string;
  readonly variants: readonly VariantView[];
  readonly archetypes: readonly ArchetypeView[];
  readonly designSystems: readonly DesignSystemView[];
  readonly artDirections: readonly ArtDirectionView[];
  readonly positions: readonly PositioningView[];
  readonly playbooks: readonly PlaybookView[];
}

/** Every predicate string anywhere in the library, so the snapshot is computed in one pass. */
export function allPredicates(library: LibraryView): string[] {
  const out = new Set<string>();
  const add = (predicates: readonly string[]): void => {
    for (const predicate of predicates) out.add(predicate);
  };

  for (const variant of library.variants) {
    add(variant.requires);
    add(variant.enhanced_by.map((entry) => entry.predicate));
    for (const arrangement of variant.arrangements) add(arrangement.requires);
  }
  for (const archetype of library.archetypes) add(archetype.requires);
  for (const artDirection of library.artDirections) add(artDirection.requires);
  for (const position of library.positions) add(position.requires);

  return [...out];
}
