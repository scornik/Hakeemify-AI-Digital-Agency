import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  claimSupported,
  extractClaims,
  factText,
  normaliseClaim,
  readsAsProse,
} from '../src/invariants/claims.js';
import { groupViolations, runInvariants, type InvariantContext } from '../src/invariants/runner.js';
import { factsById } from '../src/facts/registry.js';
import { evaluatePredicates } from '../src/predicate/evaluate.js';
import { parsedRegistry } from './fixtures/registry.js';

const goldenText = readFileSync(
  fileURLToPath(new URL('./fixtures/site-definition.golden.json', import.meta.url)),
  'utf8',
);
const clone = () => JSON.parse(goldenText);

const registry = parsedRegistry();

const baseContext = (): InvariantContext => ({
  facts: factsById(registry),
  snapshot: evaluatePredicates(
    ['count(proof.credentials) >= 1', 'count(proof.testimonials[attributable]) >= 3'],
    registry,
  ),
  variantRequires: new Map([
    ['proof/credential_bar', ['count(proof.credentials) >= 1']],
    ['proof/testimonial_wall', ['count(proof.testimonials[attributable]) >= 3']],
  ]),
  tenantId: 'ada_demo',
});

describe('claim extraction', () => {
  it('finds numbers, including money and percentages', () => {
    const claims = extractClaims(
      'We have fitted 412 roofs, cut callbacks 18% and quote from £1,200.',
    );
    const numbers = claims.filter((c) => c.kind === 'number').map((c) => c.text);
    expect(numbers).toEqual(expect.arrayContaining(['412', '18%', '£1,200']));
  });

  it('finds dates in the forms copy actually uses', () => {
    const claims = extractClaims('Completed 2026-04-18, inspected April 2026, signed off May 3.');
    const dates = claims.filter((c) => c.kind === 'date').map((c) => c.text);
    expect(dates).toEqual(expect.arrayContaining(['2026-04-18', 'April 2026', 'May 3']));
  });

  it('finds quotations', () => {
    const claims = extractClaims('One customer said "they fixed it in a day" last spring.');
    expect(claims.find((c) => c.kind === 'quotation')?.text).toBe('"they fixed it in a day"');
  });

  it('finds proper names but not sentence openers or ordinary words', () => {
    const claims = extractClaims('Dana Whitlock founded the firm. We work across Ashfield.');
    const names = claims.filter((c) => c.kind === 'name').map((c) => c.text);
    expect(names).toContain('Dana Whitlock');
    expect(names).toContain('Ashfield');
    expect(names).not.toContain('We');
  });

  it('does not read a capitalised heading as a name', () => {
    const names = extractClaims('Why Choose Us').filter((c) => c.kind === 'name');
    expect(names).toHaveLength(0);
  });

  it('tells prose from a heading, which is what gates name extraction', () => {
    expect(readsAsProse('Dana Whitlock founded the firm')).toBe(true);
    expect(readsAsProse('Why Choose Us')).toBe(false);
    expect(readsAsProse('Ashfield')).toBe(false);
  });

  it('extracts numbers and dates from a heading even though names are skipped there', () => {
    // The prose gate narrows name extraction only. A fabricated figure in a Title Case
    // headline is still a build error.
    const claims = extractClaims('Roofing Since 1066');
    expect(claims.map((c) => c.kind)).toEqual(['number']);
    expect(claims[0]?.text).toBe('1066');
  });

  it('normalises for comparison so formatting differences do not matter', () => {
    expect(normaliseClaim('£1,200')).toBe('1200');
    expect(normaliseClaim('Dana Whitlock')).toBe('danawhitlock');
    expect(normaliseClaim('18 %')).toBe('18%');
  });

  it('renders nested fact values to matchable text', () => {
    expect(factText({ a: ['x', 2], b: { c: true } })).toContain('x');
    expect(factText({ a: ['x', 2], b: { c: true } })).toContain('2');
    expect(factText(null)).toBe('');
    expect(factText(undefined)).toBe('');
  });

  it('stops recursing into pathologically deep fact values', () => {
    let deep: unknown = 'bottom';
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    expect(factText(deep)).not.toContain('bottom');
  });

  it('treats an empty claim as supported rather than failing on nothing', () => {
    expect(claimSupported({ kind: 'name', text: '', normalised: '', index: 0 }, '')).toBe(true);
  });
});

describe('invariant runner', () => {
  it('passes the golden fixture', () => {
    expect(runInvariants(clone(), baseContext())).toEqual([]);
  });

  it('accumulates all violations rather than stopping at the first', () => {
    // Exactly two distinct violations, planted in two different sections.
    const broken = clone();
    broken.assets.crew_on_ridge.rights = 'unknown';
    broken.pages.home.sections.s_hero.slots.headline = {
      kind: 'generated',
      text: 'Roofing for the three valleys since 1066',
      grounded_in: ['f_founded'],
    };

    const violations = runInvariants(broken, baseContext());
    const codes = violations.map((v) => v.code).sort();

    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(codes).toContain('asset_rights_unknown');
    expect(codes).toContain('ungrounded_claim');
    expect(Object.keys(groupViolations(violations)).sort()).toEqual([
      'asset_rights_unknown',
      'ungrounded_claim',
    ]);
  });

  it('names the path of each violation so a fix has an address', () => {
    const broken = clone();
    broken.assets.crew_on_ridge.rights = 'unknown';
    const [violation] = runInvariants(broken, baseContext());
    expect(violation?.path).toBe('assets.crew_on_ridge.rights');
    expect(violation?.actual).toBe('unknown');
  });

  describe('grounding', () => {
    const withCopy = (text: string, grounded_in: string[]) => {
      const doc = clone();
      doc.pages.home.sections.s_hero.slots.headline = { kind: 'generated', text, grounded_in };
      return doc;
    };

    it('accepts a number that appears in a cited quotable fact', () => {
      const doc = withCopy('Roofing these valleys since 1998', ['f_founded']);
      expect(runInvariants(doc, baseContext())).toEqual([]);
    });

    it('rejects a number that no cited fact contains', () => {
      const doc = withCopy('Over 900 roofs replaced', ['f_founded']);
      const violations = runInvariants(doc, baseContext());
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ code: 'ungrounded_claim', actual: '900' });
    });

    it('rejects a name that no cited fact contains', () => {
      const doc = withCopy('Founded by Marcus Trevelyan', ['f_founded']);
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({
        code: 'ungrounded_claim',
        actual: 'Marcus Trevelyan',
      });
    });

    it('accepts a name that the cited fact does contain', () => {
      const doc = withCopy('Founded by Dana Whitlock', ['f_people']);
      expect(runInvariants(doc, baseContext())).toEqual([]);
    });

    it('rejects a quotation that is not in the cited testimonial', () => {
      const doc = withCopy('One customer called us "the best in the county"', ['f_testimonials']);
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({ code: 'ungrounded_claim' });
    });

    it('accepts a quotation that is', () => {
      const doc = withCopy('"Tidy crew, fair price, no surprises on the invoice."', [
        'f_testimonials',
      ]);
      expect(runInvariants(doc, baseContext())).toEqual([]);
    });

    it('rejects citing a fact that is quotable: false, however true it is', () => {
      const doc = withCopy('Roofing since 1998', ['f_photos']);
      const codes = runInvariants(doc, baseContext()).map((v) => v.code);
      expect(codes).toContain('unquotable_fact_cited');
      // And with no usable support left, the number is ungrounded too.
      expect(codes).toContain('ungrounded_claim');
    });

    it('rejects citing a fact that is not in the registry at all', () => {
      const doc = withCopy('Plain copy with no claims', ['f_does_not_exist']);
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({ code: 'missing_fact' });
    });

    it('allows claim-free copy with no citations', () => {
      const doc = withCopy('The roof over your head, looked after properly.', []);
      expect(runInvariants(doc, baseContext())).toEqual([]);
    });
  });

  describe('assets', () => {
    it('rejects unknown rights', () => {
      const doc = clone();
      doc.assets.crew_on_ridge.rights = 'unknown';
      expect(runInvariants(doc, baseContext())[0]?.code).toBe('asset_rights_unknown');
    });

    it('rejects a portrait without recorded consent', () => {
      const doc = clone();
      doc.assets.crew_on_ridge.tags = ['portrait'];
      doc.assets.crew_on_ridge.subject_consent = false;
      expect(runInvariants(doc, baseContext()).map((v) => v.code)).toContain(
        'portrait_without_consent',
      );
    });

    it('rejects a generated image of a person, which is never overridable', () => {
      const doc = clone();
      doc.assets.crew_on_ridge.tags = ['person'];
      doc.assets.crew_on_ridge.ai_generated = true;
      expect(runInvariants(doc, baseContext()).map((v) => v.code)).toContain('ai_generated_person');
    });

    it('allows a generated image that depicts no person', () => {
      const doc = clone();
      doc.assets.crew_on_ridge.ai_generated = true;
      doc.assets.crew_on_ridge.tags = ['texture'];
      expect(runInvariants(doc, baseContext())).toEqual([]);
    });

    it('rejects a slot citing an asset that does not exist', () => {
      const doc = clone();
      doc.pages.home.sections.s_hero.slots.media = { kind: 'asset', asset_id: 'ghost' };
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({ code: 'missing_asset' });
    });

    it('rejects a slot citing a fact that does not exist', () => {
      const doc = clone();
      doc.pages.home.sections.s_services.slots.services = { kind: 'fact', fact_id: 'ghost' };
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({ code: 'missing_fact' });
    });
  });

  describe('requires', () => {
    it('rejects a variant whose requires the snapshot does not satisfy', () => {
      const doc = clone();
      doc.pages.home.sections.s_proof.variant_id = 'proof/testimonial_wall';
      const violations = runInvariants(doc, baseContext());
      expect(violations[0]).toMatchObject({
        code: 'requires_not_satisfied',
        path: 'pages.home.sections.s_proof.variant_id',
      });
      expect(String(violations[0]?.message)).toContain(
        'count(proof.testimonials[attributable]) >= 3',
      );
    });

    it('ignores variants with no declared requires', () => {
      const doc = clone();
      doc.pages.home.sections.s_proof.variant_id = 'proof/unknown_variant';
      expect(runInvariants(doc, baseContext())).toEqual([]);
    });
  });

  describe('structure', () => {
    it('rejects an order entry with no section', () => {
      const doc = clone();
      doc.pages.home.order.push('s_ghost');
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({
        code: 'order_section_mismatch',
        actual: 's_ghost',
      });
    });

    it('rejects a section that is never ordered and would not render', () => {
      const doc = clone();
      doc.pages.home.order = doc.pages.home.order.filter((id: string) => id !== 's_faq');
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({
        code: 'order_section_mismatch',
        path: 'pages.home.sections.s_faq',
      });
    });

    it('rejects a duplicated order entry', () => {
      const doc = clone();
      doc.pages.home.order.push('s_cta');
      expect(runInvariants(doc, baseContext()).some((v) => /more than once/.test(v.message))).toBe(
        true,
      );
    });

    it('rejects an empty page', () => {
      const doc = clone();
      doc.pages.home.order = [];
      doc.pages.home.sections = {};
      expect(runInvariants(doc, baseContext())[0]?.code).toBe('empty_page');
    });

    it('rejects a cross-tenant site', () => {
      const doc = clone();
      doc.site.tenant_id = 'someone_else';
      expect(runInvariants(doc, baseContext())[0]).toMatchObject({
        code: 'cross_tenant_reference',
        path: 'site.tenant_id',
      });
    });

    it('requires exactly one pinned art direction', () => {
      const missing = clone();
      delete missing.pinned.art_direction;
      expect(runInvariants(missing, baseContext())[0]?.code).toBe('multiple_art_directions');

      const many = clone();
      many.pinned.art_direction = ['quiet_authority@2', 'documentary_real@1'];
      expect(runInvariants(many, baseContext())[0]?.code).toBe('multiple_art_directions');
    });

    it('does not throw on a document of the wrong shape', () => {
      expect(runInvariants(null, baseContext())[0]?.code).toBe('order_section_mismatch');
      expect(runInvariants('nope', baseContext())).toHaveLength(1);
      expect(() => runInvariants({ pages: 'no', assets: 5 }, baseContext())).not.toThrow();
      expect(() => runInvariants({ pages: { a: 1 } }, baseContext())).not.toThrow();
      expect(() =>
        runInvariants({ pages: { a: { order: 'x', sections: { s: 1 } } } }, baseContext()),
      ).not.toThrow();
    });

    it('skips slots that are not objects', () => {
      const doc = clone();
      doc.pages.home.sections.s_hero.slots.headline = 'just a string';
      expect(() => runInvariants(doc, baseContext())).not.toThrow();
    });

    it('skips assets that are not objects', () => {
      const doc = clone();
      doc.assets.bogus = 'nope';
      expect(runInvariants(doc, baseContext())).toEqual([]);
    });
  });
});
