/**
 * Recursive-descent parser for the v4 §2 predicate grammar.
 *
 * Two deliberate readings of the published grammar, both forced by the spec's own examples:
 *
 * 1. `expr := term (('&&' | '||') term)*` is flat and therefore ambiguous. We give `&&`
 *    higher precedence than `||`, which is what every example assumes and what every author
 *    will expect. `a && b || c` parses as `(a && b) || c`.
 *
 * 2. `term` admits a bare `path`, evaluated for truthiness. The published grammar only lists
 *    calls, comparisons and parenthesised expressions, yet v4 itself writes
 *    `count(media.photos[rights != "unknown" && grade_safe]) >= 6` and
 *    `count(proof.testimonials[attributable]) >= 3`. `grade_safe` and `attributable` are bare
 *    paths used as booleans.
 *
 * Parsing is total: malformed input returns an error, never an exception. The result is
 * cached by source string, because the same predicate strings are evaluated on every build.
 */
import {
  isCallFn,
  type CallNode,
  type ComparisonOp,
  type PathNode,
  type PredicateAst,
  type PredicateLiteral,
  type SubjectNode,
} from './ast.js';
import { lex, type Token } from './lexer.js';

export interface PredicateParseError {
  readonly message: string;
  readonly pos: number;
  readonly source: string;
}

export type ParseResult =
  | { readonly ok: true; readonly ast: PredicateAst }
  | { readonly ok: false; readonly error: PredicateParseError };

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'ParseFailure';
  }
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    // The lexer always appends an `eof` token, and the index is clamped to it, so the lookup
    // is total. The assertion removes an unreachable branch rather than hiding a real one.
    return this.tokens[Math.min(this.index, this.tokens.length - 1)] as Token;
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private expect(kind: Token['kind'], what: string): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      throw new ParseFailure(`expected ${what}, found ${describe(token)}`, token.pos);
    }
    return this.next();
  }

  parse(): PredicateAst {
    const ast = this.parseOr();
    const trailing = this.peek();
    if (trailing.kind !== 'eof') {
      throw new ParseFailure(`unexpected ${describe(trailing)} after expression`, trailing.pos);
    }
    return ast;
  }

  private parseOr(): PredicateAst {
    let left = this.parseAnd();
    while (this.peek().kind === '||') {
      this.next();
      const right = this.parseAnd();
      left = { t: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): PredicateAst {
    let left = this.parseTerm();
    while (this.peek().kind === '&&') {
      this.next();
      const right = this.parseTerm();
      left = { t: 'and', left, right };
    }
    return left;
  }

  private parseTerm(): PredicateAst {
    if (this.peek().kind === '!') {
      this.next();
      return { t: 'not', expr: this.parseTerm() };
    }

    if (this.peek().kind === '(') {
      this.next();
      const inner = this.parseOr();
      this.expect(')', "')'");
      return this.maybeComparisonOnGroup(inner);
    }

    const subject = this.parseSubject();
    const token = this.peek();
    if (token.kind === 'op') {
      this.next();
      const literal = this.parseLiteral();
      return { t: 'cmp', op: token.value as ComparisonOp, left: subject, right: literal };
    }
    return { t: 'truthy', expr: subject };
  }

  /**
   * A parenthesised expression is already boolean, so it cannot be the left side of a
   * comparison. Rejecting it here keeps `(a && b) >= 2` from silently meaning something.
   */
  private maybeComparisonOnGroup(inner: PredicateAst): PredicateAst {
    const token = this.peek();
    if (token.kind === 'op') {
      throw new ParseFailure(
        'a parenthesised expression is boolean and cannot be compared',
        token.pos,
      );
    }
    return inner;
  }

  private parseSubject(): SubjectNode {
    const token = this.expect('ident', 'a path or call');
    if (isCallFn(token.value) && this.peek().kind === '(') {
      return this.parseCall(token.value);
    }
    return this.parsePathFrom(token.value);
  }

  private parseCall(fn: CallNode['fn']): CallNode {
    this.expect('(', "'('");
    const head = this.expect('ident', 'a path inside the call');
    const path = this.readPathSegments(head.value);
    let filter: PredicateAst | undefined;
    if (this.peek().kind === '[') {
      this.next();
      filter = this.parseOr();
      this.expect(']', "']'");
    }
    this.expect(')', "')'");
    return filter === undefined ? { t: 'call', fn, path } : { t: 'call', fn, path, filter };
  }

  private parsePathFrom(head: string): PathNode {
    return { t: 'path', path: this.readPathSegments(head) };
  }

  private readPathSegments(head: string): string[] {
    const segments = [head];
    while (this.peek().kind === '.') {
      this.next();
      segments.push(this.expect('ident', 'a path segment after "."').value);
    }
    return segments;
  }

  private parseLiteral(): PredicateLiteral {
    const token = this.next();
    switch (token.kind) {
      case 'string':
        return token.value;
      case 'number':
        return Number(token.value);
      case 'true':
        return true;
      case 'false':
        return false;
      case 'null':
        return null;
      default:
        throw new ParseFailure(
          `expected a literal on the right of the comparison, found ${describe(token)}`,
          token.pos,
        );
    }
  }
}

function describe(token: Token): string {
  if (token.kind === 'eof') return 'end of input';
  if (token.kind === 'ident' || token.kind === 'number' || token.kind === 'string') {
    return `${token.kind} ${JSON.stringify(token.value)}`;
  }
  return `"${token.value}"`;
}

const cache = new Map<string, ParseResult>();

/** Parse a predicate. Total — malformed input yields `{ ok: false }`, never a throw. */
export function parsePredicate(source: string): ParseResult {
  const cached = cache.get(source);
  if (cached) return cached;

  const result = parseUncached(source);
  cache.set(source, result);
  return result;
}

function parseUncached(source: string): ParseResult {
  const lexed = lex(source);
  if (!lexed.ok) {
    return { ok: false, error: { ...lexed.error, source } };
  }
  try {
    const ast = new Parser(lexed.tokens).parse();
    return { ok: true, ast };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { ok: false, error: { message: error.message, pos: error.pos, source } };
    }
    // ParseFailure above is the only deliberate throw, so the only thing that reaches here is
    // the stack running out on pathologically nested input. Totality is a promise to the
    // eligibility engine, so that arrives as an ordinary parse error rather than an exception.
    return { ok: false, error: { message: 'predicate nests too deeply to parse', pos: 0, source } };
  }
}

/** Test seam: the cache is a pure memo, so clearing it can only cost time. */
export function clearPredicateCache(): void {
  cache.clear();
}

export function predicateCacheSize(): number {
  return cache.size;
}
