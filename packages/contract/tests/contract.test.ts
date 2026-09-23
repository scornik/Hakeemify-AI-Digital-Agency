import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { canonicalJson, NonCanonicalValueError, shortHash, stableHash } from '../src/hash.js';
import {
  ARRANGEMENT_ID,
  ASSET_ID,
  ArrangementId,
  AssetId,
  LibrarySha,
  VERSIONED_REF,
  VariantId,
  VersionedRef,
  parseVersionedRef,
  variantFamily,
} from '../src/ids.js';
import { FactRegistry, factsById, flattenFacts } from '../src/facts/registry.js';
import { SiteDefinition, SITE_DEFINITION_SCHEMA_VERSION } from '../src/site/site-definition.js';
import { SECTION_FAMILIES } from '../src/site/section.js';
import {
  MigrationError,
  assertMigrationChain,
  migrateSiteDefinition,
  type Migration,
} from '../src/site/migrations.js';
import { evaluatePredicates } from '../src/predicate/evaluate.js';
import { parsedRegistry, rawRegistry } from './fixtures/registry.js';

const goldenPath = fileURLToPath(
  new URL('./fixtures/site-definition.golden.json', import.meta.url),
);
const goldenText = readFileSync(goldenPath, 'utf8');
const golden = JSON.parse(goldenText) as unknown;

describe('id grammar', () => {
  it('accepts the id shapes v4 actually uses', () => {
    expect(AssetId.parse('editorial_v3')).toBe('editorial_v3');
    expect(AssetId.parse('service_clarity')).toBe('service_clarity');
    expect(VariantId.parse('hero/founder_editorial')).toBe('hero/founder_editorial');
    expect(ArrangementId.parse('full-bleed-overlap')).toBe('full-bleed-overlap');
    expect(VersionedRef.parse('editorial_v3@3.1')).toBe('editorial_v3@3.1');
    expect(VersionedRef.parse('roofing@4')).toBe('roofing@4');
    expect(LibrarySha.parse('a7f31c2')).toBe('a7f31c2');
  });

  it('rejects ids that would silently become "ineligible" instead of "wrong"', () => {
    expect(() => AssetId.parse('Editorial_V3')).toThrow();
    expect(() => AssetId.parse('editorial-v3')).toThrow();
    expect(() => VariantId.parse('founder_editorial')).toThrow();
    expect(() => VariantId.parse('hero/Founder')).toThrow();
    expect(() => ArrangementId.parse('portrait_left')).toThrow();
    expect(() => VersionedRef.parse('editorial_v3')).toThrow();
    expect(() => LibrarySha.parse('zzzz')).toThrow();
    expect(ASSET_ID.test('')).toBe(false);
    expect(ARRANGEMENT_ID.test('-leading')).toBe(false);
    expect(VERSIONED_REF.test('a@b')).toBe(false);
  });

  it('splits a pinned ref and a variant family', () => {
    expect(parseVersionedRef('editorial_v3@3.1')).toEqual({ id: 'editorial_v3', version: '3.1' });
    expect(parseVersionedRef('nonsense')).toBeNull();
    expect(variantFamily('proof/credential_bar')).toBe('proof');
    expect(variantFamily('nonsense')).toBeNull();
  });
});

describe('canonical hashing', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableHash({ b: 1, a: 2 })).toBe(stableHash({ a: 2, b: 1 }));
  });

  it('keeps array order, because order is meaning', () => {
    expect(stableHash([1, 2])).not.toBe(stableHash([2, 1]));
  });

  it('drops undefined properties and nulls undefined array slots, like JSON does', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
  });

  it('normalises negative zero so two equal numbers hash equally', () => {
    expect(stableHash({ n: -0 })).toBe(stableHash({ n: 0 }));
  });

  it('serialises dates as ISO strings', () => {
    expect(canonicalJson({ d: new Date('2026-09-23T00:00:00.000Z') })).toBe(
      '{"d":"2026-09-23T00:00:00.000Z"}',
    );
  });

  it('refuses values whose JSON round trip would not be faithful', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(undefined)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(10n)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(() => 1)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson(Symbol('x'))).toThrow(NonCanonicalValueError);
  });

  it('names the path of the offending value', () => {
    expect(() => canonicalJson({ a: { b: [Number.NaN] } })).toThrow(/a\.b\[0\]/);
  });

  it('produces a stable short hash for memo keys', () => {
    expect(shortHash({ a: 1 })).toHaveLength(16);
    expect(shortHash({ a: 1 })).toBe(stableHash({ a: 1 }).slice(0, 16));
  });

  it('gives the same site definition the same hash across parses — the done gate depends on it', () => {
    const a = SiteDefinition.parse(JSON.parse(goldenText));
    const b = SiteDefinition.parse(JSON.parse(goldenText));
    expect(stableHash(a)).toBe(stableHash(b));
  });
});

describe('fact registry', () => {
  it('parses the fixture', () => {
    expect(() => FactRegistry.parse(rawRegistry)).not.toThrow();
  });

  it('materialises derived fields at parse time rather than trusting input', () => {
    const registry = parsedRegistry();
    const [first, second] = registry.proof.testimonials.value;
    expect(first?.attributable).toBe(true);
    expect(second?.attributable).toBe(false);

    const projects = registry.proof.projects.value;
    expect(projects.filter((p) => p.has_before_after)).toHaveLength(2);

    const photo = registry.media.photos.value[0];
    expect(photo?.aspect).toBeCloseTo(2400 / 1600);
  });

  it('recomputes a derived field even when the input carries a forged one', () => {
    const forged = structuredClone(rawRegistry) as typeof rawRegistry;
    // Claim attributability on an unattributed, unconsented testimonial.
    Object.assign(forged.proof.testimonials.value[1] as object, { attributable: true });
    const parsed = FactRegistry.parse(forged);
    expect(parsed.proof.testimonials.value[1]?.attributable).toBe(false);
  });

  it('rejects a registry missing a required fact', () => {
    const broken = structuredClone(rawRegistry) as Record<string, unknown>;
    delete (broken['contact'] as Record<string, unknown>)['email'];
    expect(() => FactRegistry.parse(broken)).toThrow();
  });

  it('flattens to addressable facts and indexes them by id', () => {
    const registry = parsedRegistry();
    const flat = flattenFacts(registry);
    const paths = flat.map((f) => f.path);
    expect(paths).toContain('business.legal_name');
    expect(paths).toContain('proof.testimonials');
    expect(paths).toContain('contact.email');

    const byId = factsById(registry);
    expect(byId.get('f_legal_name')?.value).toBe('Ridgeline Roofing Ltd');
    expect(byId.get('f_photos')?.quotable).toBe(false);
  });

  it('carries quotability through, which is what the leash reads', () => {
    const byId = factsById(parsedRegistry());
    expect(byId.get('f_founded')?.quotable).toBe(true);
    expect(byId.get('f_niche')?.quotable).toBe(false);
  });
});

describe('predicates over the real registry', () => {
  const registry = parsedRegistry();

  it('gates the archetypes exactly as v4 §7 specifies', () => {
    const snapshot = evaluatePredicates(
      [
        'count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4',
        'count(proof.testimonials[attributable]) >= 3',
        'count(proof.credentials) >= 1',
        'exists(people[is_founder]) && len(business.story) >= 240',
      ],
      registry,
    );
    const byPredicate = Object.fromEntries(snapshot.map((row) => [row.predicate, row]));

    expect(
      byPredicate['count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4'],
    ).toMatchObject({ result: false, actual: 2 });
    expect(byPredicate['count(proof.testimonials[attributable]) >= 3']).toMatchObject({
      result: false,
      actual: 1,
    });
    expect(byPredicate['count(proof.credentials) >= 1']).toMatchObject({ result: true, actual: 2 });
  });

  it('gates `leader` on somebody else having verified the claim', () => {
    const snapshot = evaluatePredicates(
      ['count(proof.metrics[verification == "third_party"]) >= 1'],
      registry,
    );
    expect(snapshot[0]).toMatchObject({ result: false, actual: 0 });
  });

  it('excludes unknown-rights and non-grade-safe photos from the art direction gate', () => {
    const snapshot = evaluatePredicates(
      ['count(media.photos[rights != "unknown" && grade_safe]) >= 6'],
      registry,
    );
    // Seven photos, one unknown rights, one not grade safe.
    expect(snapshot[0]).toMatchObject({ result: false, actual: 5 });
  });
});

describe('site definition', () => {
  it('parses the golden fixture', () => {
    expect(() => SiteDefinition.parse(golden)).not.toThrow();
  });

  it('round-trips parse -> serialise -> parse without drift', () => {
    const first = SiteDefinition.parse(JSON.parse(goldenText));
    const serialised = JSON.stringify(first);
    const second = SiteDefinition.parse(JSON.parse(serialised));
    expect(second).toEqual(first);
    expect(canonicalJson(second)).toBe(canonicalJson(first));
  });

  it('keeps the golden file itself in sync with the schema', () => {
    const parsed = SiteDefinition.parse(golden) as { schema_version: number };
    expect(parsed.schema_version).toBe(SITE_DEFINITION_SCHEMA_VERSION);
  });

  it('discriminates sections on family, and only on the nine authored families', () => {
    const parsed = SiteDefinition.parse(golden);
    const families = Object.values(parsed.pages['home']?.sections ?? {}).map((s) => s.family);
    expect(families).toEqual(['hero', 'services', 'proof', 'faq', 'cta']);
    expect(SECTION_FAMILIES).toHaveLength(9);
  });

  it('rejects a section whose family is not in the union', () => {
    const broken = JSON.parse(goldenText);
    broken.pages.home.sections.s_hero.family = 'testimonial_carousel';
    expect(() => SiteDefinition.parse(broken)).toThrow();
  });

  it('rejects a malformed route, which would otherwise ship as a 404', () => {
    const broken = JSON.parse(goldenText);
    broken.pages.home.route = 'home';
    expect(() => SiteDefinition.parse(broken)).toThrow();
  });

  it('rejects an unpinned build', () => {
    const broken = JSON.parse(goldenText);
    delete broken.pinned.design_system;
    expect(() => SiteDefinition.parse(broken)).toThrow();
  });
});

describe('migrations', () => {
  it('has a contiguous chain that ends at the current version', () => {
    expect(() => assertMigrationChain()).not.toThrow();
  });

  it('is a no-op when the document is already current', () => {
    const result = migrateSiteDefinition(JSON.parse(goldenText));
    expect(result).toMatchObject({ from: 1, to: 1, applied: [] });
    expect(SiteDefinition.parse(result.document)).toBeDefined();
  });

  const chain: Migration[] = [
    {
      from: 1,
      to: 2,
      description: 'add locale_fallback',
      migrate: (doc) => ({ ...doc, locale_fallback: 'en' }),
    },
    {
      from: 2,
      to: 3,
      description: 'rename seed to build_seed',
      migrate: ({ seed, ...rest }) => ({ ...rest, build_seed: seed }),
    },
  ];

  it('applies a chain in order and records what it did', () => {
    const result = migrateSiteDefinition(JSON.parse(goldenText), {
      migrations: chain,
      target: 3,
    });
    expect(result.to).toBe(3);
    expect(result.applied).toEqual(['add locale_fallback', 'rename seed to build_seed']);
    expect(result.document['locale_fallback']).toBe('en');
    expect(result.document['build_seed']).toBe(20260923);
    expect(result.document['seed']).toBeUndefined();
    expect(result.document['schema_version']).toBe(3);
  });

  it('leaves the input document untouched', () => {
    const input = JSON.parse(goldenText);
    migrateSiteDefinition(input, { migrations: chain, target: 3 });
    expect(input.schema_version).toBe(1);
    expect(input.locale_fallback).toBeUndefined();
  });

  it('refuses a document from a future version rather than downgrading it', () => {
    expect(() => migrateSiteDefinition({ schema_version: 99 })).toThrow(/ahead of this build/);
  });

  it('refuses a document with no version', () => {
    expect(() => migrateSiteDefinition({})).toThrow(MigrationError);
    expect(() => migrateSiteDefinition({ schema_version: '1' })).toThrow(/integer schema_version/);
  });

  it('refuses a non-object', () => {
    expect(() => migrateSiteDefinition([])).toThrow(/must be an object/);
    expect(() => migrateSiteDefinition(null)).toThrow(/must be an object/);
  });

  it('refuses a gap in the chain rather than guessing the missing step', () => {
    expect(() =>
      migrateSiteDefinition({ schema_version: 1 }, { migrations: [], target: 2 }),
    ).toThrow(/no migration registered from schema_version 1/);
  });

  it('rejects a non-contiguous or version-skipping chain at boot', () => {
    expect(() =>
      assertMigrationChain([{ from: 2, to: 3, description: 'x', migrate: (d) => d }], 3),
    ).toThrow(/not contiguous/);
    expect(() =>
      assertMigrationChain([{ from: 1, to: 3, description: 'x', migrate: (d) => d }], 3),
    ).toThrow(/skips a version/);
    expect(() =>
      assertMigrationChain([{ from: 1, to: 2, description: 'x', migrate: (d) => d }], 5),
    ).toThrow(/ends at 2 but the current schema version is 5/);
  });
});
