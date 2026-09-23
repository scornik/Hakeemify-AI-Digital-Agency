/**
 * Claim extraction — the mechanical half of the `grounded_in` leash (v4 §8).
 *
 * "A generated string containing a number, name, date or quotation that doesn't resolve to a
 * `quotable: true` fact is a build error."
 *
 * The rule implemented here: every claim token extracted from generated copy must appear in
 * the rendered text of one of the facts that slot cited. Not "sounds supported" — appears.
 * That keeps the check deterministic and keeps a model from citing a fact and then writing a
 * number the fact does not contain.
 *
 * The extractor is deliberately conservative about *names* and aggressive about *numbers*,
 * because the failure modes are asymmetric: an invented number is a false claim about a
 * business, whereas a missed capitalised word is a copy-editing matter. Names still fail the
 * build when clearly proper (multi-word capitalised runs, or a capitalised word that is not a
 * sentence opener and not an ordinary English word).
 */

export type ClaimKind = 'number' | 'date' | 'quotation' | 'name';

export interface Claim {
  readonly kind: ClaimKind;
  /** The token as it appeared. */
  readonly text: string;
  /** Normalised for comparison against fact text. */
  readonly normalised: string;
  readonly index: number;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * Capitalised words that carry no claim: sentence openers, pronouns, and the ordinary English
 * words that begin a sentence often enough to be noise. Kept short on purpose — anything not
 * listed here is treated as a proper name and must be grounded.
 */
const COMMON_CAPITALISED = new Set([
  'a',
  'an',
  'the',
  'we',
  'our',
  'us',
  'you',
  'your',
  'i',
  'it',
  'they',
  'their',
  'this',
  'that',
  'these',
  'those',
  'and',
  'but',
  'or',
  'so',
  'if',
  'when',
  'where',
  'what',
  'why',
  'how',
  'who',
  'every',
  'each',
  'all',
  'no',
  'not',
  'from',
  'for',
  'with',
  'without',
  'after',
  'before',
  'since',
  'while',
  'because',
  'then',
  'there',
  'here',
  'get',
  'book',
  'call',
  'see',
  'ask',
  'let',
  'need',
  'want',
  'work',
  'built',
  'made',
  'done',
  'ready',
  'first',
  'last',
  'next',
  'new',
  'most',
  'more',
  'less',
  'many',
  'much',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'yes',
  'nothing',
  'something',
  'everything',
  'anyone',
  'someone',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const NUMBER_RE = /(?<![\w.])(?:[£$€]\s?)?\d[\d,]*(?:\.\d+)?\s?%?/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const MONTH_DATE_RE = new RegExp(`\\b(${MONTHS.join('|')})\\s+\\d{1,2}(?:,\\s*\\d{4})?\\b`, 'gi');
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTHS.join('|')})\\s+\\d{4}\\b`, 'gi');
const QUOTE_RE = /["“”']([^"“”']{3,})["“”']/g;
const SENTENCE_SPLIT_RE = /(?<=[.!?:;])\s+|\n+/;

/**
 * Lower-cased, with whitespace, commas, quote marks, a leading currency symbol and a trailing
 * full stop removed. Both the claim and the supporting fact text go through this, so `£1,200`
 * in copy is supported by `1200` in a fact and a quotation matches whatever quote marks the
 * copy happened to use.
 */
export function normaliseClaim(text: string): string {
  return text
    .toLowerCase()
    .replace(/["'“”‘’]/g, '')
    .replace(/[\s,]/g, '')
    .replace(/^[£$€]/, '')
    .replace(/[.]$/, '');
}

function pushMatches(
  out: Claim[],
  text: string,
  re: RegExp,
  kind: ClaimKind,
  taken: [number, number][],
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (taken.some(([s, e]) => start < e && end > s)) continue;
    taken.push([start, end]);
    const raw = match[0].trim();
    out.push({ kind, text: raw, normalised: normaliseClaim(raw), index: start });
  }
}

/** Positions at which a new sentence starts, so a capitalised opener is not read as a name. */
function sentenceStartOffsets(text: string): Set<number> {
  const offsets = new Set<number>([0]);
  let cursor = 0;
  for (const part of text.split(SENTENCE_SPLIT_RE)) {
    const at = text.indexOf(part, cursor);
    if (at >= 0) {
      offsets.add(at);
      cursor = at + part.length;
    }
  }
  return offsets;
}

/**
 * True when the text contains a lower-case-initial word after the first — the mark of a
 * sentence rather than a heading.
 */
export function readsAsProse(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  return words.slice(1).some((word) => /^[a-z]/.test(word));
}

export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const taken: [number, number][] = [];

  // Dates first: they contain numbers, and the more specific reading should win.
  pushMatches(claims, text, ISO_DATE_RE, 'date', taken);
  pushMatches(claims, text, MONTH_DATE_RE, 'date', taken);
  pushMatches(claims, text, MONTH_YEAR_RE, 'date', taken);
  pushMatches(claims, text, QUOTE_RE, 'quotation', taken);
  pushMatches(claims, text, NUMBER_RE, 'number', taken);

  // Name extraction runs on prose only. A Title Case string is a headline, and in a headline
  // every word is capitalised, so there is no signal left to separate "Dana Whitlock" from
  // "Storm Damage Repair". Treating headlines as names would block ordinary copy on every
  // build; treating them as prose-free means a fabricated name inside a Title Case headline is
  // not caught here. That residual case is closed at the DOM level by the gate's
  // `content.facts-provenance` check, which compares rendered text against the registry.
  if (!readsAsProse(text)) return claims.sort((a, b) => a.index - b.index);

  const starts = sentenceStartOffsets(text);
  const nameRe = /\b[A-Z][a-zA-Z'’-]*(?:\s+(?:of|and|de|van|von|the)?\s*[A-Z][a-zA-Z'’-]*)*/g;
  nameRe.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = nameRe.exec(text)) !== null) {
    const raw = match[0].trim();
    const start = match.index;
    const end = start + raw.length;
    if (taken.some(([s, e]) => start < e && end > s)) continue;

    const words = raw.split(/\s+/);
    const isMultiWord = words.length > 1;
    const lower = raw.toLowerCase();

    if (!isMultiWord) {
      if (starts.has(start)) continue; // sentence opener, not a claim
      if (COMMON_CAPITALISED.has(lower)) continue;
      if (raw.length < 2) continue;
    } else {
      // A multi-word run made entirely of ordinary words is a capitalised heading, not a name.
      const allCommon = words.every((w) => COMMON_CAPITALISED.has(w.toLowerCase()));
      if (allCommon) continue;
    }

    taken.push([start, end]);
    claims.push({ kind: 'name', text: raw, normalised: normaliseClaim(raw), index: start });
  }

  return claims.sort((a, b) => a.index - b.index);
}

/** Render a fact's value as the text a claim can be matched against. */
export function factText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (depth > 6) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => factText(v, depth + 1)).join(' ');
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((v) => factText(v, depth + 1))
      .join(' ');
  }
  /* c8 ignore next -- every JSON type is handled above */
  return '';
}

/**
 * True when the claim's normalised text appears in the supporting text. Matching is on the
 * normalised form so `£1,200` in copy is supported by `1200` in a fact, and a name matches
 * regardless of spacing.
 */
export function claimSupported(claim: Claim, supportingText: string): boolean {
  const haystack = normaliseClaim(supportingText);
  if (claim.normalised.length === 0) return true;
  return haystack.includes(claim.normalised);
}
