import { describe, expect, it } from 'vitest';

import { buildFixtureSite, fixtureLibraryView } from '../src/e2e/run-fixture.js';
import { isScaffoldOnly, validateComposition, type PlacedSection } from '../src/assembly.js';
import { variant } from './fixtures/library.js';

const built = await buildFixtureSite('b_test');

describe('the end-to-end fixture build', () => {
  it('runs every stage and produces a site definition', () => {
    expect(built.state.status).toBe('FINISHED');
    expect(built.sections).toHaveLength(5);
    expect(built.sections.map((section) => section.beat_id)).toEqual([
      'hook',
      'mechanism',
      'evidence',
      'objection',
      'offer',
    ]);
  });

  it('selects only sections the library actually contains', () => {
    const known = new Set(fixtureLibraryView().variants.map((v) => v.id));
    for (const section of built.sections) {
      expect(known.has(section.variant.id)).toBe(true);
    }
  });

  it('pins the build so a retired asset can never restyle it later', () => {
    const pinned = (built.siteDefinition as { pinned: Record<string, string> }).pinned;
    expect(pinned['design_system']).toBe('reference_v1@1.0');
    expect(pinned['art_direction']).toBe('quiet_authority@2');
    expect(pinned['playbook']).toBe('roofing@4');
    expect(pinned['library']).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it('is reproducible: the same seed produces an identical SiteDefinition hash', async () => {
    // The whole point of recording the seed and excluding the model id from the memo key. A
    // pipeline that cannot reproduce a build cannot explain one either.
    const again = await buildFixtureSite('b_test_again');
    expect(again.siteDefinitionHash).toBe(built.siteDefinitionHash);
  });

  it('spends a bounded number of model calls', () => {
    expect(built.state.model_calls).toHaveLength(3);
    expect(built.state.cost_usd).toBeLessThan(built.state.budgets.max_cost_usd);
    for (const call of built.state.model_calls) {
      expect(call.finish_reason).toBe('stop');
      expect(call.guardrail_codes).toEqual([]);
    }
  });
});

describe('the decision manifest it emits', () => {
  it('rules out an archetype with the predicate that failed and the value found', () => {
    const archetypeDecision = built.manifest.decisions.find((d) => d.stage === 'page_archetype');
    expect(archetypeDecision?.chosen).toBe('service_clarity');

    const transformation = archetypeDecision?.ruled_out.find((r) => r.id === 'transformation');
    expect(transformation).toMatchObject({
      failed: 'count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4',
      actual: 2,
    });
    expect(transformation?.sentence).toBe(
      'transformation needs 4 projects matching exists(before_photo) && exists(after_photo); you have 2.',
    );
  });

  it('rules out the gated positioning, because somebody else has to verify that claim', () => {
    const positioning = built.manifest.decisions.find((d) => d.stage === 'positioning');
    expect(positioning?.ruled_out.find((r) => r.id === 'leader')).toMatchObject({
      failed: 'count(proof.metrics[verification == "third_party"]) >= 1',
      actual: 0,
    });
  });

  it('is derived from the snapshot and carries no model-authored field', () => {
    expect(built.manifest.derived_from).toBe('predicate_snapshot');
    expect(built.manifest.model_authored_fields).toEqual([]);

    // Every failed predicate in the manifest is one that was actually evaluated this build.
    const evaluated = new Set(built.snapshot.map((row) => row.predicate));
    for (const row of built.manifest.decisions.flatMap((d) => d.ruled_out)) {
      expect(evaluated.has(row.failed)).toBe(true);
    }
  });
});

describe('the gap report it emits', () => {
  it('turns every ruled-out gate into something the owner can go and do', () => {
    expect(built.gapReport.unlocks.length).toBeGreaterThan(0);
    for (const unlock of built.gapReport.unlocks) {
      expect(unlock.provide).not.toBe('');
      expect(unlock.unlocks.ids.length).toBeGreaterThan(0);
    }
  });

  it('orders positioning before archetype before art direction', () => {
    const kinds = built.gapReport.unlocks.map((unlock) => unlock.unlocks.kind);
    expect(kinds[0]).toBe('positions');
    expect(kinds).toContain('archetypes');
    expect(kinds.indexOf('archetypes')).toBeLessThan(kinds.indexOf('art_directions'));
  });

  it('asks for exactly the shortfall, not for a vague improvement', () => {
    const transformation = built.gapReport.unlocks.find((u) =>
      u.unlocks.ids.includes('transformation'),
    );
    expect(transformation?.provide).toBe('2 more projects with both a before and an after photo');
  });

  it('has nothing blocking, because the fixture supplies the legally required facts', () => {
    expect(built.gapReport.blocking).toEqual([]);
  });
});

describe('the signature-section rule', () => {
  const scaffoldSection = (id: string): PlacedSection => {
    const v = variant(`hero/${id}`, 'hero', {
      status: 'scaffold',
      composition: {
        density: 'sparse',
        background_weight: 'image',
        focal_weight: 3,
        approx_vh: 80,
      },
    });
    return {
      instance_id: id,
      beat_id: 'hook',
      variant: v,
      arrangement_id: 'stacked',
      rhythm_role: 'impact',
      intensity: 1,
      is_signature: false,
    };
  };

  it('recognises a page made entirely of scaffolds', () => {
    expect(isScaffoldOnly([scaffoldSection('a')])).toBe(true);
    expect(isScaffoldOnly([])).toBe(false);
  });

  it('warns rather than blocks when no arrangement that could satisfy it exists yet', () => {
    // Only a human may write a `signature_move`, so until the library is authored a page cannot
    // satisfy this rule however it is composed. Warning here is a statement about the library,
    // not a relaxation of the rule.
    const violations = validateComposition([scaffoldSection('a')]);
    const signature = violations.find((v) => v.code === 'no_signature_section');
    expect(signature?.severity).toBe('warning');
    expect(signature?.detail).toMatch(/only a human may write a signature move/);
  });

  it('blocks again the moment one authored section is on the page', () => {
    const authored: PlacedSection = {
      ...scaffoldSection('b'),
      instance_id: 'b',
      variant: variant('services/authored', 'services', { status: 'active' }),
    };
    const violations = validateComposition([scaffoldSection('a'), authored]);
    expect(violations.find((v) => v.code === 'no_signature_section')?.severity).toBe('blocking');
  });

  it('is reported on the fixture build as a warning, not swallowed', () => {
    // The e2e is green, and the reason it is green is recorded rather than hidden.
    expect(built.sections.every((section) => section.variant.status === 'scaffold')).toBe(true);
    expect(built.sections.some((section) => section.is_signature)).toBe(false);
  });
});
