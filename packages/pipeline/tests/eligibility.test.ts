import { describe, expect, it } from 'vitest';
import { evaluatePredicates } from '@ada/contract';

import {
  compatFilter,
  computeEligibleSets,
  eligibleArchetypes,
  eligibleVariants,
  rankCandidates,
  retreatOrder,
  type CompatContext,
} from '../src/eligibility.js';
import { allPredicates } from '../src/library-view.js';
import {
  artDirection,
  designSystem,
  fixtureLibrary,
  positioning,
  variant,
} from './fixtures/library.js';

/**
 * The fixture registry: credentials but no before/after pairs, and one attributable testimonial.
 *
 * Written as real `Fact` wrappers — `{ value, provenance }` — because that is what the evaluator
 * unwraps. A fixture that omits `provenance` is not a fact, and the evaluator is right to treat
 * it as an opaque object rather than guessing.
 */
const fact = <T>(value: T) => ({
  id: 'f_x',
  value,
  provenance: { kind: 'intake', field: 'x' },
  quotable: true,
  verification: 'self_reported',
});

const registry = {
  people: fact([{ name: 'Dana Whitlock', is_founder: true }]),
  proof: {
    credentials: fact([{ name: 'Public liability insurance' }]),
    testimonials: fact([
      { quote: 'a', attributable: true },
      { quote: 'b', attributable: false },
    ]),
    projects: fact([{ title: 'one', before_photo: { path: 'a' }, after_photo: { path: 'b' } }]),
    metrics: fact([{ label: 'jobs', verification: 'self_reported' }]),
  },
  media: {
    photos: fact([
      { rights: 'owned', grade_safe: true },
      { rights: 'owned', grade_safe: true },
    ]),
  },
};

const library = fixtureLibrary();
const snapshot = evaluatePredicates(allPredicates(library), registry);

const context: CompatContext = {
  direction: {
    design_system_id: 'reference_v1',
    art_direction_id: 'quiet_authority',
    page_archetype: 'service_clarity',
  },
  designSystem: designSystem('reference_v1'),
  positioning: positioning('local_trust'),
  artDirection: artDirection('quiet_authority'),
};

describe('eligibility', () => {
  it('admits a variant whose requires the registry satisfies', () => {
    const ids = eligibleVariants(library, snapshot).map((v) => v.id);
    expect(ids).toContain('proof/credential_bar');
    expect(ids).toContain('hero/founder_editorial');
  });

  it('excludes a variant whose requires the registry does not satisfy', () => {
    const ids = eligibleVariants(library, snapshot).map((v) => v.id);
    expect(ids).not.toContain('proof/testimonial_wall');
  });

  it('excludes archetypes whose gates fail, and keeps the mandatory fallback', () => {
    const ids = eligibleArchetypes(library, snapshot).map((a) => a.id);
    expect(ids).toEqual(['service_clarity']);
  });

  it('excludes scaffold sections from a real build and admits them to a fixture build', () => {
    const withScaffold = fixtureLibrary({
      variants: [...library.variants, variant('hero/scaffold', 'hero', { status: 'scaffold' })],
    });
    expect(eligibleVariants(withScaffold, snapshot).map((v) => v.id)).not.toContain(
      'hero/scaffold',
    );
    expect(
      eligibleVariants(withScaffold, snapshot, { allowScaffold: true }).map((v) => v.id),
    ).toContain('hero/scaffold');
  });

  it('gates `leader` on somebody else having verified the claim', () => {
    const sets = computeEligibleSets(library, snapshot);
    expect(sets.positions).toEqual(['local_trust', 'premium']);
    expect(sets.positions).not.toContain('leader');
  });

  it('computes every eligible set in one pass', () => {
    const sets = computeEligibleSets(library, snapshot);
    expect(sets.design_systems).toEqual(['reference_v1']);
    expect(sets.art_directions).toEqual(['quiet_authority']);
    expect(Object.keys(sets.arrangements)).toContain('hero/service_statement');
  });
});

describe('the compat ladder', () => {
  it('documents its retreat order, and that order has no step for requires', () => {
    expect(retreatOrder()).toEqual([
      'design_compat',
      'art_direction',
      'positioning',
      'sibling_archetype',
    ]);
    expect(retreatOrder()).not.toContain('requires');
  });

  it('does not retreat when something already fits', () => {
    const eligible = eligibleVariants(library, snapshot);
    const result = compatFilter(eligible, ['hero'], 'hook', 'impact', context);
    expect(result.retreatedTo).toBe('none');
    expect(result.candidates.map((v) => v.id)).toContain('hero/service_statement');
  });

  it('relaxes design_compat first', () => {
    const eligible = [
      variant('hero/other_system', 'hero', {
        serves_beats: ['hook'],
        design_compat: { systems: ['some_other_system'] },
      }),
    ];
    const result = compatFilter(eligible, ['hero'], 'hook', null, context);
    expect(result.retreatedTo).toBe('design_compat');
    expect(result.candidates).toHaveLength(1);
  });

  it('relaxes the art direction preference second', () => {
    const eligible = [
      variant('hero/other_ad', 'hero', {
        serves_beats: ['hook'],
        design_compat: { systems: ['reference_v1'], art_directions: ['documentary_real'] },
      }),
    ];
    const result = compatFilter(eligible, ['hero'], 'hook', null, context);
    expect(result.retreatedTo).toBe('art_direction');
  });

  it('relaxes the positioning preference third', () => {
    const eligible = [
      variant('hero/premium_only', 'hero', {
        serves_beats: ['hook'],
        positioning_compat: ['luxury'],
      }),
    ];
    const result = compatFilter(eligible, ['hero'], 'hook', null, context);
    expect(result.retreatedTo).toBe('positioning');
  });

  it('exhausts rather than admitting an ineligible variant', () => {
    // The ladder only ever filters the set it is handed. A variant whose `requires` failed is
    // not in that set, so no amount of retreating can reach it — this is the invariant that
    // carries the grounding guarantee.
    const eligible = eligibleVariants(library, snapshot);
    expect(eligible.map((v) => v.id)).not.toContain('proof/testimonial_wall');

    const result = compatFilter(eligible, ['proof'], 'evidence', 'proof', {
      ...context,
      direction: { ...context.direction, design_system_id: 'nonexistent' },
      designSystem: designSystem('nonexistent', { motion_pattern_allowlist: [] }),
    });
    // It retreats all the way and finds the eligible proof section, never the ineligible one.
    expect(result.candidates.map((v) => v.id)).toEqual(['proof/credential_bar']);
    expect(result.candidates.map((v) => v.id)).not.toContain('proof/testimonial_wall');
  });

  it('reports exhaustion when the beat has nothing eligible at all', () => {
    const result = compatFilter([], ['team'], 'people', null, context);
    expect(result.exhausted).toBe(true);
    expect(result.candidates).toEqual([]);
  });

  it('filters by rhythm role when the beat declares one', () => {
    const eligible = eligibleVariants(library, snapshot);
    const asProof = compatFilter(eligible, ['hero'], 'hook', 'proof', context);
    expect(asProof.candidates).toHaveLength(0);
  });
});

describe('rank tiebreak', () => {
  it('prefers a variant whose enhanced_by predicates hold', () => {
    const plain = variant('proof/plain', 'proof');
    const enhanced = variant('proof/enhanced', 'proof', {
      enhanced_by: [{ predicate: 'count(proof.credentials) >= 1', weight: 4 }],
    });
    const ranked = rankCandidates([plain, enhanced], {
      snapshot,
      playbookBoosts: {},
      usedNoveltyClasses: new Set(),
    });
    expect(ranked[0]?.id).toBe('proof/enhanced');
  });

  it('applies playbook boosts', () => {
    const a = variant('proof/a', 'proof');
    const b = variant('proof/b', 'proof');
    const ranked = rankCandidates([a, b], {
      snapshot,
      playbookBoosts: { 'proof/b': 3 },
      usedNoveltyClasses: new Set(),
    });
    expect(ranked[0]?.id).toBe('proof/b');
  });

  it('penalises a novelty class the page already used', () => {
    const a = variant('proof/a', 'proof', { novelty_class: 'repeated' });
    const b = variant('proof/b', 'proof', { novelty_class: 'fresh' });
    const ranked = rankCandidates([a, b], {
      snapshot,
      playbookBoosts: {},
      usedNoveltyClasses: new Set(['repeated']),
    });
    expect(ranked[0]?.id).toBe('proof/b');
  });

  it('breaks ties on id so the same inputs always rank the same way', () => {
    const a = variant('proof/b', 'proof');
    const b = variant('proof/a', 'proof');
    const ranked = rankCandidates([a, b], {
      snapshot,
      playbookBoosts: {},
      usedNoveltyClasses: new Set(),
    });
    expect(ranked.map((v) => v.id)).toEqual(['proof/a', 'proof/b']);
  });
});
