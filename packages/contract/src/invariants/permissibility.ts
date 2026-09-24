/**
 * Claim permissibility — the constraint the roofing niche never needed.
 *
 * `claims.ts` answers **is this claim grounded?**: does every number, date, name and quotation
 * in generated copy appear in a fact the slot cited. That is necessary and, in a regulated
 * sector, nowhere near sufficient. A medical practice can state a perfectly true, fully grounded
 * success rate and still be in breach, because the rule is not about truth — it is about what a
 * practitioner is permitted to say to the public at all.
 *
 * So permissibility is a **second, independent gate**, keyed by jurisdiction and sector. A claim
 * must pass both. Nothing here relaxes grounding; a forbidden claim is forbidden whether or not
 * a fact supports it.
 *
 * ## The safety property this module is built around
 *
 * A pack is **unreviewed until a named human says otherwise**. `reviewed_by: null` means no
 * lawyer has signed it off, and `assertPackUsable()` refuses it for any build that is not a
 * fixture. This matters more than the rule list: the rules below are my best reading of
 * publicly described regulation, written by a machine that is not qualified to give legal
 * advice and cannot be the authority on what a Bangladeshi doctor may advertise. The mechanism
 * is sound; the contents need a local practitioner-lawyer to confirm, and the code is built so
 * that shipping without that confirmation is an error rather than an oversight.
 *
 * Every rule therefore carries `citation` and `needs_legal_review` so a reviewer can work
 * through the list and mark each one, rather than being asked to approve a wall of regex.
 */

export const CLAIM_CLASSES = [
  /** A stated or implied result of treatment: recovery time, success rate, cure. */
  'outcome',
  /** Ranking against others, named or not: "best", "leading", "number one". */
  'comparative',
  /** A patient's words about their care. */
  'testimonial',
  /** A promise of result or refund: "guaranteed", "risk-free". */
  'guarantee',
  /** Degrees, fellowships, memberships, registration. */
  'qualification',
  /** Fees, discounts, offers. */
  'price',
  /** Manufactured scarcity or time pressure. */
  'urgency',
] as const;
export type ClaimClass = (typeof CLAIM_CLASSES)[number];

export const DISPOSITIONS = [
  /** May not appear. A build containing one fails. */
  'forbidden',
  /** May appear only when grounded in a `quotable` fact — grounding alone is not enough. */
  'requires_evidence',
  /** May appear with a specific accompanying statement. */
  'requires_disclaimer',
  'allowed',
] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export interface ClaimRule {
  readonly claimClass: ClaimClass;
  readonly disposition: Disposition;
  /**
   * Case-insensitive regex sources, by language tag. `en` is populated; see `bn` below —
   * an empty pattern set for a language the site is written in is itself a finding.
   */
  readonly patterns: Readonly<Record<string, readonly string[]>>;
  /** Why, in a sentence a client can read. */
  readonly reason: string;
  /** The instrument this comes from, or null when it is a general principle. */
  readonly citation: string | null;
  /** True until a qualified human has confirmed this specific rule. */
  readonly needsLegalReview: boolean;
  /** Required alongside the claim when the disposition is `requires_disclaimer`. */
  readonly disclaimer?: string;
}

export interface JurisdictionPack {
  readonly id: string;
  readonly jurisdiction: string;
  readonly sector: string;
  /** Languages the pack has patterns for. Copy in any other language is not covered. */
  readonly languages: readonly string[];
  readonly rules: readonly ClaimRule[];
  /**
   * The named human who reviewed this pack, and when. `null` means nobody has, and the pack
   * may not be used for a client build.
   */
  readonly reviewedBy: {
    readonly name: string;
    readonly date: string;
    readonly role: string;
  } | null;
  readonly notes: readonly string[];
}

export class UnreviewedPackError extends Error {
  constructor(pack: JurisdictionPack) {
    super(
      `the ${pack.id} claim pack has not been reviewed by a qualified human (reviewedBy is null), ` +
        'so it may not be used for a client build. It encodes a machine’s reading of publicly ' +
        'described regulation and is not legal advice. Have a lawyer qualified in ' +
        `${pack.jurisdiction} work through the rules, set reviewedBy, and try again.`,
    );
    this.name = 'UnreviewedPackError';
  }
}

/**
 * Fail closed. Called before a non-fixture build may use a pack — an unreviewed pack is an
 * error, never a warning, because a warning about medical advertising law is a warning
 * somebody will ship past.
 */
export function assertPackUsable(
  pack: JurisdictionPack,
  options: { fixture?: boolean } = {},
): void {
  if (options.fixture === true) return;
  if (pack.reviewedBy === null) throw new UnreviewedPackError(pack);
}

export interface PermissibilityFinding {
  readonly claimClass: ClaimClass;
  readonly disposition: Disposition;
  readonly match: string;
  readonly index: number;
  readonly language: string;
  readonly reason: string;
  readonly citation: string | null;
  readonly needsLegalReview: boolean;
  readonly disclaimer?: string;
}

/**
 * Scan one string against a pack. Returns every rule that matched, in source order.
 *
 * `allowed` rules never produce a finding — they exist so a reviewer can record that a class was
 * considered and permitted, rather than leaving its absence ambiguous.
 */
export function detectImpermissibleClaims(
  text: string,
  pack: JurisdictionPack,
  language = 'en',
): PermissibilityFinding[] {
  const findings: PermissibilityFinding[] = [];

  for (const rule of pack.rules) {
    if (rule.disposition === 'allowed') continue;
    for (const source of rule.patterns[language] ?? []) {
      const pattern = new RegExp(source, 'giu');
      for (const match of text.matchAll(pattern)) {
        findings.push({
          claimClass: rule.claimClass,
          disposition: rule.disposition,
          match: match[0],
          index: match.index,
          language,
          reason: rule.reason,
          citation: rule.citation,
          needsLegalReview: rule.needsLegalReview,
          ...(rule.disclaimer === undefined ? {} : { disclaimer: rule.disclaimer }),
        });
      }
    }
  }

  return findings.sort((a, b) => a.index - b.index);
}

/**
 * A pack that has no patterns for the language the copy is written in is not "clean" — it is
 * blind. Bangladeshi practice sites are routinely bilingual, and a Bangla page scanned with an
 * English-only pack passes every rule while saying anything at all.
 */
export function packCoversLanguage(pack: JurisdictionPack, language: string): boolean {
  return pack.languages.includes(language);
}
