import { beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clearPredicateCache,
  parsePredicate,
  predicateCacheSize,
} from '../src/predicate/parser.js';
import type { PredicateAst } from '../src/predicate/ast.js';

function ast(source: string): PredicateAst {
  const result = parsePredicate(source);
  if (!result.ok) throw new Error(`expected ${source} to parse: ${result.error.message}`);
  return result.ast;
}

function errorOf(source: string): string {
  const result = parsePredicate(source);
  if (result.ok) throw new Error(`expected ${source} to fail`);
  return result.error.message;
}

describe('parser', () => {
  beforeEach(() => clearPredicateCache());

  it('parses a bare path as a truthiness test', () => {
    expect(ast('grade_safe')).toEqual({ t: 'truthy', expr: { t: 'path', path: ['grade_safe'] } });
  });

  it('parses a dotted path', () => {
    expect(ast('business.founded_year > 1990')).toEqual({
      t: 'cmp',
      op: '>',
      left: { t: 'path', path: ['business', 'founded_year'] },
      right: 1990,
    });
  });

  it('parses a call without a filter', () => {
    expect(ast('exists(before_photo)')).toEqual({
      t: 'truthy',
      expr: { t: 'call', fn: 'exists', path: ['before_photo'] },
    });
  });

  it('parses a call with a filter and a comparison', () => {
    expect(ast('count(media.photos[rights != "unknown" && grade_safe]) >= 6')).toEqual({
      t: 'cmp',
      op: '>=',
      left: {
        t: 'call',
        fn: 'count',
        path: ['media', 'photos'],
        filter: {
          t: 'and',
          left: { t: 'cmp', op: '!=', left: { t: 'path', path: ['rights'] }, right: 'unknown' },
          right: { t: 'truthy', expr: { t: 'path', path: ['grade_safe'] } },
        },
      },
      right: 6,
    });
  });

  it('gives && higher precedence than ||', () => {
    expect(ast('a && b || c')).toEqual({
      t: 'or',
      left: {
        t: 'and',
        left: { t: 'truthy', expr: { t: 'path', path: ['a'] } },
        right: { t: 'truthy', expr: { t: 'path', path: ['b'] } },
      },
      right: { t: 'truthy', expr: { t: 'path', path: ['c'] } },
    });
  });

  it('parses parenthesised grouping that overrides precedence', () => {
    expect(ast('a && (b || c)')).toMatchObject({ t: 'and', right: { t: 'or' } });
  });

  it('parses repeated || and && chains left-associatively', () => {
    expect(ast('a || b || c')).toMatchObject({ t: 'or', left: { t: 'or' } });
    expect(ast('a && b && c')).toMatchObject({ t: 'and', left: { t: 'and' } });
  });

  it('parses negation, including doubled negation', () => {
    expect(ast('!a')).toEqual({
      t: 'not',
      expr: { t: 'truthy', expr: { t: 'path', path: ['a'] } },
    });
    expect(ast('!!a')).toMatchObject({ t: 'not', expr: { t: 'not' } });
  });

  it('parses every literal kind on the right of a comparison', () => {
    expect(ast('a == "s"')).toMatchObject({ right: 's' });
    expect(ast('a == 2.5')).toMatchObject({ right: 2.5 });
    expect(ast('a == true')).toMatchObject({ right: true });
    expect(ast('a == false')).toMatchObject({ right: false });
    expect(ast('a == null')).toMatchObject({ right: null });
  });

  it('parses every comparison operator', () => {
    for (const op of ['>=', '>', '<=', '<', '==', '!='] as const) {
      expect(ast(`a ${op} 1`)).toMatchObject({ t: 'cmp', op });
    }
  });

  it('treats a call name without parentheses as a plain path', () => {
    expect(ast('count')).toEqual({ t: 'truthy', expr: { t: 'path', path: ['count'] } });
    expect(ast('count.total >= 1')).toMatchObject({
      left: { t: 'path', path: ['count', 'total'] },
    });
  });

  it('parses nested filters', () => {
    expect(ast('count(a[any(b[c == 1])]) >= 1')).toMatchObject({
      left: { filter: { t: 'truthy', expr: { t: 'call', fn: 'any' } } },
    });
  });

  it('parses a filter containing a parenthesised group', () => {
    expect(ast('count(a[(b || c) && d]) > 0')).toMatchObject({
      left: { filter: { t: 'and', left: { t: 'or' } } },
    });
  });

  it('rejects comparing a parenthesised expression', () => {
    expect(errorOf('(a && b) >= 2')).toMatch(/boolean and cannot be compared/);
  });

  it('rejects a missing right-hand literal', () => {
    expect(errorOf('a >=')).toMatch(/expected a literal/);
  });

  it('rejects an identifier as a right-hand literal', () => {
    expect(errorOf('a == b')).toMatch(/expected a literal/);
  });

  it('rejects an expression that does not start with a subject', () => {
    expect(errorOf('>= 3')).toMatch(/expected a path or call/);
  });

  it('rejects an unclosed call', () => {
    expect(errorOf('count(a')).toMatch(/expected '\)'/);
  });

  it('rejects an unclosed filter', () => {
    expect(errorOf('count(a[b)')).toMatch(/expected '\]'/);
  });

  it('rejects an unclosed group', () => {
    expect(errorOf('(a && b')).toMatch(/expected '\)'/);
  });

  it('rejects a trailing token after a complete expression', () => {
    expect(errorOf('a && b )')).toMatch(/unexpected "\)" after expression/);
  });

  it('rejects a dangling path separator', () => {
    expect(errorOf('a.')).toMatch(/expected a path segment/);
  });

  it('rejects a call whose argument is not a path', () => {
    expect(errorOf('count(1)')).toMatch(/expected a path inside the call/);
  });

  it('propagates a lexer error with the source attached', () => {
    const result = parsePredicate('a @ b');
    expect(result).toMatchObject({ ok: false, error: { source: 'a @ b' } });
  });

  it('reports end of input by name', () => {
    expect(errorOf('count(')).toMatch(/end of input/);
  });

  it('caches by source string and returns the identical result object', () => {
    expect(predicateCacheSize()).toBe(0);
    const first = parsePredicate('count(a) >= 1');
    const second = parsePredicate('count(a) >= 1');
    expect(second).toBe(first);
    expect(predicateCacheSize()).toBe(1);
  });

  it('caches failures too, so a bad predicate is not re-lexed on every build', () => {
    parsePredicate('a @ b');
    parsePredicate('a @ b');
    expect(predicateCacheSize()).toBe(1);
  });

  it('produces an AST that survives a JSON round trip', () => {
    const source = 'count(media.photos[rights != "unknown" && grade_safe]) >= 6 || !exists(x)';
    const parsed = ast(source);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });

  it('turns stack exhaustion from pathological nesting into a parse error', () => {
    const deep = '('.repeat(60_000) + 'a' + ')'.repeat(60_000);
    const result = parsePredicate(deep);
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'predicate nests too deeply to parse' },
    });
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (source) => {
        const result = parsePredicate(source);
        expect(typeof result.ok).toBe('boolean');
      }),
      { numRuns: 2000 },
    );
  });

  it('never throws on input drawn from the predicate alphabet', () => {
    const alphabet = fc.stringMatching(/^[a-z_.()[\]!&|<>=" 0-9]{0,40}$/);
    fc.assert(
      fc.property(alphabet, (source) => {
        expect(() => parsePredicate(source)).not.toThrow();
      }),
      { numRuns: 2000 },
    );
  });
});
