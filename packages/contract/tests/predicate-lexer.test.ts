import { describe, expect, it } from 'vitest';
import { lex, type Token } from '../src/predicate/lexer.js';

function kinds(source: string): string[] {
  const result = lex(source);
  if (!result.ok) throw new Error(`expected a successful lex of ${source}`);
  return result.tokens.map((t: Token) => t.kind);
}

function tokens(source: string): Token[] {
  const result = lex(source);
  if (!result.ok) throw new Error(`expected a successful lex of ${source}`);
  return result.tokens;
}

describe('lexer', () => {
  it('skips every whitespace form', () => {
    expect(kinds(' \t\n\ra')).toEqual(['ident', 'eof']);
  });

  it('lexes the boolean connectives', () => {
    expect(kinds('a && b || c')).toEqual(['ident', '&&', 'ident', '||', 'ident', 'eof']);
  });

  it('lexes two-character operators before single-character ones', () => {
    expect(tokens('a >= 1 && b <= 2 && c == 3 && d != 4').filter((t) => t.kind === 'op')).toEqual([
      { kind: 'op', value: '>=', pos: 2 },
      { kind: 'op', value: '<=', pos: 12 },
      { kind: 'op', value: '==', pos: 22 },
      { kind: 'op', value: '!=', pos: 32 },
    ]);
  });

  it('lexes single-character comparison operators', () => {
    expect(
      tokens('a > 1 && b < 2')
        .filter((t) => t.kind === 'op')
        .map((t) => t.value),
    ).toEqual(['>', '<']);
  });

  it('lexes punctuation', () => {
    expect(kinds('!(a.b[c])')).toEqual([
      '!',
      '(',
      'ident',
      '.',
      'ident',
      '[',
      'ident',
      ']',
      ')',
      'eof',
    ]);
  });

  it('lexes double- and single-quoted strings', () => {
    expect(tokens('"owned"')[0]).toMatchObject({ kind: 'string', value: 'owned' });
    expect(tokens("'owned'")[0]).toMatchObject({ kind: 'string', value: 'owned' });
  });

  it('handles escapes inside strings', () => {
    expect(tokens('"a\\nb\\tc\\"d\\\\e"')[0]?.value).toBe('a\nb\tc"d\\e');
  });

  it('rejects an unterminated escape', () => {
    const result = lex('"abc\\');
    expect(result).toMatchObject({ ok: false, error: { message: 'unterminated escape' } });
  });

  it('rejects an unterminated string', () => {
    const result = lex('"abc');
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'unterminated string literal', pos: 0 },
    });
  });

  it('lexes integers, decimals and negatives', () => {
    expect(tokens('1')[0]).toMatchObject({ kind: 'number', value: '1' });
    expect(tokens('1.25')[0]).toMatchObject({ kind: 'number', value: '1.25' });
    expect(tokens('-3')[0]).toMatchObject({ kind: 'number', value: '-3' });
  });

  it('stops a number at a dot that is not followed by a digit', () => {
    expect(kinds('1.a')).toEqual(['number', '.', 'ident', 'eof']);
  });

  it('stops a number at a second dot', () => {
    expect(tokens('1.2.3').map((t) => t.value)).toEqual(['1.2', '.', '3', '']);
  });

  it('stops a number at a non-digit, non-dot character', () => {
    expect(kinds('12 a')).toEqual(['number', 'ident', 'eof']);
  });

  it('lexes keywords distinctly from identifiers', () => {
    expect(kinds('true false null truthy')).toEqual(['true', 'false', 'null', 'ident', 'eof']);
  });

  it('lexes identifiers with digits and underscores', () => {
    expect(tokens('grade_safe2')[0]).toMatchObject({ kind: 'ident', value: 'grade_safe2' });
  });

  it('rejects an unexpected character', () => {
    expect(lex('a @ b')).toMatchObject({
      ok: false,
      error: { message: 'unexpected character "@"', pos: 2 },
    });
  });

  it('treats a lone minus as an unexpected character', () => {
    expect(lex('-a')).toMatchObject({ ok: false, error: { pos: 0 } });
  });
});
