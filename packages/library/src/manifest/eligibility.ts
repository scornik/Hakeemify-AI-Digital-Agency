/**
 * Which variants a build may select from.
 *
 * The one rule this module exists for: **a `scaffold` variant is never eligible for a build
 * that is not a fixture build** (ARCHITECTURE §10). Scaffolds exist so the pipeline is
 * end-to-end testable before the library exists; the moment one can reach a client's site, the
 * human boundary has leaked and the system is shipping machine-authored design.
 *
 * Everything returned is shaped for the Decision Manifest (v4 §16): a ruled-out row carries
 * the predicate that failed and the measured value, so the rationale is derived from the
 * predicate snapshot and never narrated by a model.
 */
import { requiresSatisfied, snapshotSatisfies, type PredicateSnapshot } from '@ada/contract';
import type { SectionManifest } from './schema.js';

/**
 * A fixture build is the test harness and the committed end-to-end fixtures. A client build is
 * everything else, and the default — a caller who forgets to say gets the safe answer.
 */
export type BuildKind = 'client' | 'fixture';

export interface EligibilityOptions {
  readonly build?: BuildKind;
  /** The evaluated predicate snapshot for this registry. Omitted means "do not gate on facts". */
  readonly snapshot?: PredicateSnapshot;
  readonly designSystemId?: string;
  readonly positioningId?: string;
}

export interface RuledOut {
  readonly id: string;
  /** The predicate that failed, or a structural reason. */
  readonly failed: string;
  readonly actual?: unknown;
}

export interface EligibilityResult {
  readonly eligible: SectionManifest[];
  readonly ruled_out: RuledOut[];
}

/** v4 §12: only `active` is selectable. `scaffold` is selectable on a fixture build only. */
export function statusIsSelectable(status: SectionManifest['status'], build: BuildKind): boolean {
  if (status === 'active') return true;
  if (status === 'scaffold') return build === 'fixture';
  return false; // frozen and retired keep rendering; they are never chosen again
}

export function eligibleVariants(
  manifests: readonly SectionManifest[],
  options: EligibilityOptions = {},
): EligibilityResult {
  const build: BuildKind = options.build ?? 'client';
  const eligible: SectionManifest[] = [];
  const ruled_out: RuledOut[] = [];

  for (const manifest of manifests) {
    if (!statusIsSelectable(manifest.status, build)) {
      ruled_out.push({
        id: manifest.name,
        failed:
          manifest.status === 'scaffold'
            ? 'status == "scaffold" — excluded from every build that is not a fixture build'
            : `status == "${manifest.status}" — not selectable for new builds`,
        actual: manifest.status,
      });
      continue;
    }

    if (options.snapshot !== undefined && !requiresSatisfied(options.snapshot, manifest.requires)) {
      const failed = manifest.requires.find(
        (predicate) => !snapshotSatisfies(options.snapshot as PredicateSnapshot, predicate),
      );
      const row = options.snapshot.find((r) => r.predicate === failed);
      ruled_out.push({
        id: manifest.name,
        failed: failed ?? 'requires',
        ...(row === undefined ? {} : { actual: row.actual }),
      });
      continue;
    }

    if (
      options.designSystemId !== undefined &&
      !manifest.design_compat.systems.includes(options.designSystemId)
    ) {
      ruled_out.push({
        id: manifest.name,
        failed: `design_compat.systems does not include "${options.designSystemId}"`,
        actual: manifest.design_compat.systems,
      });
      continue;
    }

    if (
      options.positioningId !== undefined &&
      manifest.positioning_compat !== undefined &&
      !manifest.positioning_compat.includes(options.positioningId)
    ) {
      ruled_out.push({
        id: manifest.name,
        failed: `positioning_compat does not include "${options.positioningId}"`,
        actual: manifest.positioning_compat,
      });
      continue;
    }

    eligible.push(manifest);
  }

  return { eligible, ruled_out };
}

/**
 * The arrangements of one variant a build may select from. A scaffold's arrangements are all
 * `ungraded`, so the same status rule that governs the variant governs them; this function
 * exists for the `requires` gate, which arrangements carry independently (v4 §8).
 */
export function eligibleArrangements(
  manifest: SectionManifest,
  snapshot?: PredicateSnapshot,
): SectionManifest['arrangements'] {
  if (snapshot === undefined) return manifest.arrangements;
  return manifest.arrangements.filter((arrangement) =>
    requiresSatisfied(snapshot, arrangement.requires),
  );
}
