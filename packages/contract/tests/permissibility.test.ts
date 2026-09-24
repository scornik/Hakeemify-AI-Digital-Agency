import { describe, expect, it } from 'vitest';

import {
  CLAIM_CLASSES,
  DISPOSITIONS,
  UnreviewedPackError,
  assertPackUsable,
  detectImpermissibleClaims,
  packCoversLanguage,
  type JurisdictionPack,
} from '../src/invariants/permissibility.js';
import { BD_MEDICAL_PACK } from '../src/invariants/packs/bd-medical.js';

const pack = BD_MEDICAL_PACK;

/** Match ids for one string, so a test reads as the rule it is about. */
function classesFor(text: string, language = 'en'): string[] {
  return [...new Set(detectImpermissibleClaims(text, pack, language).map((f) => f.claimClass))];
}

describe('the review gate', () => {
  it('refuses an unreviewed pack for a client build', () => {
    // The property the whole module is built around. This pack encodes a machine's reading of
    // regulation it is not qualified to interpret; it must not silently become the authority.
    expect(pack.reviewedBy).toBeNull();
    expect(() => assertPackUsable(pack)).toThrow(UnreviewedPackError);
  });

  it('says what to do about it, not just that it failed', () => {
    let message = '';
    try {
      assertPackUsable(pack);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toMatch(/not legal advice/);
    expect(message).toMatch(/lawyer qualified in Bangladesh/);
    expect(message).toMatch(/reviewedBy/);
  });

  it('permits it for a fixture, which is the only thing exercising it today', () => {
    expect(() => assertPackUsable(pack, { fixture: true })).not.toThrow();
  });

  it('permits a pack a named human has signed', () => {
    const reviewed: JurisdictionPack = {
      ...pack,
      reviewedBy: { name: 'A Reviewer', date: '2026-09-24', role: 'advocate, Bangladesh' },
    };
    expect(() => assertPackUsable(reviewed)).not.toThrow();
  });

  it('leaves every rule individually unreviewed, so approval is per rule', () => {
    // A reviewer flipping one boolean for the file would be approving a wall of regex.
    expect(pack.rules.every((rule) => rule.needsLegalReview)).toBe(true);
  });
});

describe('detection', () => {
  it('catches an absolute outcome claim', () => {
    expect(classesFor('A complete cure for arthritis, with no side effects.')).toContain('outcome');
  });

  it('catches superlatives, the commonest marker of generated medical copy', () => {
    expect(classesFor('The best cardiologist in Dhaka')).toContain('comparative');
    expect(classesFor('A leading specialist')).toContain('comparative');
  });

  it('catches testimonials even when they would be perfectly grounded', () => {
    // The point of the second gate: grounding does not rescue an impermissible claim.
    expect(classesFor('What our patients say')).toContain('testimonial');
    expect(classesFor('Patients say the care changed my life')).toContain('testimonial');
  });

  it('catches manufactured urgency', () => {
    expect(classesFor('Only 5 slots left — book before Friday')).toContain('urgency');
  });

  it('catches a guarantee of outcome', () => {
    expect(classesFor('Guaranteed results or your money back')).toContain('guarantee');
  });

  it('routes a specific outcome figure to evidence rather than banning it', () => {
    const findings = detectImpermissibleClaims('An 82% success rate in our series.', pack);
    const outcome = findings.find((f) => f.claimClass === 'outcome');
    expect(outcome?.disposition).toBe('requires_evidence');
  });

  it('still forbids the absolute version of the same figure', () => {
    const findings = detectImpermissibleClaims('A 99% cure rate.', pack);
    expect(findings.some((f) => f.disposition === 'forbidden')).toBe(true);
  });

  it('routes qualifications to evidence, because it cannot tell recognised from invented', () => {
    const findings = detectImpermissibleClaims('MBBS, FCPS (Cardiology)', pack);
    expect(findings.find((f) => f.claimClass === 'qualification')?.disposition).toBe(
      'requires_evidence',
    );
  });

  it('does not flag a BM&DC registration number, the one verifiable credential', () => {
    const findings = detectImpermissibleClaims('BM&DC Reg. No. A-12345', pack);
    expect(findings.some((f) => f.claimClass === 'qualification')).toBe(false);
  });

  it('asks for a disclaimer on a fee rather than forbidding it', () => {
    const findings = detectImpermissibleClaims('Consultation BDT 1500', pack);
    const price = findings.find((f) => f.claimClass === 'price');
    expect(price?.disposition).toBe('requires_disclaimer');
    expect(price?.disclaimer).toBeTruthy();
  });

  it('leaves ordinary, factual copy alone', () => {
    const text =
      'Dr Rahman consults at the Dhanmondi chamber on Sunday and Tuesday evenings. ' +
      'Appointments are booked by phone.';
    expect(detectImpermissibleClaims(text, pack)).toEqual([]);
  });

  it('reports findings in source order, so a reviewer reads them as the copy reads', () => {
    const findings = detectImpermissibleClaims('Hurry — the best care, guaranteed results.', pack);
    const indices = findings.map((f) => f.index);
    expect([...indices].sort((a, b) => a - b)).toEqual(indices);
  });

  it('carries no invented citations', () => {
    // A plausible-looking reference survives review in a way a null does not.
    for (const rule of pack.rules) {
      if (rule.citation === null) continue;
      expect(rule.citation, rule.reason).toMatch(/\b(?:Act|Ordinance|Code)\b/);
    }
  });
});

describe('language coverage', () => {
  it('reports that Bangla is not covered, rather than passing a Bangla page', () => {
    // A bilingual practice site scanned with an English-only pack passes every rule while
    // saying anything at all. Being blind and being clean must not look the same.
    expect(packCoversLanguage(pack, 'en')).toBe(true);
    expect(packCoversLanguage(pack, 'bn')).toBe(false);
  });

  it('finds nothing in a language it has no patterns for', () => {
    expect(detectImpermissibleClaims('The best doctor', pack, 'bn')).toEqual([]);
  });
});

describe('the pack shape', () => {
  it('uses only declared claim classes and dispositions', () => {
    for (const rule of pack.rules) {
      expect(CLAIM_CLASSES).toContain(rule.claimClass);
      expect(DISPOSITIONS).toContain(rule.disposition);
    }
  });

  it('has a valid regex in every pattern', () => {
    for (const rule of pack.rules) {
      for (const [language, patterns] of Object.entries(rule.patterns)) {
        for (const source of patterns) {
          expect(() => new RegExp(source, 'giu'), `${rule.claimClass}/${language}`).not.toThrow();
        }
      }
    }
  });

  it('gives every requires_disclaimer rule the disclaimer it requires', () => {
    for (const rule of pack.rules) {
      if (rule.disposition !== 'requires_disclaimer') continue;
      expect(rule.disclaimer, rule.reason).toBeTruthy();
    }
  });
});
