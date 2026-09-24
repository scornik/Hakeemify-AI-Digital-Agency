/**
 * The model-call wrapper (ARCHITECTURE §5).
 *
 * One implementation, used by every model node. It is the only place in the system that talks to
 * a model, and it is built so that the interesting failure modes are structurally impossible or
 * bounded:
 *
 * - the schema's enums **are** the eligible set, so an ineligible id cannot be named;
 * - the memo key is the eligible set, the prompt and the seed, with the **model id excluded**, so
 *   swapping providers does not silently change a decision that was already made;
 * - parse → coerce → re-ask (≤2) → deterministic fallback, each stage bounded;
 * - proposing the same rejected id twice terminates the call rather than spending the budget;
 * - both a call count and a USD ceiling bound the run;
 * - `finish_reason === 'length'` is a hard failure, never a partial accept.
 */
import { buildSelectionSchema, shortHash, stableHash, type JsonSchemaObject } from '@ada/contract';

export interface ModelRequest {
  readonly schema: JsonSchemaObject;
  readonly system: string;
  readonly user: string;
  readonly seed: number;
}

export interface ModelResponse {
  /** Raw text the provider returned. Parsed and validated here, never trusted. */
  readonly text: string;
  readonly finish_reason: 'stop' | 'length' | 'content_filter' | 'error';
  readonly cost_usd: number;
  readonly model: string;
  readonly provider: string;
}

export interface ModelProvider {
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse> | ModelResponse;
}

export const GUARDRAIL_CODES = [
  'unparseable_json',
  'not_an_object',
  'missing_field',
  'unknown_field',
  'ineligible_value',
  'truncated_output',
  'provider_error',
  'repeated_rejection',
] as const;
export type GuardrailCode = (typeof GUARDRAIL_CODES)[number];

export interface GuardrailFailure {
  readonly code: GuardrailCode;
  readonly field?: string;
  readonly value?: string;
  readonly message: string;
}

export type SelectionOutcome<T> =
  | {
      readonly kind: 'selected';
      readonly value: T;
      readonly attempts: number;
      readonly guardrails: readonly GuardrailFailure[];
      readonly memo_hit: boolean;
      readonly cost_usd: number;
      readonly model: string;
      readonly provider: string;
      readonly finish_reason: string;
      readonly coercions: readonly string[];
    }
  | {
      readonly kind: 'fallback';
      readonly value: T;
      readonly attempts: number;
      readonly guardrails: readonly GuardrailFailure[];
      readonly reason: string;
      readonly cost_usd: number;
    }
  | {
      readonly kind: 'stuck';
      readonly attempts: number;
      readonly guardrails: readonly GuardrailFailure[];
      readonly reason: string;
      readonly cost_usd: number;
    }
  | {
      readonly kind: 'budget_exceeded';
      readonly reason: string;
      readonly cost_usd: number;
    };

export interface BudgetLedger {
  calls: number;
  cost_usd: number;
  readonly max_calls: number;
  readonly max_cost_usd: number;
  /** `Date.now()` when the run started; the wall-clock ceiling is measured from it. */
  readonly started_at_ms: number;
  readonly max_wall_clock_ms: number;
  /** Injected so a test can exhaust a time budget without waiting for it. */
  readonly now?: () => number;
}

export interface SelectionRequest {
  readonly stage: string;
  /** Field name -> the eligible ids for that field. The schema is generated from exactly this. */
  readonly fields: Readonly<Record<string, readonly string[]>>;
  /** Layered prompt fragments: base -> niche -> archetype -> positioning. */
  readonly promptFragments: readonly string[];
  readonly seed: number;
  /**
   * The deterministic answer when the model cannot produce a valid one. Must itself be eligible;
   * the wrapper asserts that rather than trusting the caller.
   */
  readonly fallback: Readonly<Record<string, string>>;
  readonly maxReasks?: number;
}

export interface MemoStore {
  get(key: string): Record<string, string> | undefined;
  set(key: string, value: Record<string, string>): void;
}

export class MemoryMemoStore implements MemoStore {
  private readonly rows = new Map<string, Record<string, string>>();
  get(key: string): Record<string, string> | undefined {
    return this.rows.get(key);
  }
  set(key: string, value: Record<string, string>): void {
    this.rows.set(key, value);
  }
  get size(): number {
    return this.rows.size;
  }
}

/**
 * The memo key. The model id is deliberately **not** part of it: a decision made from a given
 * eligible set, prompt and seed is the same decision whoever answered, and including the model
 * would silently invalidate every cached decision on a model upgrade.
 */
export function memoKey(request: SelectionRequest): string {
  const normalisedFields: Record<string, string[]> = {};
  for (const [field, eligible] of Object.entries(request.fields)) {
    normalisedFields[field] = [...new Set(eligible)].sort();
  }
  return shortHash({
    stage: request.stage,
    fields: normalisedFields,
    prompt: request.promptFragments,
    seed: request.seed,
  });
}

export class SelectionError extends Error {
  constructor(
    message: string,
    readonly code: GuardrailCode,
  ) {
    super(message);
    this.name = 'SelectionError';
  }
}

/** Validate a model's answer against the eligible sets. Never throws on bad input. */
export function validateSelection(
  raw: unknown,
  fields: Readonly<Record<string, readonly string[]>>,
): { ok: true; value: Record<string, string> } | { ok: false; failures: GuardrailFailure[] } {
  const failures: GuardrailFailure[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      failures: [{ code: 'not_an_object', message: 'the response was not a JSON object' }],
    };
  }

  const record = raw as Record<string, unknown>;
  const value: Record<string, string> = {};

  for (const [field, eligible] of Object.entries(fields)) {
    const chosen = record[field];
    if (chosen === undefined) {
      failures.push({ code: 'missing_field', field, message: `no value for "${field}"` });
      continue;
    }
    if (typeof chosen !== 'string' || !eligible.includes(chosen)) {
      failures.push({
        code: 'ineligible_value',
        field,
        value: String(chosen),
        message: `"${String(chosen)}" is not one of the eligible ids for "${field}"`,
      });
      continue;
    }
    value[field] = chosen;
  }

  for (const key of Object.keys(record)) {
    if (!(key in fields)) {
      failures.push({ code: 'unknown_field', field: key, message: `unexpected field "${key}"` });
    }
  }

  return failures.length === 0 ? { ok: true, value } : { ok: false, failures };
}

/**
 * Repair a nearly-right answer without asking again: trim whitespace, and accept a
 * case-insensitive match against an eligible id. Every coercion is recorded, because a system
 * that quietly fixes model output is a system nobody can debug.
 */
export function coerceSelection(
  raw: unknown,
  fields: Readonly<Record<string, readonly string[]>>,
): { value: unknown; coercions: string[] } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { value: raw, coercions: [] };
  }
  const record = { ...(raw as Record<string, unknown>) };
  const coercions: string[] = [];

  for (const [field, eligible] of Object.entries(fields)) {
    const chosen = record[field];
    if (typeof chosen !== 'string') continue;
    if (eligible.includes(chosen)) continue;

    const trimmed = chosen.trim();
    if (eligible.includes(trimmed)) {
      record[field] = trimmed;
      coercions.push(`${field}: trimmed whitespace`);
      continue;
    }
    const insensitive = eligible.find((id) => id.toLowerCase() === trimmed.toLowerCase());
    if (insensitive !== undefined) {
      record[field] = insensitive;
      coercions.push(`${field}: matched "${trimmed}" case-insensitively to "${insensitive}"`);
    }
  }

  return { value: record, coercions };
}

function assertFallbackEligible(request: SelectionRequest): void {
  for (const [field, eligible] of Object.entries(request.fields)) {
    const value = request.fallback[field];
    if (value === undefined || !eligible.includes(value)) {
      throw new SelectionError(
        `the deterministic fallback for "${field}" is not in the eligible set; the pipeline ` +
          'must never fall back to something it just decided was ineligible',
        'ineligible_value',
      );
    }
  }
}

export interface SelectOptions {
  readonly provider: ModelProvider;
  readonly memo: MemoStore;
  readonly ledger: BudgetLedger;
}

/**
 * Ask the model to choose. Returns an outcome rather than throwing, because every failure mode
 * here is a run-state transition the caller has to record.
 */
export async function select(
  request: SelectionRequest,
  options: SelectOptions,
): Promise<SelectionOutcome<Record<string, string>>> {
  assertFallbackEligible(request);

  const key = memoKey(request);
  const memoed = options.memo.get(key);
  if (memoed) {
    return {
      kind: 'selected',
      value: memoed,
      attempts: 0,
      guardrails: [],
      memo_hit: true,
      cost_usd: 0,
      model: 'memo',
      provider: 'memo',
      finish_reason: 'stop',
      coercions: [],
    };
  }

  const schema = buildSelectionSchema(
    Object.entries(request.fields).map(([name, eligible]) => ({ name, eligible })),
  );

  const maxReasks = request.maxReasks ?? 2;
  const guardrails: GuardrailFailure[] = [];
  const rejected = new Set<string>();
  let spent = 0;
  let attempts = 0;
  let feedback = '';

  for (let attempt = 0; attempt <= maxReasks; attempt += 1) {
    if (options.ledger.calls >= options.ledger.max_calls) {
      return {
        kind: 'budget_exceeded',
        reason: `run reached its ceiling of ${options.ledger.max_calls} model calls`,
        cost_usd: spent,
      };
    }
    if (options.ledger.cost_usd >= options.ledger.max_cost_usd) {
      return {
        kind: 'budget_exceeded',
        reason: `run reached its ceiling of $${options.ledger.max_cost_usd}`,
        cost_usd: spent,
      };
    }
    // Checked alongside cost rather than instead of it: a run against a local model spends
    // nothing and can still never finish.
    const elapsed = (options.ledger.now ?? Date.now)() - options.ledger.started_at_ms;
    if (elapsed >= options.ledger.max_wall_clock_ms) {
      return {
        kind: 'budget_exceeded',
        reason:
          `run reached its ceiling of ${options.ledger.max_wall_clock_ms} ms ` +
          `(${elapsed} ms elapsed)`,
        cost_usd: spent,
      };
    }

    attempts += 1;
    options.ledger.calls += 1;

    const response = await options.provider.complete({
      schema,
      system: request.promptFragments.join('\n\n'),
      user: feedback,
      seed: request.seed,
    });

    options.ledger.cost_usd += response.cost_usd;
    spent += response.cost_usd;

    if (response.finish_reason === 'length') {
      // A truncated selection is not a partial selection. Never accept it.
      guardrails.push({
        code: 'truncated_output',
        message: 'the response was cut off; a truncated selection is never accepted',
      });
      break;
    }
    if (response.finish_reason !== 'stop') {
      guardrails.push({
        code: 'provider_error',
        message: `the provider stopped with "${response.finish_reason}"`,
      });
      feedback = 'The previous response did not complete. Answer again.';
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      guardrails.push({ code: 'unparseable_json', message: 'the response was not valid JSON' });
      feedback = 'The previous response was not valid JSON. Answer with JSON only.';
      continue;
    }

    const { value: coerced, coercions } = coerceSelection(parsed, request.fields);
    const validated = validateSelection(coerced, request.fields);

    if (validated.ok) {
      options.memo.set(key, validated.value);
      return {
        kind: 'selected',
        value: validated.value,
        attempts,
        guardrails,
        memo_hit: false,
        cost_usd: spent,
        model: response.model,
        provider: response.provider,
        finish_reason: response.finish_reason,
        coercions,
      };
    }

    for (const failure of validated.failures) {
      guardrails.push(failure);
      if (failure.code === 'ineligible_value' && failure.field && failure.value) {
        const signature = `${failure.field}=${failure.value}`;
        if (rejected.has(signature)) {
          // Proposing something already rejected is the stuck signal. A third attempt will not
          // help, and spending the budget to discover that is the thing to avoid.
          return {
            kind: 'stuck',
            attempts,
            guardrails: [
              ...guardrails,
              {
                code: 'repeated_rejection',
                field: failure.field,
                value: failure.value,
                message: `"${failure.value}" was proposed for "${failure.field}" twice after being rejected`,
              },
            ],
            reason: `the model re-proposed the rejected value "${failure.value}" for "${failure.field}"`,
            cost_usd: spent,
          };
        }
        rejected.add(signature);
      }
    }

    feedback = [
      'The previous answer was rejected:',
      ...validated.failures.map((failure) => `- ${failure.message}`),
      'Answer again, choosing only from the allowed values.',
    ].join('\n');
  }

  return {
    kind: 'fallback',
    value: { ...request.fallback },
    attempts,
    guardrails,
    reason: `no valid selection after ${attempts} attempt(s); used the deterministic fallback`,
    cost_usd: spent,
  };
}

/** The audit row every call leaves behind, whatever its outcome. */
export function callRecord(input: {
  call_id: string;
  stage: string;
  outcome: SelectionOutcome<Record<string, string>>;
  request: SelectionRequest;
  duration_ms: number;
}): {
  call_id: string;
  stage: string;
  provider: string;
  model: string;
  schema_hash: string;
  prompt_hash: string;
  output_hash: string;
  cost_usd: number;
  duration_ms: number;
  finish_reason: string;
  attempts: number;
  guardrail_codes: string[];
  memo_hit: boolean;
} {
  const outcome = input.outcome;
  const value = 'value' in outcome ? outcome.value : {};
  return {
    call_id: input.call_id,
    stage: input.stage,
    provider: outcome.kind === 'selected' ? outcome.provider : 'none',
    model: outcome.kind === 'selected' ? outcome.model : 'none',
    schema_hash: shortHash(input.request.fields),
    prompt_hash: shortHash(input.request.promptFragments),
    output_hash: stableHash(value).slice(0, 16),
    cost_usd: outcome.cost_usd,
    duration_ms: input.duration_ms,
    finish_reason: outcome.kind === 'selected' ? outcome.finish_reason : outcome.kind,
    attempts: 'attempts' in outcome ? outcome.attempts : 0,
    guardrail_codes: 'guardrails' in outcome ? outcome.guardrails.map((g) => g.code) : [],
    memo_hit: outcome.kind === 'selected' ? outcome.memo_hit : false,
  };
}
