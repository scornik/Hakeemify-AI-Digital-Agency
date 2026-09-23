/**
 * Predicate lexer. Total: every input produces either a token list or a located error.
 * It never throws.
 */

export type TokenKind =
  | 'ident'
  | 'number'
  | 'string'
  | 'true'
  | 'false'
  | 'null'
  | '&&'
  | '||'
  | '!'
  | '('
  | ')'
  | '['
  | ']'
  | '.'
  | 'op'
  | 'eof';

export interface Token {
  readonly kind: TokenKind;
  /** Source text for idents, the parsed value for numbers/strings, the operator for `op`. */
  readonly value: string;
  readonly pos: number;
}

export interface LexError {
  readonly message: string;
  readonly pos: number;
}

export type LexResult = { ok: true; tokens: Token[] } | { ok: false; error: LexError };

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_]/;
const DIGIT = /[0-9]/;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  let i = 0;

  const peek = (offset = 0): string => source[i + offset] ?? '';

  while (i < source.length) {
    const ch = peek();

    if (isSpace(ch)) {
      i += 1;
      continue;
    }

    const start = i;

    // Two-character operators first, so `!=` never lexes as `!` then `=`.
    const two = source.slice(i, i + 2);
    if (two === '&&' || two === '||') {
      tokens.push({ kind: two, value: two, pos: start });
      i += 2;
      continue;
    }
    if (two === '>=' || two === '<=' || two === '==' || two === '!=') {
      tokens.push({ kind: 'op', value: two, pos: start });
      i += 2;
      continue;
    }

    if (ch === '>' || ch === '<') {
      tokens.push({ kind: 'op', value: ch, pos: start });
      i += 1;
      continue;
    }

    if (ch === '!' || ch === '(' || ch === ')' || ch === '[' || ch === ']' || ch === '.') {
      tokens.push({ kind: ch, value: ch, pos: start });
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let out = '';
      let closed = false;
      while (i < source.length) {
        const c = peek();
        if (c === '\\') {
          const next = peek(1);
          if (next === '') {
            return { ok: false, error: { message: 'unterminated escape', pos: i } };
          }
          out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
          i += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          i += 1;
          break;
        }
        out += c;
        i += 1;
      }
      if (!closed) {
        return { ok: false, error: { message: 'unterminated string literal', pos: start } };
      }
      tokens.push({ kind: 'string', value: out, pos: start });
      continue;
    }

    if (DIGIT.test(ch) || (ch === '-' && DIGIT.test(peek(1)))) {
      let raw = ch;
      i += 1;
      let seenDot = false;
      while (i < source.length) {
        const c = peek();
        if (DIGIT.test(c)) {
          raw += c;
          i += 1;
          continue;
        }
        // A dot is only part of the number when a digit follows; otherwise it is path syntax.
        if (c === '.' && !seenDot && DIGIT.test(peek(1))) {
          seenDot = true;
          raw += c;
          i += 1;
          continue;
        }
        break;
      }
      tokens.push({ kind: 'number', value: raw, pos: start });
      continue;
    }

    if (IDENT_START.test(ch)) {
      let raw = ch;
      i += 1;
      while (i < source.length && IDENT_PART.test(peek())) {
        raw += peek();
        i += 1;
      }
      if (raw === 'true' || raw === 'false' || raw === 'null') {
        tokens.push({ kind: raw, value: raw, pos: start });
      } else {
        tokens.push({ kind: 'ident', value: raw, pos: start });
      }
      continue;
    }

    return { ok: false, error: { message: `unexpected character ${JSON.stringify(ch)}`, pos: i } };
  }

  tokens.push({ kind: 'eof', value: '', pos: source.length });
  return { ok: true, tokens };
}
