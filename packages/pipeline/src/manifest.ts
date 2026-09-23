/**
 * The Decision Manifest (v4 §16, ARCHITECTURE §5).
 *
 * "The rationale is derived from the predicate evaluation snapshot, not written by the model."
 *
 * Everything needed to explain the site has already been computed by the time this runs. The
 * manifest is a projection over that record: the predicate snapshot, the eligible sets, the
 * boosts that were applied, and the substitutions that happened. Every human-readable sentence
 * is a **template over a recorded value** — `${id} needs ${predicate}; you have ${actual}` — and
 * there is a test asserting that no field originates from model output.
 *
 * A model may write a one-line summary *from* a finished manifest for the client-facing page,
 * marked non-authoritative. It may never be the source of a reason. A model-authored explanation
 * of a code-made decision is confabulation with good manners, and it will eventually explain a
 * decision that was never made.
 */
import type { PredicateEvaluation, PredicateSnapshot } from '@ada/contract';
import type { Substitution } from './state.js';

export interface RuledOut {
  readonly id: string;
  /** The predicate that failed, verbatim. */
  readonly failed: string;
  /** What the registry actually had. */
  readonly actual: unknown;
  /** Templated from `failed` and `actual`. Never free text. */
  readonly sentence: string;
}

export interface Decision {
  readonly stage: string;
  readonly chosen: string;
  readonly eligible_were: readonly string[];
  readonly ruled_out: readonly RuledOut[];
  readonly influenced_by: Readonly<Record<string, unknown>>;
  /** Present when the compat ladder had to retreat to place this. */
  readonly retreated_to?: string;
}

export interface DecisionManifest {
  readonly build_id: string;
  readonly seed: number;
  readonly pinned: Readonly<Record<string, string>>;
  readonly decisions: readonly Decision[];
  readonly substitutions: readonly (Substitution & { sentence: string })[];
  readonly predicate_snapshot: PredicateSnapshot;
  /** Provenance of the manifest itself, so its authority is legible. */
  readonly derived_from: 'predicate_snapshot';
  readonly model_authored_fields: readonly [];
}

/** Turn `count(proof.projects[...]) >= 4` into something a business owner can act on. */
export function templateSentence(id: string, evaluation: PredicateEvaluation): string {
  const requirement = describeRequirement(evaluation.predicate);
  const actual = describeActual(evaluation.actual);
  return `${id} needs ${requirement}; you have ${actual}.`;
}

function describeRequirement(predicate: string): string {
  // `count(path[filter]) >= N` is the overwhelmingly common shape, and the one worth reading
  // well. Anything else is quoted verbatim rather than paraphrased — a wrong paraphrase of a
  // gate is worse than an unfriendly one.
  const counted = /^count\(([a-z_.]+)(?:\[(.*)\])?\)\s*(>=|>|==)\s*(\d+)$/i.exec(predicate.trim());
  if (counted) {
    const [, path, filter, , n] = counted;
    const what = humanisePath(path ?? '');
    const qualifier = filter ? ` matching ${filter}` : '';
    return `${n} ${what}${qualifier}`;
  }
  const exists = /^exists\(([a-z_.]+)\)$/i.exec(predicate.trim());
  if (exists) return `a ${humanisePath(exists[1] ?? '')}`;
  return `\`${predicate}\``;
}

function humanisePath(path: string): string {
  const leaf = path.split('.').pop() ?? path;
  return leaf.replace(/_/g, ' ');
}

function describeActual(actual: unknown): string {
  if (typeof actual === 'number') return String(actual);
  if (actual === undefined || actual === null) return 'none';
  if (Array.isArray(actual)) return String(actual.length);
  if (typeof actual === 'boolean') return actual ? 'yes' : 'no';
  return String(actual);
}

export function ruledOutFor(
  ids: readonly string[],
  requiresById: ReadonlyMap<string, readonly string[]>,
  snapshot: PredicateSnapshot,
): RuledOut[] {
  const byPredicate = new Map(snapshot.map((row) => [row.predicate, row]));
  const out: RuledOut[] = [];

  for (const id of ids) {
    const requires = requiresById.get(id) ?? [];
    for (const predicate of requires) {
      const evaluation = byPredicate.get(predicate);
      if (evaluation?.result === true) continue;
      const row: PredicateEvaluation = evaluation ?? {
        predicate,
        actual: undefined,
        result: false,
        error: 'not evaluated in this build',
      };
      out.push({
        id,
        failed: predicate,
        actual: row.actual ?? null,
        sentence: templateSentence(id, row),
      });
      // One reason per ruled-out id: the first unmet gate is the one to fix.
      break;
    }
  }

  return out;
}

export function substitutionSentence(substitution: Substitution): string {
  return `${substitution.from} was replaced with ${substitution.to} at the ${substitution.stage} stage because ${substitution.reason.replace(/_/g, ' ')}.`;
}

export function buildManifest(input: {
  build_id: string;
  seed: number;
  pinned: Readonly<Record<string, string>>;
  decisions: readonly Decision[];
  snapshot: PredicateSnapshot;
  substitutions: readonly Substitution[];
}): DecisionManifest {
  return {
    build_id: input.build_id,
    seed: input.seed,
    pinned: input.pinned,
    decisions: input.decisions,
    substitutions: input.substitutions.map((substitution) => ({
      ...substitution,
      sentence: substitutionSentence(substitution),
    })),
    predicate_snapshot: input.snapshot,
    derived_from: 'predicate_snapshot',
    model_authored_fields: [],
  };
}

/**
 * Every string a client could read, so a test can assert each one is reachable from the snapshot
 * and none of it came from a model.
 */
export function manifestSentences(manifest: DecisionManifest): string[] {
  return [
    ...manifest.decisions.flatMap((decision) => decision.ruled_out.map((row) => row.sentence)),
    ...manifest.substitutions.map((substitution) => substitution.sentence),
  ];
}
