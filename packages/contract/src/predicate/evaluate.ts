/**
 * Predicate evaluator (v4 §2, ARCHITECTURE §3).
 *
 * Pure, deterministic, no I/O. Evaluation is total: any input, well-formed or not, produces a
 * result rather than an exception.
 *
 * Semantics decided here, because v4 states the principle ("a missing path evaluates to
 * false / 0 / empty — never throws") without enumerating the cases:
 *
 * - **A missing path makes every comparison false, `!=` included.** `rights != "unknown"` must
 *   not admit an asset whose `rights` field is simply absent. Gates fail closed or they are
 *   not gates.
 * - **An empty array is falsy.** `media.photos` as a bare term means "has photos", not "has a
 *   photos key". `exists()` remains available for presence.
 * - **Ordering comparisons coerce to number**; if either side is not a finite number the
 *   comparison is false.
 * - **Filters see the item only**, not the registry root. A filter that could silently reach
 *   past its item would make `count(a[x]) ` depend on where it was written.
 * - **`Fact<T>` wrappers are transparent.** Predicates are written against the logical shape
 *   (`media.photos[...]`), so path resolution unwraps `{ value, provenance }` on the way
 *   through.
 */
import type { CallNode, PredicateAst, PredicateLiteral, SubjectNode } from './ast.js';
import { parsePredicate } from './parser.js';

/** One row of the evaluation snapshot. This is the sole input to the Decision Manifest. */
export interface PredicateEvaluation {
  readonly predicate: string;
  /** The measured subject: the left side of a top-level comparison, else the boolean result. */
  readonly actual: unknown;
  readonly result: boolean;
  /** Present only when the predicate could not be parsed. */
  readonly error?: string;
}

/** A snapshot is an ordered, de-duplicated set of evaluations, keyed by predicate source. */
export type PredicateSnapshot = readonly PredicateEvaluation[];

const FACT_KEYS = ['value', 'provenance'] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `Fact<T>` is any object carrying both `value` and `provenance`. */
function unwrapFact(value: unknown): unknown {
  let current = value;
  // A fact whose value is itself a fact is not expected, but unwrapping in a loop costs
  // nothing and removes a class of surprise.
  let guard = 0;
  while (guard < 8) {
    const candidate = current;
    if (!isPlainObject(candidate)) break;
    if (!FACT_KEYS.every((key) => key in candidate)) break;
    current = candidate['value'];
    guard += 1;
  }
  return current;
}

export function resolvePath(scope: unknown, segments: readonly string[]): unknown {
  let current: unknown = unwrapFact(scope);
  for (const segment of segments) {
    if (current === undefined || current === null) return undefined;
    if (!isPlainObject(current)) {
      // Arrays and scalars have no addressable named members in this language.
      return undefined;
    }
    current = unwrapFact(current[segment]);
  }
  return current;
}

function toList(value: unknown): unknown[] {
  const unwrapped = unwrapFact(value);
  if (unwrapped === undefined || unwrapped === null) return [];
  if (Array.isArray(unwrapped)) return unwrapped.map(unwrapFact);
  return [unwrapped];
}

export function truthy(value: unknown): boolean {
  const unwrapped = unwrapFact(value);
  if (unwrapped === undefined || unwrapped === null) return false;
  if (typeof unwrapped === 'boolean') return unwrapped;
  if (typeof unwrapped === 'number') return Number.isFinite(unwrapped) && unwrapped !== 0;
  if (typeof unwrapped === 'string') return unwrapped.length > 0;
  if (Array.isArray(unwrapped)) return unwrapped.length > 0;
  return true;
}

function toNumber(value: unknown): number {
  const unwrapped = unwrapFact(value);
  if (typeof unwrapped === 'number') return unwrapped;
  if (typeof unwrapped === 'boolean') return unwrapped ? 1 : 0;
  if (typeof unwrapped === 'string') {
    const trimmed = unwrapped.trim();
    if (trimmed === '') return Number.NaN;
    return Number(trimmed);
  }
  if (Array.isArray(unwrapped)) return unwrapped.length;
  return Number.NaN;
}

function equals(left: unknown, right: PredicateLiteral): boolean {
  const value = unwrapFact(left);
  if (right === null) return value === null;
  if (typeof right === 'boolean') return value === right;
  if (typeof right === 'number') {
    const n = toNumber(value);
    return Number.isFinite(n) && n === right;
  }
  return typeof value === 'string' && value === right;
}

function compare(op: string, left: unknown, right: PredicateLiteral): boolean {
  const value = unwrapFact(left);
  // Missing data fails every comparison, so `!=` cannot smuggle an absent field past a gate.
  if (value === undefined) return false;

  switch (op) {
    case '==':
      return equals(value, right);
    case '!=':
      return !equals(value, right);
    default: {
      const a = toNumber(value);
      const b = toNumber(right);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
      switch (op) {
        case '>=':
          return a >= b;
        case '>':
          return a > b;
        case '<=':
          return a <= b;
        default:
          // '<' — the parser emits only the six operators, so this is the last of them.
          return a < b;
      }
    }
  }
}

function itemsFor(node: CallNode, scope: unknown): unknown[] {
  const list = toList(resolvePath(scope, node.path));
  if (!node.filter) return list;
  const filter = node.filter;
  return list.filter((item) => evalAst(filter, item));
}

function evalCall(node: CallNode, scope: unknown): unknown {
  switch (node.fn) {
    case 'exists': {
      if (node.filter) return itemsFor(node, scope).length > 0;
      const value = resolvePath(scope, node.path);
      return value !== undefined && value !== null;
    }
    case 'count':
      return itemsFor(node, scope).length;
    case 'len':
      return lengthOf(node, scope);
    case 'sum': {
      let total = 0;
      for (const item of itemsFor(node, scope)) {
        const n = toNumber(item);
        if (Number.isFinite(n)) total += n;
      }
      return total;
    }
    case 'all': {
      const list = toList(resolvePath(scope, node.path));
      if (!node.filter) return list.length > 0 && list.every(truthy);
      const filter = node.filter;
      return list.every((item) => evalAst(filter, item));
    }
    case 'any': {
      const list = toList(resolvePath(scope, node.path));
      if (!node.filter) return list.some(truthy);
      const filter = node.filter;
      return list.some((item) => evalAst(filter, item));
    }
  }
}

function lengthOf(node: CallNode, scope: unknown): number {
  const raw = resolvePath(scope, node.path);
  if (typeof raw === 'string') return raw.length;
  return itemsFor(node, scope).length;
}

export function subjectValue(node: SubjectNode, scope: unknown): unknown {
  return node.t === 'call' ? evalCall(node, scope) : resolvePath(scope, node.path);
}

export function evalAst(node: PredicateAst, scope: unknown): boolean {
  switch (node.t) {
    case 'or':
      return evalAst(node.left, scope) || evalAst(node.right, scope);
    case 'and':
      return evalAst(node.left, scope) && evalAst(node.right, scope);
    case 'not':
      return !evalAst(node.expr, scope);
    case 'cmp':
      return compare(node.op, subjectValue(node.left, scope), node.right);
    case 'truthy':
      return truthy(subjectValue(node.expr, scope));
  }
}

/**
 * Evaluate one predicate against a registry. Never throws: an unparseable predicate is
 * `result: false` with the parse error attached, which fails closed.
 */
export function evaluatePredicate(predicate: string, registry: unknown): PredicateEvaluation {
  const parsed = parsePredicate(predicate);
  if (!parsed.ok) {
    return {
      predicate,
      actual: undefined,
      result: false,
      error: `${parsed.error.message} (at ${parsed.error.pos})`,
    };
  }

  try {
    const ast = parsed.ast;
    const result = evalAst(ast, registry);
    const actual =
      ast.t === 'cmp'
        ? subjectValue(ast.left, registry)
        : ast.t === 'truthy'
          ? subjectValue(ast.expr, registry)
          : result;
    return { predicate, actual, result };
  } catch (error) {
    /* c8 ignore next 7 -- defensive: every operation above is total */
    return {
      predicate,
      actual: undefined,
      result: false,
      error: error instanceof Error ? error.message : 'evaluation failed',
    };
  }
}

/**
 * Evaluate a set of predicates once, in a stable order, de-duplicated by source string.
 * This snapshot is what the Decision Manifest projects over; nothing else may explain a
 * decision.
 */
export function evaluatePredicates(
  predicates: Iterable<string>,
  registry: unknown,
): PredicateSnapshot {
  const seen = new Map<string, PredicateEvaluation>();
  for (const predicate of predicates) {
    if (seen.has(predicate)) continue;
    seen.set(predicate, evaluatePredicate(predicate, registry));
  }
  return [...seen.values()];
}

/** Look one predicate up in a snapshot. Absent predicates are not satisfied. */
export function snapshotSatisfies(snapshot: PredicateSnapshot, predicate: string): boolean {
  return snapshot.find((row) => row.predicate === predicate)?.result === true;
}

/** True only when every predicate in `requires` is present in the snapshot and satisfied. */
export function requiresSatisfied(
  snapshot: PredicateSnapshot,
  requires: readonly string[],
): boolean {
  return requires.every((predicate) => snapshotSatisfies(snapshot, predicate));
}
