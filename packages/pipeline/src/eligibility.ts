/**
 * Eligibility and the compat filter (v4 §13 steps 2 and 6, ARCHITECTURE §5).
 *
 * Two different things, deliberately kept apart:
 *
 * - **Eligibility** is evidence. It asks whether the fact registry supports a thing at all, and
 *   its answer is `requires`. Nothing relaxes it. Ever.
 * - **Compatibility** is taste and coherence. It asks whether a thing fits the design system,
 *   art direction and positioning that were chosen. It relaxes, in a fixed order, when a beat
 *   would otherwise have nothing to fill it.
 *
 * The retreat order is `design_compat → art direction → positioning → sibling archetype`, and
 * the step that does not exist is "relax requires". ARCHITECTURE calls this "the invariant that
 * carries the entire grounding guarantee; it is also the one most likely to come under deadline
 * pressure". It is enforced structurally here: the retreat ladder is a list of *filters over
 * compatible candidates*, and the eligible set it draws from was computed before the ladder ran.
 */
import { requiresSatisfied, type PredicateSnapshot } from '@ada/contract';
import type {
  ArchetypeView,
  ArrangementView,
  ArtDirectionView,
  DesignSystemView,
  LibraryView,
  PositioningView,
  VariantView,
} from './library-view.js';
import type { CreativeDirection, EligibleSets } from './state.js';

export interface EligibilityOptions {
  /** Fixture builds may use scaffold sections. Real client builds never can. */
  readonly allowScaffold?: boolean;
}

function selectable(status: string, options: EligibilityOptions): boolean {
  if (status === 'active' || status === 'reference') return true;
  if (status === 'scaffold') return options.allowScaffold === true;
  return false;
}

export function eligibleVariants(
  library: LibraryView,
  snapshot: PredicateSnapshot,
  options: EligibilityOptions = {},
): VariantView[] {
  return library.variants.filter(
    (variant) =>
      selectable(variant.status, options) && requiresSatisfied(snapshot, variant.requires),
  );
}

export function eligibleArrangements(
  variant: VariantView,
  snapshot: PredicateSnapshot,
): ArrangementView[] {
  return variant.arrangements.filter((arrangement) =>
    requiresSatisfied(snapshot, arrangement.requires),
  );
}

export function eligibleArchetypes(
  library: LibraryView,
  snapshot: PredicateSnapshot,
  options: EligibilityOptions = {},
): ArchetypeView[] {
  return library.archetypes.filter(
    (archetype) =>
      selectable(archetype.status, options) && requiresSatisfied(snapshot, archetype.requires),
  );
}

export function eligibleArtDirections(
  library: LibraryView,
  snapshot: PredicateSnapshot,
  options: EligibilityOptions = {},
): ArtDirectionView[] {
  return library.artDirections.filter(
    (direction) =>
      selectable(direction.status, options) && requiresSatisfied(snapshot, direction.requires),
  );
}

export function eligiblePositions(
  library: LibraryView,
  snapshot: PredicateSnapshot,
): PositioningView[] {
  return library.positions.filter((position) => requiresSatisfied(snapshot, position.requires));
}

export function eligibleDesignSystems(
  library: LibraryView,
  options: EligibilityOptions = {},
): DesignSystemView[] {
  // Design systems carry no `requires`: they are token files, and no fact gates a typeface.
  return library.designSystems.filter((system) => selectable(system.status, options));
}

export function computeEligibleSets(
  library: LibraryView,
  snapshot: PredicateSnapshot,
  options: EligibilityOptions = {},
): EligibleSets {
  const variants = eligibleVariants(library, snapshot, options);
  const arrangements: Record<string, string[]> = {};
  for (const variant of variants) {
    arrangements[variant.id] = eligibleArrangements(variant, snapshot).map((a) => a.id);
  }

  return {
    positions: eligiblePositions(library, snapshot).map((p) => p.id),
    archetypes: eligibleArchetypes(library, snapshot, options).map((a) => a.id),
    design_systems: eligibleDesignSystems(library, options).map((s) => s.id),
    art_directions: eligibleArtDirections(library, snapshot, options).map((a) => a.id),
    variants: variants.map((v) => v.id),
    arrangements,
  };
}

// ---------------------------------------------------------------------------------------------
// Compat filter and the retreat ladder
// ---------------------------------------------------------------------------------------------

export const RETREAT_STEPS = [
  'none',
  'design_compat',
  'art_direction',
  'positioning',
  'sibling_archetype',
] as const;
export type RetreatStep = (typeof RETREAT_STEPS)[number];

export interface CompatContext {
  readonly direction: CreativeDirection;
  readonly designSystem: DesignSystemView;
  readonly positioning: PositioningView | null;
  readonly artDirection: ArtDirectionView | null;
}

function matchesDesignCompat(variant: VariantView, context: CompatContext): boolean {
  const compat = variant.design_compat;
  if (!compat.systems.includes(context.direction.design_system_id)) return false;

  if (compat.composition_families && compat.composition_families.length > 0) {
    if (!compat.composition_families.includes(context.designSystem.composition_family))
      return false;
  }
  if (compat.visual_energy_range) {
    const [min, max] = compat.visual_energy_range;
    if (context.designSystem.visual_energy < min || context.designSystem.visual_energy > max) {
      return false;
    }
  }
  // The motion allowlist is part of the design system's identity, not a preference.
  if (!context.designSystem.motion_pattern_allowlist.includes(variant.motion_pattern)) return false;

  return true;
}

function matchesArtDirection(variant: VariantView, context: CompatContext): boolean {
  const allowed = variant.design_compat.art_directions;
  if (!allowed || allowed.length === 0) return true;
  return allowed.includes(context.direction.art_direction_id);
}

function matchesPositioning(variant: VariantView, context: CompatContext): boolean {
  if (!variant.positioning_compat || variant.positioning_compat.length === 0) return true;
  if (!context.positioning) return true;
  return variant.positioning_compat.includes(context.positioning.id);
}

/**
 * The ladder. Each step *drops* one compatibility filter; none of them touches `requires`,
 * because the candidates handed in are already the eligible ones.
 */
const LADDER: readonly {
  step: RetreatStep;
  predicates: ((variant: VariantView, context: CompatContext) => boolean)[];
}[] = [
  { step: 'none', predicates: [matchesDesignCompat, matchesArtDirection, matchesPositioning] },
  { step: 'design_compat', predicates: [matchesArtDirection, matchesPositioning] },
  { step: 'art_direction', predicates: [matchesPositioning] },
  { step: 'positioning', predicates: [] },
];

export interface CompatResult {
  readonly candidates: readonly VariantView[];
  /** How far down the ladder we had to go. `sibling_archetype` is decided by the caller. */
  readonly retreatedTo: RetreatStep;
  readonly exhausted: boolean;
}

/**
 * Filter eligible variants for one beat, retreating only as far as necessary.
 *
 * `eligible` must already be the eligibility-filtered set. This function cannot re-admit a
 * variant whose `requires` failed, because it never sees one.
 */
export function compatFilter(
  eligible: readonly VariantView[],
  beatFamilies: readonly string[],
  beatId: string,
  rhythmRole: string | null,
  context: CompatContext,
): CompatResult {
  const forBeat = eligible.filter(
    (variant) =>
      beatFamilies.includes(variant.family) &&
      variant.serves_beats.includes(beatId) &&
      (rhythmRole === null ||
        variant.serves_rhythm_roles.length === 0 ||
        variant.serves_rhythm_roles.includes(rhythmRole)),
  );

  for (const rung of LADDER) {
    const candidates = forBeat.filter((variant) =>
      rung.predicates.every((predicate) => predicate(variant, context)),
    );
    if (candidates.length > 0) {
      return { candidates, retreatedTo: rung.step, exhausted: false };
    }
  }

  // Everything compatible has been relaxed and the beat is still empty. The next move belongs to
  // the caller: try a sibling archetype, then fail. Never relax `requires`.
  return { candidates: [], retreatedTo: 'positioning', exhausted: true };
}

/**
 * The retreat ladder as data, for the tests and for the manifest. Asserting on this list is how
 * the order stays documented rather than remembered.
 */
export function retreatOrder(): RetreatStep[] {
  return [...LADDER.map((rung) => rung.step).slice(1), 'sibling_archetype'];
}

/** Rank tiebreak (v4 §13 step 9). Deterministic, and never able to admit an ineligible id. */
export function rankCandidates(
  candidates: readonly VariantView[],
  input: {
    snapshot: PredicateSnapshot;
    playbookBoosts: Readonly<Record<string, number>>;
    usedNoveltyClasses: ReadonlySet<string>;
  },
): VariantView[] {
  const score = (variant: VariantView): number => {
    let total = 0;
    for (const entry of variant.enhanced_by) {
      if (requiresSatisfied(input.snapshot, [entry.predicate])) total += entry.weight;
    }
    total += input.playbookBoosts[variant.id] ?? 0;
    if (input.usedNoveltyClasses.has(variant.novelty_class)) total -= 5;
    return total;
  };

  return [...candidates].sort((a, b) => {
    const diff = score(b) - score(a);
    // Ties break on id so the same inputs always produce the same order.
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
