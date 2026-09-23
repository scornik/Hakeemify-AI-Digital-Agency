import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  evaluatePredicate,
  evaluatePredicates,
  requiresSatisfied,
  resolvePath,
  snapshotSatisfies,
  truthy,
} from '../src/predicate/evaluate.js';

const fact = <T>(value: T) => ({
  id: 'f_x',
  value,
  provenance: { kind: 'intake', field: 'x' },
  quotable: true,
  verification: 'self_reported',
});

const registry = {
  business: fact({ founded_year: fact(1998), legal_name: fact('Ridgeline Roofing'), tags: [] }),
  media: fact({
    photos: fact([
      { rights: 'owned', grade_safe: true, aspect: 1.5, width: 2000 },
      { rights: 'licensed', grade_safe: true, aspect: 0.8, width: 1600 },
      { rights: 'unknown', grade_safe: true, aspect: 1.5, width: 1200 },
      { grade_safe: false, aspect: 1.5, width: 900 },
    ]),
  }),
  proof: fact({
    testimonials: fact([
      { quote: 'a', author_name: 'Dana', consented: true, attributable: true },
      { quote: 'b', consented: false, attributable: false },
    ]),
    projects: fact([
      { title: 'p1', before_photo: { path: 'a' }, after_photo: { path: 'b' } },
      { title: 'p2', before_photo: null },
    ]),
    metrics: fact([
      { label: 'jobs', value: 412, verification: 'third_party' },
      { label: 'years', value: 27, verification: 'self_reported' },
    ]),
    scores: fact([1, 2, '3', 'x', true, null]),
  }),
  contact: fact({ email: fact('hi@example.com') }),
  empty_list: fact([]),
};

const run = (predicate: string) => evaluatePredicate(predicate, registry);

describe('resolvePath', () => {
  it('unwraps Fact wrappers transparently', () => {
    expect(resolvePath(registry, ['business', 'founded_year'])).toBe(1998);
  });

  it('returns undefined for a missing segment', () => {
    expect(resolvePath(registry, ['business', 'nope'])).toBeUndefined();
  });

  it('returns undefined when walking into an array', () => {
    expect(resolvePath(registry, ['media', 'photos', 'rights'])).toBeUndefined();
  });

  it('returns undefined when walking into a scalar', () => {
    expect(resolvePath(registry, ['contact', 'email', 'length'])).toBeUndefined();
  });

  it('returns undefined when walking past a null', () => {
    expect(resolvePath({ a: null }, ['a', 'b'])).toBeUndefined();
  });

  it('stops unwrapping pathologically nested facts rather than looping', () => {
    let nested: unknown = 'core';
    for (let i = 0; i < 20; i += 1) nested = { value: nested, provenance: { kind: 'derived' } };
    const resolved = resolvePath({ deep: nested }, ['deep']);
    expect(resolved).not.toBe('core');
    expect(resolved).toMatchObject({ provenance: { kind: 'derived' } });
  });
});

describe('truthy', () => {
  it.each([
    [undefined, false],
    [null, false],
    [false, false],
    [true, true],
    [0, false],
    [1, true],
    [Number.NaN, false],
    ['', false],
    ['x', true],
    [[], false],
    [[1], true],
    [{}, true],
  ])('treats %s as %s', (value, expected) => {
    expect(truthy(value)).toBe(expected);
  });
});

describe('comparisons', () => {
  it('evaluates every ordering operator', () => {
    expect(run('business.founded_year >= 1998').result).toBe(true);
    expect(run('business.founded_year > 1998').result).toBe(false);
    expect(run('business.founded_year <= 1998').result).toBe(true);
    expect(run('business.founded_year < 1998').result).toBe(false);
  });

  it('evaluates equality against each literal kind', () => {
    expect(run('business.legal_name == "Ridgeline Roofing"').result).toBe(true);
    expect(run('business.founded_year == 1998').result).toBe(true);
    expect(run('business.founded_year != 1998').result).toBe(false);
    expect(evaluatePredicate('a == true', { a: true }).result).toBe(true);
    expect(evaluatePredicate('a == false', { a: true }).result).toBe(false);
    expect(evaluatePredicate('a == null', { a: null }).result).toBe(true);
    expect(evaluatePredicate('a == null', { a: 1 }).result).toBe(false);
  });

  it('compares a numeric string to a number literal', () => {
    expect(evaluatePredicate('a >= 5', { a: '7' }).result).toBe(true);
    expect(evaluatePredicate('a == 7', { a: '7' }).result).toBe(true);
  });

  it('is false when a side cannot be coerced to a finite number', () => {
    expect(evaluatePredicate('a >= 1', { a: 'abc' }).result).toBe(false);
    expect(evaluatePredicate('a >= 1', { a: {} }).result).toBe(false);
    expect(evaluatePredicate('a >= 1', { a: '' }).result).toBe(false);
    expect(evaluatePredicate('a >= 1', { a: null }).result).toBe(false);
  });

  it('coerces booleans and arrays to numbers for ordering', () => {
    expect(evaluatePredicate('a >= 1', { a: true }).result).toBe(true);
    expect(evaluatePredicate('a < 1', { a: false }).result).toBe(true);
    expect(evaluatePredicate('a >= 2', { a: [1, 2, 3] }).result).toBe(true);
  });

  it('is false for a string literal compared to a non-string value', () => {
    expect(evaluatePredicate('a == "x"', { a: 3 }).result).toBe(false);
  });

  it('makes a missing path fail every operator, including !=', () => {
    for (const op of ['>=', '>', '<=', '<', '==', '!='] as const) {
      expect(evaluatePredicate(`missing ${op} 1`, registry).result).toBe(false);
    }
    expect(evaluatePredicate('missing != "unknown"', registry).result).toBe(false);
  });

  it('applies that rule inside filters, so an absent field cannot pass a gate', () => {
    // The fourth photo has no `rights` key at all. It must not count as "not unknown".
    expect(run('count(media.photos[rights != "unknown"]) == 2').result).toBe(true);
  });
});

describe('connectives', () => {
  it('evaluates and / or / not', () => {
    expect(run('business.founded_year == 1998 && grade_safe').result).toBe(false);
    expect(run('business.founded_year == 1998 || grade_safe').result).toBe(true);
    expect(run('!grade_safe').result).toBe(true);
  });

  it('evaluates the right side of || when the left is false', () => {
    expect(run('exists(nope) || exists(contact.email)').result).toBe(true);
    expect(run('exists(nope) || exists(also_nope)').result).toBe(false);
  });

  it('short-circuits without evaluating the other side into an error', () => {
    expect(evaluatePredicate('a && b.c.d', { a: false }).result).toBe(false);
    expect(evaluatePredicate('a || b.c.d', { a: true }).result).toBe(true);
  });
});

describe('calls', () => {
  it('exists() reports presence, not truthiness', () => {
    expect(run('exists(empty_list)').result).toBe(true);
    expect(run('exists(nope)').result).toBe(false);
    expect(evaluatePredicate('exists(a)', { a: null }).result).toBe(false);
  });

  it('exists() with a filter asks whether any item matches', () => {
    expect(run('exists(media.photos[rights == "owned"])').result).toBe(true);
    expect(run('exists(media.photos[rights == "nope"])').result).toBe(false);
  });

  it('count() counts with and without a filter', () => {
    expect(run('count(media.photos) == 4').result).toBe(true);
    expect(run('count(media.photos[grade_safe]) == 3').result).toBe(true);
    expect(run('count(missing) == 0').result).toBe(true);
  });

  it('count() treats a present scalar as a single item', () => {
    expect(run('count(contact.email) == 1').result).toBe(true);
  });

  it('len() measures strings and lists, and is 0 when absent', () => {
    expect(run('len(business.legal_name) == 17').result).toBe(true);
    expect(run('len(media.photos) == 4').result).toBe(true);
    expect(run('len(missing) == 0').result).toBe(true);
    expect(run('len(media.photos[grade_safe]) == 3').result).toBe(true);
  });

  it('sum() adds numeric items and ignores the rest', () => {
    expect(run('sum(proof.scores) == 7').result).toBe(true);
    expect(evaluatePredicate('sum(a) == 0', { a: [] }).result).toBe(true);
  });

  it('sum() honours a filter', () => {
    expect(evaluatePredicate('sum(a[b]) == 0', { a: [{ b: false }] }).result).toBe(true);
  });

  it('all() is true only for a non-empty list whose items all pass', () => {
    expect(run('all(media.photos[grade_safe])').result).toBe(false);
    expect(run('all(proof.projects[exists(title)])').result).toBe(true);
    expect(evaluatePredicate('all(a[b])', { a: [] }).result).toBe(true);
    expect(evaluatePredicate('all(a)', { a: [1, 2] }).result).toBe(true);
    expect(evaluatePredicate('all(a)', { a: [1, 0] }).result).toBe(false);
    expect(evaluatePredicate('all(a)', { a: [] }).result).toBe(false);
  });

  it('any() is false on an empty list', () => {
    expect(evaluatePredicate('any(a[b])', { a: [] }).result).toBe(false);
    expect(evaluatePredicate('any(a)', { a: [0, 1] }).result).toBe(true);
    expect(evaluatePredicate('any(a)', { a: [0, false] }).result).toBe(false);
    expect(run('any(proof.metrics[verification == "third_party"])').result).toBe(true);
  });

  it('evaluates the v4 archetype and positioning gates as published', () => {
    expect(
      run('count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4').result,
    ).toBe(false);
    expect(run('count(proof.metrics[verification == "third_party"]) >= 1').result).toBe(true);
    expect(run('count(proof.testimonials[attributable]) >= 3').result).toBe(false);
    expect(run('count(media.photos[rights != "unknown" && grade_safe]) >= 6').result).toBe(false);
  });

  it('resolves nested filters against the item, not the root', () => {
    const data = { outer: [{ inner: [{ n: 1 }] }, { inner: [{ n: 9 }] }] };
    expect(evaluatePredicate('count(outer[any(inner[n == 9])]) == 1', data).result).toBe(true);
  });

  it('does not let a filter reach the registry root', () => {
    const data = { flag: true, items: [{ other: 1 }] };
    expect(evaluatePredicate('count(items[flag]) == 0', data).result).toBe(true);
  });
});

describe('snapshot', () => {
  it('reports the measured subject as `actual` for a comparison', () => {
    expect(run('count(media.photos) >= 6')).toMatchObject({ actual: 4, result: false });
  });

  it('reports the subject value as `actual` for a truthiness test', () => {
    expect(run('business.founded_year')).toMatchObject({ actual: 1998, result: true });
  });

  it('reports the boolean as `actual` for a compound expression', () => {
    expect(run('exists(contact.email) && exists(media.photos)')).toMatchObject({
      actual: true,
      result: true,
    });
  });

  it('fails closed with an error on an unparseable predicate', () => {
    const row = run('count(');
    expect(row.result).toBe(false);
    expect(row.error).toMatch(/end of input/);
    expect(row.actual).toBeUndefined();
  });

  it('de-duplicates by source string and preserves order', () => {
    const snapshot = evaluatePredicates(
      ['exists(contact.email)', 'count(media.photos) >= 6', 'exists(contact.email)'],
      registry,
    );
    expect(snapshot.map((row) => row.predicate)).toEqual([
      'exists(contact.email)',
      'count(media.photos) >= 6',
    ]);
  });

  it('treats a predicate absent from the snapshot as unsatisfied', () => {
    const snapshot = evaluatePredicates(['exists(contact.email)'], registry);
    expect(snapshotSatisfies(snapshot, 'exists(contact.email)')).toBe(true);
    expect(snapshotSatisfies(snapshot, 'exists(nothing)')).toBe(false);
  });

  it('treats an empty `requires` as satisfied — the service_clarity fallback', () => {
    expect(requiresSatisfied([], [])).toBe(true);
  });

  it('requires every listed predicate', () => {
    const snapshot = evaluatePredicates(
      ['exists(contact.email)', 'count(media.photos) >= 6'],
      registry,
    );
    expect(requiresSatisfied(snapshot, ['exists(contact.email)'])).toBe(true);
    expect(requiresSatisfied(snapshot, ['exists(contact.email)', 'count(media.photos) >= 6'])).toBe(
      false,
    );
  });

  it('is deterministic: the same registry always yields the same snapshot', () => {
    const predicates = [
      'count(media.photos[rights != "unknown" && grade_safe]) >= 6',
      'count(proof.testimonials[attributable]) >= 3',
    ];
    expect(evaluatePredicates(predicates, registry)).toEqual(
      evaluatePredicates(predicates, registry),
    );
  });
});

describe('totality', () => {
  const arbJson = fc.letrec((tie) => ({
    node: fc.oneof(
      { depthSize: 'small' },
      fc.constant(null),
      fc.boolean(),
      fc.integer(),
      fc.double({ noNaN: false }),
      fc.string(),
      fc.array(tie('node'), { maxLength: 4 }),
      fc.dictionary(fc.string({ minLength: 1, maxLength: 6 }), tie('node'), { maxKeys: 4 }),
    ),
  })).node;

  const PREDICATES = [
    'exists(media.photos)',
    'count(media.photos[rights != "unknown" && grade_safe]) >= 6',
    'count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4',
    'count(proof.testimonials[attributable]) >= 3',
    'sum(proof.scores) > 0',
    'len(business.story) >= 240',
    'all(media.photos[grade_safe])',
    'any(proof.metrics[verification == "third_party"])',
    '!exists(business.nothing) || business.founded_year < 2000',
    'count(',
  ];

  it('never throws over 500 generated registries', () => {
    fc.assert(
      fc.property(arbJson, (generated) => {
        for (const predicate of PREDICATES) {
          const row = evaluatePredicate(predicate, generated);
          expect(typeof row.result).toBe('boolean');
        }
      }),
      { numRuns: 500 },
    );
  });

  it('never throws when the registry itself is a scalar or missing', () => {
    for (const value of [undefined, null, 0, '', 'x', true, [], [1, 2]]) {
      for (const predicate of PREDICATES) {
        expect(() => evaluatePredicate(predicate, value)).not.toThrow();
      }
    }
  });
});
