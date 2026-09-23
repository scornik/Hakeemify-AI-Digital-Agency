/**
 * Deterministic fake providers for tests.
 *
 * No test in this package calls a real provider. That is not only about cost: a pipeline whose
 * tests depend on a model's mood cannot assert that a decision is reproducible, and
 * reproducibility is one of the things being built.
 */
import type { ModelProvider, ModelRequest, ModelResponse } from './wrapper.js';

function enumsOf(request: ModelRequest): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {};
  for (const [name, node] of Object.entries(request.schema.properties)) {
    if ('enum' in node) out[name] = node.enum;
  }
  return out;
}

/** Deterministic index into a list, derived from the seed. Same seed, same choice, always. */
export function seededIndex(seed: number, length: number, salt = 0): number {
  if (length <= 0) return 0;
  // A small LCG step keeps neighbouring seeds from picking neighbouring options.
  const mixed = Math.abs(Math.imul(seed + salt * 0x9e3779b1, 0x85ebca6b) >>> 0);
  return mixed % length;
}

/** Always answers with a valid selection, chosen deterministically from the schema's enums. */
export function obedientProvider(name = 'fake'): ModelProvider {
  return {
    name,
    complete(request: ModelRequest): ModelResponse {
      const choice: Record<string, string> = {};
      let salt = 0;
      for (const [field, eligible] of Object.entries(enumsOf(request))) {
        salt += 1;
        choice[field] = eligible[seededIndex(request.seed, eligible.length, salt)] as string;
      }
      return {
        text: JSON.stringify(choice),
        finish_reason: 'stop',
        cost_usd: 0.001,
        model: 'fake-obedient',
        provider: name,
      };
    },
  };
}

/** Answers with a scripted sequence of raw strings, then falls back to obedient behaviour. */
export function scriptedProvider(script: readonly Partial<ModelResponse>[]): ModelProvider {
  let index = 0;
  const obedient = obedientProvider('scripted');
  return {
    name: 'scripted',
    complete(request: ModelRequest): ModelResponse {
      const step = script[index];
      index += 1;
      if (!step) return obedient.complete(request) as ModelResponse;
      return {
        text: step.text ?? '{}',
        finish_reason: step.finish_reason ?? 'stop',
        cost_usd: step.cost_usd ?? 0.001,
        model: step.model ?? 'fake-scripted',
        provider: 'scripted',
      };
    },
  };
}

/** Always names something outside the eligible set, and always the same thing. */
export function stubbornProvider(value = 'not_eligible'): ModelProvider {
  return {
    name: 'stubborn',
    complete(request: ModelRequest): ModelResponse {
      const choice: Record<string, string> = {};
      for (const field of Object.keys(enumsOf(request))) choice[field] = value;
      return {
        text: JSON.stringify(choice),
        finish_reason: 'stop',
        cost_usd: 0.001,
        model: 'fake-stubborn',
        provider: 'stubborn',
      };
    },
  };
}

/** Costs a fixed amount per call, for exercising the USD ceiling. */
export function expensiveProvider(costPerCall: number): ModelProvider {
  const obedient = obedientProvider('expensive');
  return {
    name: 'expensive',
    complete(request: ModelRequest): ModelResponse {
      return { ...(obedient.complete(request) as ModelResponse), cost_usd: costPerCall };
    },
  };
}
