import { describe, expect, it } from 'vitest';
import { evaluatePredicates } from '@ada/contract';

import {
  BANNED_EFFECTS,
  TIER1_VERSION,
  checkArtDirection,
  checkCopyBans,
  checkLayoutBans,
  runTier1,
  type SlopInput,
} from '../src/antislop/tier1.js';
import {
  DEFAULT_TIER3_CONFIG,
  detectTier3,
  ngrams,
  phraseBuildCounts,
  proposedBans,
  tier3Blocks,
  type BuildSample,
} from '../src/antislop/tier3.js';
import {
  buildManifest,
  manifestSentences,
  ruledOutFor,
  templateSentence,
  type Decision,
} from '../src/manifest.js';
import { buildGapReport, describeProvision, unlockSentence } from '../src/gap-report.js';
import {
  DEFAULT_LIMITS,
  intensityOf,
  validateAssembly,
  validateComposition,
  validateNarrative,
  validateRhythm,
  type PlacedSection,
} from '../src/assembly.js';
import { archetype, variant } from './fixtures/library.js';

// ---------------------------------------------------------------------------------------------

const slopInput = (overrides: Partial<SlopInput> = {}): SlopInput => ({
  copy: {},
  designSystem: {
    heading_font: 'Canela',
    body_font: 'Sohne',
    radius_applied_uniformly: false,
    radius_value: 2,
  },
  sections: [],
  assets: [],
  artDirection: {
    grade_id: 'warm_lift',
    allowed_aspects: [1.5, 0.8],
    forbidden_tags: ['stock_gesture'],
  },
  ...overrides,
});

const section = (overrides: Partial<SlopInput['sections'][number]> = {}) => ({
  instance_id: 's_hero',
  family: 'hero',
  background: 'image',
  hues: [] as string[],
  align: 'left',
  cta_count: 1,
  media: 'photo',
  item_count: 0,
  item_media: 'none',
  list_markers: [] as string[],
  effect_ids: [] as string[],
  css_classes: [] as string[],
  ...overrides,
});

describe('anti-slop tier 1', () => {
  it('blocks every phrase v4 bans', () => {
    const phrases = [
      'We elevate your business',
      'A seamlessly integrated service',
      "In today's fast-paced world",
      'Unlock the power of roofing',
      'Take your home to the next level',
      "We're passionate about roofs",
      'Cutting-edge techniques',
      'Quality you can trust',
      'Your one-stop roofing shop',
    ];
    for (const [index, text] of phrases.entries()) {
      const violations = checkCopyBans(slopInput({ copy: { [`s_${index}.headline`]: text } }));
      expect(violations, text).toHaveLength(1);
      expect(violations[0]?.severity).toBe('blocking');
    }
  });

  it('leaves ordinary copy alone', () => {
    expect(
      checkCopyBans(slopInput({ copy: { a: 'Replacement, storm repair and gutter renewal.' } })),
    ).toEqual([]);
  });

  it('blocks a purple-blue gradient hero', () => {
    const violations = checkLayoutBans(
      slopInput({
        sections: [section({ background: 'gradient', hues: ['purple', 'blue'], media: 'none' })],
      }),
    );
    expect(violations.map((v) => v.id)).toContain('banned_layout.gradient_saas_hero');
  });

  it('blocks three centred cards with line icons', () => {
    const violations = checkLayoutBans(
      slopInput({
        sections: [
          section({ family: 'services', item_count: 3, align: 'center', item_media: 'line_icon' }),
        ],
      }),
    );
    expect(violations.map((v) => v.id)).toContain('banned_layout.icon_card_triplet');
  });

  it('blocks a centred twin-CTA hero with no media', () => {
    const violations = checkLayoutBans(
      slopInput({ sections: [section({ align: 'center', cta_count: 2, media: 'none' })] }),
    );
    expect(violations.map((v) => v.id)).toContain('banned_layout.centered_twin_cta_hero');
  });

  it('blocks emoji bullets', () => {
    const violations = checkLayoutBans(
      slopInput({ sections: [section({ list_markers: ['🚀', '✅'] })] }),
    );
    expect(violations.map((v) => v.id)).toContain('banned_layout.emoji_bullets');
  });

  it('blocks harvested effect ids rather than a hand-written taste list', () => {
    expect(BANNED_EFFECTS).toContain('background-beams');
    expect(BANNED_EFFECTS).toContain('bento-grid');
    expect(BANNED_EFFECTS).toContain('smooth-scroll');
    const violations = checkLayoutBans(
      slopInput({ sections: [section({ effect_ids: ['aurora-background'] })] }),
    );
    expect(violations[0]?.id).toBe('banned_effect.aurora-background');
    expect(violations[0]?.source).toMatch(/harvested/);
  });

  it('blocks the literal utility classes tutorial prompts mandate', () => {
    const violations = checkLayoutBans(
      slopInput({ sections: [section({ css_classes: ['bg-gradient-to-r from-indigo-500'] })] }),
    );
    expect(violations.map((v) => v.id)).toContain('banned_class.from-indigo-500');
  });

  it('blocks a single-family typography pairing', () => {
    const pack = runTier1(
      slopInput({
        designSystem: {
          heading_font: 'Inter',
          body_font: 'Inter',
          radius_applied_uniformly: false,
          radius_value: 2,
        },
      }),
    );
    expect(pack.violations.map((v) => v.id)).toContain('banned_token.single_family_typography');
    expect(pack.canShip).toBe(false);
  });

  it('warns, rather than blocks, on one large radius applied uniformly', () => {
    const pack = runTier1(
      slopInput({
        designSystem: {
          heading_font: 'Canela',
          body_font: 'Sohne',
          radius_applied_uniformly: true,
          radius_value: 24,
        },
      }),
    );
    expect(pack.violations[0]?.severity).toBe('warning');
    expect(pack.canShip).toBe(true);
  });

  describe('art direction', () => {
    const asset = (overrides: Partial<SlopInput['assets'][number]> = {}) => ({
      asset_id: 'a1',
      grade_id: 'warm_lift',
      aspect: 1.5,
      tags: ['work'],
      ai_generated: false,
      ...overrides,
    });

    it('blocks an ungraded asset, which is the tell that separates art direction from collage', () => {
      const violations = checkArtDirection(slopInput({ assets: [asset({ grade_id: null })] }));
      expect(violations[0]?.id).toBe('art_direction.ungraded_asset');
    });

    it('blocks an aspect outside the crop grammar', () => {
      const violations = checkArtDirection(slopInput({ assets: [asset({ aspect: 2.4 })] }));
      expect(violations.map((v) => v.id)).toContain('art_direction.mixed_crop_grammar');
    });

    it('blocks a forbidden photo tag', () => {
      const violations = checkArtDirection(
        slopInput({ assets: [asset({ tags: ['stock_gesture'] })] }),
      );
      expect(violations.map((v) => v.id)).toContain('art_direction.forbidden_photo_tag');
    });

    it('blocks a generated image of a person, non-overridably', () => {
      const violations = checkArtDirection(
        slopInput({ assets: [asset({ ai_generated: true, tags: ['person'] })] }),
      );
      const synthetic = violations.find((v) => v.id === 'art_direction.synthetic_person');
      expect(synthetic?.severity).toBe('blocking');
      expect(synthetic?.source).toMatch(/non-overridable/);
    });

    it('permits a generated image that depicts no person', () => {
      expect(
        checkArtDirection(
          slopInput({ assets: [asset({ ai_generated: true, tags: ['texture'] })] }),
        ),
      ).toEqual([]);
    });
  });

  it('is a versioned rule pack where canShip is the absence of a fatal', () => {
    const clean = runTier1(slopInput());
    expect(clean).toMatchObject({ version: TIER1_VERSION, hasFatal: false, canShip: true });
  });
});

// ---------------------------------------------------------------------------------------------

describe('anti-slop tier 3', () => {
  const sample = (index: number, copy: string[]): BuildSample => ({
    build_id: `b_${index}`,
    copy,
    section_sequence_hash: `seq_${index}`,
    proper_nouns: ['Ridgeline Roofing', 'Ashfield'],
  });

  /**
   * Copy that shares no n-gram between builds. The first attempt at this fixture used
   * `A distinct opening line number ${index}`, which shares a five-word prefix across 80 builds
   * — and the detector flagged it, correctly. Genuinely unique tokens are the only way to hold
   * the rest of the corpus at zero while testing one seeded phrase.
   */
  const unique = (index: number): string =>
    ['alpha', 'bravo', 'delta', 'echo', 'gamma'].map((word) => `${word}${index}`).join(' ');

  /** A phrase seeded into exactly 20 of 100 builds: 20%, over the 15% threshold. */
  const hundredBuilds = (): BuildSample[] =>
    Array.from({ length: 100 }, (_, index) =>
      sample(
        index,
        index < 20 ? ['Built for the way you work, every single day.'] : [unique(index)],
      ),
    );

  it('flags a phrase seeded into 20 of 100 builds', () => {
    const flags = detectTier3(hundredBuilds());
    const phrase = flags.find((flag) => flag.kind === 'phrase');
    expect(phrase).toBeDefined();
    expect(phrase?.value).toContain('built for the way you work');
    expect(phrase?.builds).toBe(20);
    expect(phrase?.share).toBeCloseTo(0.2);
  });

  it('chains overlapping n-grams back into the one phrase they came from', () => {
    // A nine-word phrase surfaces as several overlapping six-grams. They are one finding, and a
    // review queue that lists them separately makes a person reassemble it by eye.
    const phrases = detectTier3(hundredBuilds()).filter((flag) => flag.kind === 'phrase');
    expect(phrases).toHaveLength(1);
    expect(phrases[0]?.value).toBe('built for the way you work every single day');
  });

  it('does not flag a phrase below the threshold', () => {
    const builds = Array.from({ length: 100 }, (_, index) =>
      sample(index, index < 10 ? ['Built for the way you work.'] : [unique(index)]),
    );
    expect(detectTier3(builds).filter((flag) => flag.kind === 'phrase')).toEqual([]);
  });

  it('excludes brand and service names, so a business name is not its own cliché', () => {
    const builds = Array.from({ length: 100 }, (_, index) =>
      sample(index, ['Ridgeline Roofing Ashfield Ridgeline Roofing Ashfield Ridgeline Roofing']),
    );
    expect(detectTier3(builds).filter((flag) => flag.kind === 'phrase')).toEqual([]);
  });

  it('flags a repeated section sequence even when the words differ', () => {
    const builds = Array.from({ length: 100 }, (_, index) => ({
      ...sample(index, [unique(index)]),
      section_sequence_hash: index < 30 ? 'seq_template' : `seq_${index}`,
    }));
    const sequence = detectTier3(builds).find((flag) => flag.kind === 'sequence');
    expect(sequence?.value).toBe('seq_template');
    expect(sequence?.share).toBeCloseTo(0.3);
  });

  it('stays quiet below the minimum number of builds, where shares are noise', () => {
    const builds = Array.from({ length: 5 }, (_, index) => sample(index, ['The same line again.']));
    expect(detectTier3(builds)).toEqual([]);
  });

  it('counts builds, not occurrences', () => {
    const counts = phraseBuildCounts([
      sample(0, ['the same phrase here', 'the same phrase here', 'the same phrase here']),
    ]);
    expect(counts.get('the same phrase here')).toBe(1);
  });

  it('blocks a new build that reuses a flagged phrase', () => {
    const flags = detectTier3(hundredBuilds());
    const candidate = sample(101, ['Built for the way you work, obviously.']);
    expect(tier3Blocks(candidate, flags)).not.toHaveLength(0);
  });

  it('lets a new build through when it reuses nothing flagged', () => {
    const flags = detectTier3(hundredBuilds());
    const candidate = sample(101, ['Slate, lead and gutters, on the same three valleys.']);
    expect(tier3Blocks(candidate, flags)).toEqual([]);
  });

  it('generates n-grams within the configured range only', () => {
    const grams = ngrams(['a', 'b', 'c', 'd'], 3, 3);
    expect(grams).toEqual(['a b c', 'b c d']);
  });

  it('writes flagged phrases to the proposed queue for a human to land', () => {
    const jsonl = proposedBans(detectTier3(hundredBuilds()), '2026-09-23');
    const first = JSON.parse(jsonl.split('\n')[0] ?? '{}');
    expect(first).toMatchObject({ status: 'proposed', detected_at: '2026-09-23' });
    expect(DEFAULT_TIER3_CONFIG.phraseShareThreshold).toBe(0.15);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the decision manifest', () => {
  const registry = {
    proof: {
      projects: {
        value: [{ title: 'one', before_photo: { path: 'a' }, after_photo: { path: 'b' } }],
        provenance: { kind: 'upload' },
      },
      testimonials: { value: [{ attributable: true }], provenance: { kind: 'upload' } },
      credentials: { value: [{ name: 'insurance' }], provenance: { kind: 'upload' } },
    },
  };

  const predicates = [
    'count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4',
    'count(proof.testimonials[attributable]) >= 3',
    'count(proof.credentials) >= 1',
  ];
  const snapshot = evaluatePredicates(predicates, registry);

  const requiresById = new Map<string, readonly string[]>([
    ['transformation', [predicates[0] as string]],
    ['proof_first', [predicates[1] as string]],
    ['service_clarity', []],
  ]);

  it('derives a ruled-out row from the snapshot, with the predicate and the actual value', () => {
    const rows = ruledOutFor(['transformation', 'proof_first'], requiresById, snapshot);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: 'transformation',
      failed: predicates[0],
      actual: 1,
    });
  });

  it('templates a sentence a business owner can act on', () => {
    const rows = ruledOutFor(['transformation'], requiresById, snapshot);
    expect(rows[0]?.sentence).toBe(
      'transformation needs 4 projects matching exists(before_photo) && exists(after_photo); you have 1.',
    );
  });

  it('quotes an unfamiliar predicate rather than paraphrasing it wrongly', () => {
    const sentence = templateSentence('x', {
      predicate: 'weird.thing != "z" || other',
      actual: undefined,
      result: false,
    });
    expect(sentence).toContain('`weird.thing != "z" || other`');
    expect(sentence).toContain('you have none');
  });

  it('never carries a model-authored field', () => {
    const decisions: Decision[] = [
      {
        stage: 'page_archetype',
        chosen: 'service_clarity',
        eligible_were: ['service_clarity'],
        ruled_out: ruledOutFor(['transformation', 'proof_first'], requiresById, snapshot),
        influenced_by: { positioning: 'local_trust' },
      },
    ];
    const manifest = buildManifest({
      build_id: 'b_1',
      seed: 20260923,
      pinned: { design_system: 'reference_v1@1.0' },
      decisions,
      snapshot,
      substitutions: [
        { stage: 'assemble', from: 'proof/a', to: 'proof/b', reason: 'rhythm_profile_breach' },
      ],
    });

    expect(manifest.derived_from).toBe('predicate_snapshot');
    expect(manifest.model_authored_fields).toEqual([]);

    // Every readable sentence traces back to a predicate in the snapshot or a recorded
    // substitution. Nothing here can have come from a model, because nothing here is free text.
    const snapshotPredicates = new Set(snapshot.map((row) => row.predicate));
    for (const row of manifest.decisions.flatMap((decision) => decision.ruled_out)) {
      expect(snapshotPredicates.has(row.failed)).toBe(true);
      expect(row.sentence).toBe(
        templateSentence(
          row.id,
          snapshot.find((s) => s.predicate === row.failed)!,
        ),
      );
    }
    for (const substitution of manifest.substitutions) {
      expect(substitution.sentence).toContain(substitution.from);
      expect(substitution.sentence).toContain(substitution.to);
      expect(substitution.sentence).toContain(substitution.reason.replace(/_/g, ' '));
    }
    expect(manifestSentences(manifest)).toHaveLength(3);
  });

  it('gives one reason per ruled-out id: the first unmet gate is the one to fix', () => {
    const many = new Map<string, readonly string[]>([
      ['x', [predicates[0] as string, predicates[1] as string]],
    ]);
    expect(ruledOutFor(['x'], many, snapshot)).toHaveLength(1);
  });

  it('records a predicate that was never evaluated rather than implying it passed', () => {
    const rows = ruledOutFor(['y'], new Map([['y', ['count(nothing) >= 1']]]), snapshot);
    expect(rows[0]).toMatchObject({ failed: 'count(nothing) >= 1', actual: null });
  });
});

describe('the gap report', () => {
  const registry = {
    proof: {
      projects: {
        value: [{ before_photo: {}, after_photo: {} }],
        provenance: { kind: 'upload' },
      },
      metrics: { value: [{ verification: 'self_reported' }], provenance: { kind: 'intake' } },
    },
  };
  const predicates = [
    'count(proof.projects[exists(before_photo) && exists(after_photo)]) >= 4',
    'count(proof.metrics[verification == "third_party"]) >= 1',
  ];
  const snapshot = evaluatePredicates(predicates, registry);

  it('turns a failed predicate into a concrete instruction', () => {
    expect(describeProvision(predicates[0] as string, 1)).toBe(
      '3 more projects with both a before and an after photo',
    );
    expect(describeProvision(predicates[1] as string, 0)).toBe(
      '1 more metrics somebody else verified',
    );
    expect(describeProvision('exists(media.logo)', null)).toBe('a logo');
    expect(describeProvision('len(business.story) >= 240', 0)).toMatch(/at least 240 characters/);
  });

  it('orders unlocks by what changes most', () => {
    const report = buildGapReport({
      build_id: 'b_1',
      snapshot,
      ruledOut: [
        { kind: 'arrangements', id: 'full-bleed-overlap', requires: [predicates[0] as string] },
        { kind: 'positions', id: 'leader', requires: [predicates[1] as string] },
        { kind: 'archetypes', id: 'transformation', requires: [predicates[0] as string] },
      ],
      currentlyUsing: { archetype: 'service_clarity' },
      missingRequired: [],
    });
    expect(report.unlocks.map((unlock) => unlock.unlocks.kind)).toEqual([
      'positions',
      'archetypes',
      'arrangements',
    ]);
    expect(report.unlocks[0]?.impact).toBe('high');
    expect(report.unlocks[2]?.impact).toBe('low');
  });

  it('groups several unlocks behind one instruction', () => {
    const report = buildGapReport({
      build_id: 'b_1',
      snapshot,
      ruledOut: [
        { kind: 'archetypes', id: 'transformation', requires: [predicates[0] as string] },
        { kind: 'archetypes', id: 'before_after', requires: [predicates[0] as string] },
      ],
      currentlyUsing: {},
      missingRequired: [],
    });
    expect(report.unlocks).toHaveLength(1);
    expect(report.unlocks[0]?.unlocks.ids).toEqual(['transformation', 'before_after']);
  });

  it('lists blocking gaps separately, because they stop the build rather than limit it', () => {
    const report = buildGapReport({
      build_id: 'b_1',
      snapshot,
      ruledOut: [],
      currentlyUsing: {},
      missingRequired: [
        { path: 'legal.privacy_contact', why: 'the privacy policy cannot be completed' },
      ],
    });
    expect(report.blocking).toEqual([
      {
        missing: 'legal.privacy_contact',
        why: 'the privacy policy cannot be completed',
        severity: 'blocking',
      },
    ]);
  });

  it('writes a client-facing line from the same recorded values', () => {
    const report = buildGapReport({
      build_id: 'b_1',
      snapshot,
      ruledOut: [{ kind: 'archetypes', id: 'transformation', requires: [predicates[0] as string] }],
      currentlyUsing: {},
      missingRequired: [],
    });
    const sentence = unlockSentence(report.unlocks[0]!);
    expect(sentence).toContain('3 more projects');
    expect(sentence).toContain('you have 1');
  });
});

// ---------------------------------------------------------------------------------------------

describe('assembly', () => {
  const place = (
    id: string,
    family: string,
    beat: string,
    role: string,
    overrides: Partial<PlacedSection> = {},
  ): PlacedSection => {
    const v = variant(`${family}/x_${id}`, family, overrides.variant?.composition ? {} : {});
    const merged = overrides.variant ?? v;
    return {
      instance_id: id,
      beat_id: beat,
      variant: merged,
      arrangement_id: 'single-column',
      rhythm_role: role,
      intensity: overrides.intensity ?? intensityOf(merged),
      is_signature: overrides.is_signature ?? false,
      ...overrides,
    };
  };

  const heroVariant = variant('hero/a', 'hero', {
    composition: { density: 'sparse', background_weight: 'image', focal_weight: 3, approx_vh: 90 },
    motion_density: 0.2,
  });

  it('computes intensity from fields the variant already carries', () => {
    expect(intensityOf(heroVariant)).toBeCloseTo(0.4 + 0.25 * 0.2 + 0.2 * 0.9 + 0.15 * 0.2);
    expect(intensityOf(variant('x/y', 'services'))).toBeGreaterThan(0);
  });

  it('flags a page with no focal moment', () => {
    const sections = [place('a', 'services', 'mechanism', 'explanation')];
    const violations = validateComposition(sections);
    expect(violations.map((v) => v.code)).toContain('no_focal_moment');
  });

  it('flags a focal section that is not first', () => {
    const sections = [
      place('a', 'services', 'mechanism', 'explanation'),
      place('b', 'hero', 'hook', 'impact', { variant: heroVariant, is_signature: true }),
    ];
    expect(validateComposition(sections).map((v) => v.code)).toContain('focal_moment_not_first');
  });

  it('flags a repeated family and a repeated novelty class', () => {
    const shared = variant('proof/a', 'proof', { novelty_class: 'same' });
    const sections = [
      place('a', 'proof', 'evidence', 'proof', { variant: shared }),
      place('b', 'proof', 'evidence', 'proof', { variant: shared }),
    ];
    const codes = validateComposition(sections).map((v) => v.code);
    expect(codes).toContain('repeat_family');
    expect(codes).toContain('repeat_novelty_class');
  });

  it('flags a page with no signature section', () => {
    const sections = [place('a', 'hero', 'hook', 'impact', { variant: heroVariant })];
    expect(validateComposition(sections).map((v) => v.code)).toContain('no_signature_section');
  });

  it('flags three or more signature sections, where nothing is dominant', () => {
    const sections = ['a', 'b', 'c'].map((id, index) =>
      place(id, ['hero', 'proof', 'cta'][index] as string, 'hook', 'impact', {
        variant: heroVariant,
        is_signature: true,
      }),
    );
    expect(validateComposition(sections).map((v) => v.code)).toContain(
      'too_many_signature_sections',
    );
  });

  it('enforces the section count bounds', () => {
    expect(validateComposition([]).map((v) => v.code)).toContain('min_sections');
    expect(DEFAULT_LIMITS.max_sections).toBe(9);
  });

  it('flags an offer that arrives with no relief before it', () => {
    const loud = variant('cta/a', 'cta', {
      composition: {
        density: 'dense',
        background_weight: 'accent',
        focal_weight: 3,
        approx_vh: 90,
      },
      motion_density: 1,
    });
    const sections = [
      place('a', 'hero', 'hook', 'impact', { variant: heroVariant }),
      place('b', 'cta', 'offer', 'offer', { variant: loud }),
    ];
    const codes = validateRhythm(sections, archetype('x')).map((v) => v.code);
    expect(codes).toContain('no_relief_before_offer');
  });

  it('flags a page that only fades out', () => {
    const sections = [
      place('a', 'hero', 'hook', 'impact', { intensity: 0.9 }),
      place('b', 'services', 'mechanism', 'explanation', { intensity: 0.6 }),
      place('c', 'faq', 'objection', 'relief', { intensity: 0.2 }),
    ];
    expect(validateRhythm(sections, archetype('x')).map((v) => v.code)).toContain(
      'monotonic_decline',
    );
  });

  it('flags two adjacent sections at near-identical intensity', () => {
    const sections = [
      place('a', 'hero', 'hook', 'impact', { intensity: 0.5 }),
      place('b', 'services', 'mechanism', 'explanation', { intensity: 0.52 }),
    ];
    expect(validateRhythm(sections, archetype('x')).map((v) => v.code)).toContain(
      'adjacent_intensity_too_close',
    );
  });

  it('shifts the rhythm targets under a spacious positioning bias', () => {
    const profile = archetype('x', {
      rhythm_profile: { roles: ['impact'], intensity_targets: [1], tolerance: 0.05 },
    });
    const sections = [place('a', 'hero', 'hook', 'impact', { intensity: 0.92 })];
    expect(validateRhythm(sections, profile, 'neutral').map((v) => v.code)).toContain(
      'rhythm_profile_breach',
    );
    expect(validateRhythm(sections, profile, 'spacious').map((v) => v.code)).not.toContain(
      'rhythm_profile_breach',
    );
  });

  it('enforces the archetype narrative rules', () => {
    const profile = archetype('x', {
      narrative_rules: ['single_offer_beat', 'objection_immediately_precedes_offer'],
    });
    const sections = [
      place('a', 'cta', 'offer', 'offer'),
      place('b', 'faq', 'objection', 'relief'),
      place('c', 'cta', 'offer', 'offer'),
    ];
    const codes = validateNarrative(sections, profile).map((v) => v.code);
    expect(codes.filter((code) => code === 'narrative_rule')).toHaveLength(2);
  });

  it('flags an unfilled required beat rather than shipping the gap', () => {
    const profile = archetype('x', {
      beats: [{ id: 'offer', families: ['cta'], required: true }],
    });
    expect(validateNarrative([], profile).map((v) => v.code)).toContain('required_beat_unfilled');
  });

  it('surfaces an unknown narrative rule as a library authoring error', () => {
    const profile = archetype('x', { narrative_rules: ['invented_rule'] });
    const violations = validateNarrative([], profile);
    expect(violations[0]?.detail).toMatch(/unknown narrative rule/);
  });

  it('runs composition, narrative and rhythm together', () => {
    const violations = validateAssembly([], archetype('x'));
    expect(violations.length).toBeGreaterThan(0);
  });
});
