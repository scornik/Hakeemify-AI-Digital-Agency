import { describe, expect, it } from 'vitest';
import {
  EmptyEligibleSetError,
  buildArrangementSchema,
  buildBeatSelectionSchema,
  buildCopySchema,
  buildCreativeDirectionSchema,
  buildSelectionSchema,
  enumsOf,
} from '../src/schema/selection-schema.js';
import { stableHash } from '../src/hash.js';

describe('per-build selection schema', () => {
  it('emits enums that are exactly the eligible id set — nothing more, nothing less', () => {
    const eligible = ['authority', 'service_clarity'];
    const schema = buildSelectionSchema([{ name: 'page_archetype', eligible }]);

    expect(enumsOf(schema)['page_archetype']).toEqual(['authority', 'service_clarity']);

    // The property is the assertion: an ineligible id is not merely discouraged, it is absent
    // from the grammar the model is decoding against.
    const all = [
      'transformation',
      'authority',
      'founder_story',
      'comparison',
      'proof_first',
      'service_clarity',
    ];
    const ineligible = all.filter((id) => !eligible.includes(id));
    for (const id of ineligible) {
      expect(enumsOf(schema)['page_archetype']).not.toContain(id);
    }
  });

  it('is strict: no additional properties, every field required', () => {
    const schema = buildSelectionSchema([{ name: 'a', eligible: ['x'] }]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['a']);
    expect(schema.type).toBe('object');
  });

  it('normalises order and de-duplicates so the schema hashes stably', () => {
    const one = buildSelectionSchema([{ name: 'a', eligible: ['b', 'a', 'b'] }]);
    const two = buildSelectionSchema([{ name: 'a', eligible: ['a', 'b'] }]);
    expect(one).toEqual(two);
    expect(stableHash(one)).toBe(stableHash(two));
    expect(enumsOf(one)['a']).toEqual(['a', 'b']);
  });

  it('refuses to build a call with an empty eligible set', () => {
    // `enum: []` is accepted by some providers and then satisfied with an arbitrary string,
    // which would be a model naming a section that does not exist.
    expect(() => buildSelectionSchema([{ name: 'page_archetype', eligible: [] }])).toThrow(
      EmptyEligibleSetError,
    );
    expect(() => buildSelectionSchema([{ name: 'x', eligible: [] }])).toThrow(
      /must never be issued with an empty set/,
    );
  });

  it('carries an optional description without disturbing the enum', () => {
    const withDesc = buildSelectionSchema([{ name: 'a', eligible: ['x'], description: 'pick' }]);
    expect(withDesc.properties['a']).toEqual({ type: 'string', enum: ['x'], description: 'pick' });
  });

  it('builds the creative-direction call from three eligible sets', () => {
    const schema = buildCreativeDirectionSchema({
      design_system_ids: ['reference_v1'],
      art_direction_ids: ['quiet_authority', 'typographic_editorial'],
      page_archetypes: ['service_clarity'],
    });
    expect(Object.keys(schema.properties).sort()).toEqual([
      'art_direction_id',
      'design_system_id',
      'page_archetype',
    ]);
    expect(enumsOf(schema)['art_direction_id']).toEqual([
      'quiet_authority',
      'typographic_editorial',
    ]);
    expect(schema.required).toHaveLength(3);
  });

  it('builds one enum per beat, each scoped to that beat', () => {
    const schema = buildBeatSelectionSchema([
      { beat_id: 'hook', eligible_variant_ids: ['hero/service_statement'] },
      { beat_id: 'offer', eligible_variant_ids: ['cta/direct_contact', 'cta/booking_link'] },
    ]);
    expect(enumsOf(schema)).toEqual({
      hook: ['hero/service_statement'],
      offer: ['cta/booking_link', 'cta/direct_contact'],
    });
    // A variant eligible for the offer beat is not reachable from the hook beat.
    expect(enumsOf(schema)['hook']).not.toContain('cta/direct_contact');
  });

  it('builds one enum per section instance for arrangement selection', () => {
    const schema = buildArrangementSchema([
      { instance_id: 's_hero', eligible_arrangement_ids: ['stacked-left', 'portrait-right'] },
    ]);
    expect(enumsOf(schema)['s_hero']).toEqual(['portrait-right', 'stacked-left']);
  });

  it('caps copy length and names the facts the slot may draw on', () => {
    const schema = buildCopySchema([
      { slot: 'headline', max_chars: 60, grounded_in: ['f_founded', 'f_legal_name'] },
    ]);
    expect(schema.properties['headline']).toMatchObject({ type: 'string', maxLength: 60 });
    expect(schema.properties['headline']).toHaveProperty(
      'description',
      expect.stringContaining('f_founded, f_legal_name'),
    );
    expect(schema.additionalProperties).toBe(false);
  });

  it('lets a copy slot carry its own description', () => {
    const schema = buildCopySchema([
      { slot: 'headline', max_chars: 60, grounded_in: [], description: 'custom' },
    ]);
    expect(schema.properties['headline']).toMatchObject({ description: 'custom' });
  });

  it('reports enums only for enum-valued properties', () => {
    expect(enumsOf(buildCopySchema([{ slot: 'a', max_chars: 10, grounded_in: [] }]))).toEqual({});
  });
});
