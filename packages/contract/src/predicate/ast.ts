/**
 * Predicate AST — JSON-serialisable by construction (v4 §2, ARCHITECTURE §3).
 *
 * Every node is a plain object of primitives, arrays and nested nodes. No functions, no
 * classes, no symbols: an AST can be stored in the run checkpoint and compared by value.
 */

export const CALL_FNS = ['exists', 'count', 'sum', 'len', 'all', 'any'] as const;
export type CallFn = (typeof CALL_FNS)[number];

export const COMPARISON_OPS = ['>=', '>', '<=', '<', '==', '!='] as const;
export type ComparisonOp = (typeof COMPARISON_OPS)[number];

/** Literals allowed on the right-hand side of a comparison. */
export type PredicateLiteral = string | number | boolean | null;

export interface PathNode {
  readonly t: 'path';
  /** Dotted path split into segments, e.g. `media.photos` -> ['media','photos']. */
  readonly path: readonly string[];
}

export interface CallNode {
  readonly t: 'call';
  readonly fn: CallFn;
  readonly path: readonly string[];
  /** Optional `[ ... ]` filter, evaluated once per item with the item as scope. */
  readonly filter?: PredicateAst;
}

/** A call or a bare path: the only things that can be measured or compared. */
export type SubjectNode = PathNode | CallNode;

export interface OrNode {
  readonly t: 'or';
  readonly left: PredicateAst;
  readonly right: PredicateAst;
}

export interface AndNode {
  readonly t: 'and';
  readonly left: PredicateAst;
  readonly right: PredicateAst;
}

export interface NotNode {
  readonly t: 'not';
  readonly expr: PredicateAst;
}

export interface ComparisonNode {
  readonly t: 'cmp';
  readonly op: ComparisonOp;
  readonly left: SubjectNode;
  readonly right: PredicateLiteral;
}

/** A subject used directly as a boolean, e.g. `grade_safe` or `attributable`. */
export interface TruthyNode {
  readonly t: 'truthy';
  readonly expr: SubjectNode;
}

export type PredicateAst = OrNode | AndNode | NotNode | ComparisonNode | TruthyNode;

export function isCallFn(value: string): value is CallFn {
  return (CALL_FNS as readonly string[]).includes(value);
}
