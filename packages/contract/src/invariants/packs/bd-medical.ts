/**
 * Claim pack — Bangladesh, medical practice.
 *
 * **Read this before reading the rules.** This file is a machine's reading of publicly described
 * regulation. It is not legal advice, it has not been reviewed by anyone qualified, and
 * `reviewedBy` is `null`, which means `assertPackUsable()` refuses it for any build that is not a
 * fixture. That refusal is the point: the rules below are useful as a starting list for a lawyer
 * to work through, and dangerous as an authority.
 *
 * Every rule carries `needsLegalReview`. A reviewer should end up flipping each one to `false`
 * individually, or changing its disposition, rather than approving the file wholesale.
 *
 * ## What I am reasonably confident about, and why it shapes the rules
 *
 * - **BM&DC registration is a real, checkable credential.** The Bangladesh Medical and Dental
 *   Council registers practitioners under the Medical and Dental Council Act 2010, and
 *   registration numbers are routinely displayed on practice materials. That makes it the
 *   strongest grounding anchor the niche has: unlike a testimonial or an outcome figure, it is a
 *   fact a reader can verify against the register. The pack therefore treats an *absent*
 *   registration number as the problem, and the number itself as `allowed`.
 * - **Qualification display is regulated, and misuse is a known enforcement concern.** Only
 *   recognised qualifications may be advertised. The pack cannot tell a recognised degree from
 *   an invented one, so it does not try: it marks qualification strings as requiring evidence,
 *   which routes them to the existing `quotable` fact machinery instead of guessing.
 * - **False and misleading advertising carries statutory consequences** under the Consumer
 *   Rights Protection Act 2009, independently of professional rules.
 * - **Advertising medicines to the public is restricted** under the drug control legislation.
 *
 * ## What I am *not* confident about, stated plainly
 *
 * I do not know the exact wording of the BM&DC Code of Professional Conduct on patient
 * testimonials, and I have not read it. I have set testimonials to `forbidden` because that is
 * the conservative reading and the cost of being wrong in that direction is a plainer website,
 * whereas the cost of being wrong the other way lands on the client. A reviewer may well relax
 * it. `citation` is `null` wherever I could not name an instrument, rather than a plausible-
 * looking reference — an invented citation is worse than none, because it survives review.
 *
 * ## The Bangla gap
 *
 * `languages` lists `en` only. Bangladeshi practice sites are routinely bilingual, and a Bangla
 * page scanned with an English-only pack passes every rule while saying anything at all. I have
 * deliberately not guessed at Bangla marketing idiom: a half-populated pattern set would read as
 * coverage. `packCoversLanguage()` exists so the gate can report the blindness rather than
 * report a pass.
 */
import type { JurisdictionPack } from '../permissibility.js';

export const BD_MEDICAL_PACK: JurisdictionPack = {
  id: 'bd-medical',
  jurisdiction: 'Bangladesh',
  sector: 'medical practice',
  // English only, on purpose. See "The Bangla gap" above.
  languages: ['en'],
  reviewedBy: null,
  notes: [
    'Not reviewed. assertPackUsable() refuses this pack for any non-fixture build.',
    'A reviewer should flip needsLegalReview per rule, not for the file.',
    'No Bangla patterns. A bn-BD page is not covered by this pack at all.',
    'Rules are conservative where I was unsure: the cost of a false positive is plainer copy.',
  ],
  rules: [
    {
      claimClass: 'testimonial',
      disposition: 'forbidden',
      patterns: {
        en: [
          '\\b(?:patients?|clients?)\\s+(?:say|said|tell us|report)\\b',
          '\\b(?:testimonial|success stor(?:y|ies))\\b',
          '\\bwhat our (?:patients?|clients?)\\b',
          '\\b(?:changed|saved) my life\\b',
          '\\bhighly recommend(?:ed|s)?\\b',
        ],
      },
      reason:
        'Patient testimonials are restricted for registered practitioners. A testimonial can be ' +
        'entirely true and still not be permitted, so grounding does not rescue it.',
      citation: null,
      needsLegalReview: true,
    },
    {
      claimClass: 'outcome',
      disposition: 'forbidden',
      patterns: {
        en: [
          '\\b(?:100|9\\d)\\s*%\\s*(?:success|cure|effective|satisfaction)',
          '\\b(?:guaranteed|permanent|complete)\\s+(?:cure|recovery|relief)\\b',
          '\\bcures?\\s+(?:cancer|diabetes|asthma|arthritis)\\b',
          '\\bno\\s+(?:side\\s+effects?|risk)\\b',
          '\\bpain[- ]free\\s+(?:surgery|procedure|treatment)\\b',
        ],
      },
      reason:
        'An absolute outcome claim — a cure, a guaranteed recovery, or the absence of risk — is ' +
        'the regulated core of medical advertising and the phrasing a copy generator reaches ' +
        'for first.',
      citation: 'Consumer Rights Protection Act 2009 (false or misleading representation)',
      needsLegalReview: true,
    },
    {
      claimClass: 'outcome',
      disposition: 'requires_evidence',
      patterns: {
        en: [
          '\\b\\d{1,3}(?:\\.\\d+)?\\s*%\\s*(?:success|recovery|improvement|satisfaction)',
          '\\brecovery (?:time|period) of\\b',
          '\\b(?:faster|quicker|shorter)\\s+recovery\\b',
        ],
      },
      reason:
        'A specific outcome figure may be stated only when it resolves to a quotable fact. This ' +
        'routes it through the grounding leash rather than banning it outright.',
      citation: null,
      needsLegalReview: true,
    },
    {
      claimClass: 'comparative',
      disposition: 'forbidden',
      patterns: {
        en: [
          '\\b(?:best|finest|top|number one|no\\.?\\s*1|#1|leading|foremost|premier)\\b',
          '\\bmost (?:trusted|experienced|qualified)\\b',
          '\\b(?:better|superior) than\\b',
          '\\bonly (?:doctor|clinic|specialist) (?:in|who)\\b',
        ],
      },
      reason:
        'Ranking a practitioner against others is self-promotion that cannot be substantiated, ' +
        'and superlatives are the single most common marker of generated medical copy.',
      citation: null,
      needsLegalReview: true,
    },
    {
      claimClass: 'guarantee',
      disposition: 'forbidden',
      patterns: {
        en: [
          '\\b(?:money[- ]back|satisfaction)\\s+guarantee',
          '\\brisk[- ]free\\b',
          '\\bguarantee(?:d|s)?\\s+(?:result|outcome|success)',
        ],
      },
      reason:
        'A clinical outcome cannot be guaranteed, and offering one frames care as a purchase.',
      citation: null,
      needsLegalReview: true,
    },
    {
      claimClass: 'urgency',
      disposition: 'forbidden',
      patterns: {
        en: [
          '\\b(?:limited|only \\d+)\\s+(?:slots?|seats?|appointments?)\\b',
          '\\b(?:hurry|act now|book before|offer ends)\\b',
          '\\blast chance\\b',
        ],
      },
      reason:
        'Manufactured scarcity pressures a clinical decision. This is a professional-conduct ' +
        'concern before it is a marketing one.',
      citation: null,
      needsLegalReview: true,
    },
    {
      claimClass: 'qualification',
      disposition: 'requires_evidence',
      patterns: {
        en: [
          '\\b(?:MBBS|BDS|FCPS|MRCP|FRCS|MRCS|MD|MS|DGO|DCH|FACS|FRCP)\\b',
          '\\b(?:fellow|member)(?:ship)? of the\\b',
          '\\b(?:trained|qualified) (?:in|at)\\b',
        ],
      },
      reason:
        'Only recognised qualifications may be advertised, and this pack cannot tell a ' +
        'recognised degree from an invented one. Requiring a quotable fact puts a human on the ' +
        'hook for the claim instead of a regex.',
      citation: 'Bangladesh Medical and Dental Council Act 2010 (qualification display)',
      needsLegalReview: true,
    },
    {
      claimClass: 'qualification',
      disposition: 'allowed',
      patterns: { en: ['\\bBM&?DC\\s*(?:Reg(?:\\.|istration)?\\s*(?:No\\.?)?)?\\s*[A-Z]?-?\\d+'] },
      reason:
        'A BM&DC registration number is the strongest credential the niche has: a reader can ' +
        'check it against the register. Recorded as explicitly permitted so its absence, rather ' +
        'than its presence, is what a reviewer notices.',
      citation: 'Bangladesh Medical and Dental Council Act 2010',
      needsLegalReview: true,
    },
    {
      claimClass: 'price',
      disposition: 'requires_disclaimer',
      patterns: {
        en: ['\\b(?:৳|BDT|Tk\\.?)\\s*\\d', '\\b(?:discount|offer|package)\\s+(?:price|rate)\\b'],
      },
      reason:
        'A consultation fee is legitimate information, but a stated fee that turns out to be ' +
        'conditional is a misleading representation under consumer law.',
      citation: 'Consumer Rights Protection Act 2009',
      needsLegalReview: true,
      disclaimer: 'Fees shown are for an initial consultation and exclude investigations.',
    },
  ],
};
