/**
 * The Gap Report (v4 §17).
 *
 * The manifest's `ruled_out` rows read as refusals; the same rows read forwards are the most
 * useful thing the system produces. Every predicate that failed is a thing the owner can go and
 * fix, and fixing it visibly changes the site.
 *
 * Ordered by what changes most: positioning unlocks, then archetype (the page changes shape),
 * then art direction (the page changes personality), then sections, then arrangements.
 */
import type { PredicateSnapshot } from '@ada/contract';
import { templateSentence } from './manifest.js';

export type UnlockKind =
  'positions' | 'archetypes' | 'art_directions' | 'sections' | 'arrangements';

/** Ordering is the product decision here, so it is data rather than a comparator. */
export const UNLOCK_ORDER: readonly UnlockKind[] = [
  'positions',
  'archetypes',
  'art_directions',
  'sections',
  'arrangements',
];

export interface Unlock {
  readonly provide: string;
  readonly unlocks: { readonly kind: UnlockKind; readonly ids: readonly string[] };
  readonly currently_using?: Readonly<Record<string, string>>;
  readonly impact: 'high' | 'medium' | 'low';
  readonly failed_predicate: string;
  readonly actual: unknown;
}

export interface BlockingGap {
  readonly missing: string;
  readonly why: string;
  readonly severity: 'blocking';
}

export interface GapReport {
  readonly build_id: string;
  readonly unlocks: readonly Unlock[];
  readonly blocking: readonly BlockingGap[];
}

/**
 * Turn a failed predicate into an instruction. Deliberately concrete: "4 before/after photo
 * pairs from completed jobs" rather than "more project evidence".
 */
export function describeProvision(predicate: string, actual: unknown): string {
  const counted = /^count\(([a-z_.]+)(?:\[(.*)\])?\)\s*(?:>=|>)\s*(\d+)$/i.exec(predicate.trim());
  if (counted) {
    const [, path, filter, needed] = counted;
    const have = typeof actual === 'number' ? actual : 0;
    const shortfall = Math.max(0, Number(needed) - have);
    const noun = describeSubject(path ?? '', filter ?? '');
    return `${shortfall} more ${noun}`;
  }
  const exists = /^exists\(([a-z_.]+)\)$/i.exec(predicate.trim());
  if (exists) return `a ${(exists[1] ?? '').split('.').pop()?.replace(/_/g, ' ') ?? 'value'}`;
  const length = /^len\(([a-z_.]+)\)\s*>=\s*(\d+)$/i.exec(predicate.trim());
  if (length) {
    return `a longer ${(length[1] ?? '').split('.').pop()?.replace(/_/g, ' ')} (at least ${length[2]} characters)`;
  }
  return `evidence satisfying \`${predicate}\``;
}

function describeSubject(path: string, filter: string): string {
  const leaf = (path.split('.').pop() ?? path).replace(/_/g, ' ');
  if (/before_photo/.test(filter) && /after_photo/.test(filter)) {
    return 'projects with both a before and an after photo';
  }
  if (/attributable/.test(filter)) return 'testimonials with a named, consenting author';
  if (/third_party/.test(filter)) return 'metrics somebody else verified';
  if (/rights\s*!=\s*"unknown"/.test(filter) && /grade_safe/.test(filter)) {
    return 'photos you own or licensed, large enough to grade';
  }
  if (filter.trim() !== '') return `${leaf} matching ${filter}`;
  return leaf;
}

export interface GapInput {
  readonly build_id: string;
  readonly snapshot: PredicateSnapshot;
  /** The ids that were ruled out, grouped by what kind of thing they are. */
  readonly ruledOut: readonly {
    readonly kind: UnlockKind;
    readonly id: string;
    readonly requires: readonly string[];
  }[];
  readonly currentlyUsing: Readonly<Record<string, string>>;
  /** Registry paths that must exist before the site can legally ship. */
  readonly missingRequired: readonly { path: string; why: string }[];
}

const IMPACT: Record<UnlockKind, Unlock['impact']> = {
  positions: 'high',
  archetypes: 'high',
  art_directions: 'high',
  sections: 'medium',
  arrangements: 'low',
};

export function buildGapReport(input: GapInput): GapReport {
  const byPredicate = new Map(input.snapshot.map((row) => [row.predicate, row]));
  const unlocks: Unlock[] = [];

  for (const kind of UNLOCK_ORDER) {
    for (const candidate of input.ruledOut.filter((row) => row.kind === kind)) {
      for (const predicate of candidate.requires) {
        const evaluation = byPredicate.get(predicate);
        if (evaluation?.result === true) continue;

        const actual = evaluation?.actual ?? null;
        const existing = unlocks.find(
          (unlock) => unlock.failed_predicate === predicate && unlock.unlocks.kind === kind,
        );
        if (existing) {
          // One instruction, many things it unlocks — that is the persuasive form.
          unlocks[unlocks.indexOf(existing)] = {
            ...existing,
            unlocks: { kind, ids: [...existing.unlocks.ids, candidate.id] },
          };
        } else {
          unlocks.push({
            provide: describeProvision(predicate, actual),
            unlocks: { kind, ids: [candidate.id] },
            ...(Object.keys(input.currentlyUsing).length > 0
              ? { currently_using: input.currentlyUsing }
              : {}),
            impact: IMPACT[kind],
            failed_predicate: predicate,
            actual,
          });
        }
        break;
      }
    }
  }

  return {
    build_id: input.build_id,
    unlocks,
    blocking: input.missingRequired.map((row) => ({
      missing: row.path,
      why: row.why,
      severity: 'blocking' as const,
    })),
  };
}

/** The client-facing line for one unlock. Templated, like every other sentence the system emits. */
export function unlockSentence(unlock: Unlock): string {
  const evaluation = {
    predicate: unlock.failed_predicate,
    actual: unlock.actual,
    result: false,
  };
  const ids = unlock.unlocks.ids.join(', ');
  return `Provide ${unlock.provide} to unlock ${ids}. ${templateSentence(ids, evaluation)}`;
}
