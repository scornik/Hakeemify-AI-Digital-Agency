/**
 * The model router: one `ModelProvider` in front of several, chosen per call type.
 *
 * The owner's decision was "not one provider" — OpenRouter as an aggregator, hosted providers
 * direct, and local models. That is a routing table plus a fallback order, and both live here.
 *
 * ## Why route by call type at all
 *
 * The pipeline makes two kinds of call and they have opposite economics. The enum selections
 * (`creative_direction`, `page_archetype`, `art_direction`, `positioning`, `beat_selection`,
 * `arrangement`) pick an id from a list the code computed; they are cheap, structured, heavily
 * memoised, and a small local model can answer them. Copy is the only call where quality is
 * visible to a client. Sending both to the same model wastes money on the selections or
 * quality on the copy.
 *
 * ## The rule that makes fallback safe
 *
 * A fallback may only be tried when the *provider* failed — a network error, a 5xx, a missing
 * credential. It must **never** be tried because the model gave a bad answer. Re-asking on a bad
 * answer is the wrapper's job, it counts against the call budget, and it stops after
 * `maxReasks`. A router that also retried on bad answers would multiply those attempts by the
 * chain length behind the ledger's back, and the two ceilings the owner set would both stop
 * meaning anything.
 *
 * So: `complete()` here either returns a provider's response — valid or not, untouched — or
 * moves to the next provider because no response was obtained at all.
 *
 * ## Determinism
 *
 * The memo key deliberately excludes the model id (see `memoKey`), so changing which provider
 * answers a call does not re-decide anything already decided. That property is load-bearing
 * under a router and is what makes a fallback safe to take mid-run.
 */
import type { ModelProvider, ModelRequest, ModelResponse } from './wrapper.js';

export interface RouteAttempt {
  readonly provider: string;
  readonly error: string;
}

export interface RouterOptions {
  /** Provider chain per call type. The first is preferred; the rest are fallbacks. */
  readonly routes: Readonly<Record<string, readonly ModelProvider[]>>;
  /** Used for any call type not named in `routes`. */
  readonly fallback: readonly ModelProvider[];
  /** Called once per provider that could not answer, for the run log. */
  readonly onFallback?: (stage: string, attempt: RouteAttempt) => void;
}

export class NoProviderAnsweredError extends Error {
  constructor(
    readonly stage: string,
    readonly attempts: readonly RouteAttempt[],
  ) {
    super(
      `no provider answered the ${stage} call. Tried ${attempts.length}: ` +
        attempts.map((attempt) => `${attempt.provider} (${attempt.error})`).join('; '),
    );
    this.name = 'NoProviderAnsweredError';
  }
}

export class EmptyRouteError extends Error {
  constructor(stage: string) {
    super(
      `the router has no provider for the ${stage} call and no fallback chain. A run that ` +
        'reaches this has been configured to make a call it cannot make.',
    );
    this.name = 'EmptyRouteError';
  }
}

/**
 * A router bound to one call type. `select()` takes a single `ModelProvider`, so the stage is
 * bound here rather than threaded through the request.
 */
export function routedProvider(stage: string, options: RouterOptions): ModelProvider {
  const chain = options.routes[stage] ?? options.fallback;
  if (chain.length === 0) throw new EmptyRouteError(stage);

  return {
    name: `router(${chain.map((provider) => provider.name).join('>')})`,
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const attempts: RouteAttempt[] = [];

      for (const provider of chain) {
        try {
          // Returned untouched, valid or not. Judging the answer here is what would turn the
          // fallback chain into a hidden retry loop.
          return await provider.complete(request);
        } catch (error) {
          const attempt = {
            provider: provider.name,
            error: error instanceof Error ? error.message : String(error),
          };
          attempts.push(attempt);
          options.onFallback?.(stage, attempt);
        }
      }

      throw new NoProviderAnsweredError(stage, attempts);
    },
  };
}

/**
 * The call types the pipeline routes. Kept as data so a routing table can be checked against the
 * stages that actually exist, rather than silently containing a typo that falls through to the
 * default chain forever.
 */
export const SELECTION_STAGES = [
  'creative_direction',
  'page_archetype',
  'art_direction',
  'positioning',
  'beat_selection',
  'arrangement',
] as const;

export const COPY_STAGE = 'copy';

export type RoutableStage = (typeof SELECTION_STAGES)[number] | typeof COPY_STAGE;

export class UnknownStageError extends Error {
  constructor(stages: readonly string[]) {
    super(
      `the routing table names ${stages.length} stage(s) the pipeline never calls: ` +
        `${stages.join(', ')}. Known stages: ${[...SELECTION_STAGES, COPY_STAGE].join(', ')}.`,
    );
    this.name = 'UnknownStageError';
  }
}

/**
 * Reject a routing table that names a stage the pipeline does not have. Without this a typo is
 * invisible: the misspelled entry is never looked up, the real stage silently takes the default
 * chain, and the effect is a call quietly going to the wrong model.
 */
export function assertRoutesKnown(routes: Readonly<Record<string, unknown>>): void {
  const known = new Set<string>([...SELECTION_STAGES, COPY_STAGE]);
  const unknown = Object.keys(routes).filter((stage) => !known.has(stage));
  if (unknown.length > 0) throw new UnknownStageError(unknown.sort());
}

/**
 * Build a table that sends every selection stage down one chain and copy down another — the
 * split the economics actually have. Stages not named still fall back.
 */
export function selectionAndCopyRoutes(
  selection: readonly ModelProvider[],
  copy: readonly ModelProvider[],
): Record<string, readonly ModelProvider[]> {
  const routes: Record<string, readonly ModelProvider[]> = {};
  for (const stage of SELECTION_STAGES) routes[stage] = selection;
  routes[COPY_STAGE] = copy;
  return routes;
}
