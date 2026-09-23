/**
 * Adapting the authored library to the view the pipeline reads.
 *
 * `LibraryView` is deliberately narrower than a `SectionManifest`: the pipeline needs what it
 * needs to select and assemble, and nothing else. Keeping the translation in one place means a
 * field the pipeline starts depending on is a visible change here, rather than a quiet reach
 * into the library's schema from six call sites.
 */
import type { SectionManifest } from '@ada/library';
import type { ArrangementView, VariantView } from './library-view.js';

/** The library's `Grade` union; `'ungraded'` is a literal, anything else is a graded record. */
function signatureMoveOf(arrangement: { signature_move?: string }): string | null {
  return arrangement.signature_move ?? null;
}

export function toVariantView(manifest: SectionManifest): VariantView {
  const arrangements: ArrangementView[] = manifest.arrangements.map((arrangement) => ({
    id: arrangement.id,
    requires: arrangement.requires,
    novelty_class: arrangement.novelty_class,
    signature_move: signatureMoveOf(arrangement),
    asset_constraints: arrangement.asset_constraints.map((constraint) => ({
      slot: constraint.slot,
      ...(constraint.min_aspect === undefined ? {} : { min_aspect: constraint.min_aspect }),
      ...(constraint.max_aspect === undefined ? {} : { max_aspect: constraint.max_aspect }),
      ...(constraint.min_width === undefined ? {} : { min_width: constraint.min_width }),
    })),
  }));

  return {
    id: manifest.name,
    family: manifest.family,
    requires: manifest.requires,
    enhanced_by: manifest.enhanced_by.map((entry) => ({
      predicate: entry.predicate,
      weight: entry.weight,
    })),
    serves_beats: manifest.serves_beats,
    serves_rhythm_roles: manifest.serves_rhythm_roles,
    design_compat: {
      systems: manifest.design_compat.systems,
      ...(manifest.design_compat.art_directions === undefined
        ? {}
        : { art_directions: manifest.design_compat.art_directions }),
      ...(manifest.design_compat.composition_families === undefined
        ? {}
        : { composition_families: manifest.design_compat.composition_families }),
      ...(manifest.design_compat.visual_energy_range === undefined
        ? {}
        : { visual_energy_range: manifest.design_compat.visual_energy_range }),
    },
    ...(manifest.positioning_compat === undefined
      ? {}
      : { positioning_compat: manifest.positioning_compat }),
    motion_pattern: manifest.motion.pattern,
    composition: {
      density: manifest.composition.density,
      background_weight: manifest.composition.background_weight,
      focal_weight: manifest.composition.focal_weight,
      approx_vh: manifest.composition.approx_vh,
    },
    motion_density: manifest.motion.density,
    novelty_class: manifest.novelty_class,
    arrangements,
    fallback: manifest.fallback,
    status: manifest.status,
  };
}

export function toVariantViews(manifests: readonly SectionManifest[]): VariantView[] {
  return manifests.map(toVariantView);
}

/**
 * The slot bindings a variant declares, keyed by slot name. The populate stage reads these to
 * decide what each slot may draw on — a fact query, an asset, or generated copy on a leash.
 */
export function slotSpecs(manifest: SectionManifest): Map<
  string,
  {
    required: boolean;
    kind: 'fact' | 'asset' | 'generated';
    query?: string;
    grounded_in?: readonly string[];
    max_chars?: number;
  }
> {
  const out = new Map<
    string,
    {
      required: boolean;
      kind: 'fact' | 'asset' | 'generated';
      query?: string;
      grounded_in?: readonly string[];
      max_chars?: number;
    }
  >();

  for (const binding of manifest.slots) {
    const source = binding.source;
    out.set(binding.slot, {
      required: binding.required,
      kind: source.kind,
      ...(source.kind === 'generated'
        ? { grounded_in: source.grounded_in }
        : { query: source.query }),
      ...(binding.max_chars === undefined ? {} : { max_chars: binding.max_chars }),
    });
  }
  return out;
}
