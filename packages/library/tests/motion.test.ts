import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMPOSITOR_SAFE_PROPERTIES,
  MOTION_REGISTRY_FILENAME,
  MotionByteCeilingError,
  MotionRegistryError,
  REDUCED_MOTION_ARM,
  TIER_RUNTIME_GZ_BYTES,
  assertByteCeilings,
  auditEffectsProperties,
  gzipBytes,
  loadManifests,
  loadMotionRegistry,
  measureEffects,
  MOTION_DIR,
} from '../src/index.js';

const OVER_BUDGET = join(import.meta.dirname, 'fixtures', 'motion', 'over-budget', 'registry.yml');
const FIXTURE_LIBRARY = join(import.meta.dirname, 'fixtures', 'library', 'sections');

describe('the authored motion registry', () => {
  const registry = loadMotionRegistry();

  it('loads and is a closed vocabulary', () => {
    expect(registry.path).toBe(join(MOTION_DIR, MOTION_REGISTRY_FILENAME));
    expect([...registry.byId.keys()]).toEqual([
      'poster_loop',
      'reveal_fade',
      'parallax_subtle',
      'pin_scroll_story',
      'shader_plane',
    ]);
  });

  it('covers all four tiers, with tier_0 the zero-JS default', () => {
    const tiers = new Set(registry.file.effects.map((effect) => effect.tier));
    expect(tiers).toEqual(new Set(['tier_0', 'tier_a', 'tier_b', 'tier_c']));
    const poster = registry.byId.get('poster_loop')!;
    expect(poster.tier).toBe('tier_0');
    expect(poster.max_gz_bytes).toBe(0);
    expect(poster.sources).toEqual([]);
  });

  it('declares only compositor-threaded properties', () => {
    for (const effect of registry.file.effects) {
      for (const property of effect.allowed_properties) {
        expect(COMPOSITOR_SAFE_PROPERTIES).toContain(property);
      }
    }
  });

  it('keeps every effect inside its tier runtime budget', () => {
    for (const effect of registry.file.effects) {
      expect(effect.max_gz_bytes, effect.id).toBeLessThanOrEqual(
        TIER_RUNTIME_GZ_BYTES[effect.tier],
      );
    }
    // ARCHITECTURE §1.1's numbers, recorded rather than approximated.
    expect(TIER_RUNTIME_GZ_BYTES.tier_a).toBe(10752);
    expect(TIER_RUNTIME_GZ_BYTES.tier_b).toBe(47616);
    expect(TIER_RUNTIME_GZ_BYTES.tier_c).toBe(15360);
  });

  it('is inside every declared byte ceiling, measured with zlib', () => {
    const measurements = assertByteCeilings(registry.file.effects, registry.dir);
    const revealFade = measurements.find((m) => m.id === 'reveal_fade')!;
    expect(revealFade.state).toBe('pass');
    expect(revealFade.measured).toBeGreaterThan(0);
    expect(revealFade.measured).toBeLessThanOrEqual(revealFade.declared);
  });

  it('reports a planned effect as not measured, rather than as a pass', () => {
    const measurements = measureEffects(registry.file.effects, registry.dir);
    expect(measurements.find((m) => m.id === 'pin_scroll_story')!.state).toBe('not_measured');
    expect(measurements.find((m) => m.id === 'shader_plane')!.state).toBe('not_measured');
    // tier_0 ships nothing on purpose, so it is a real pass and not a gap.
    expect(measurements.find((m) => m.id === 'poster_loop')!.state).toBe('pass');
  });

  it('animates nothing its effects do not declare', () => {
    expect(auditEffectsProperties(registry.file.effects, registry.dir)).toEqual([]);
  });

  it('is the vocabulary every manifest motion profile draws from', () => {
    const effects = loadManifests(FIXTURE_LIBRARY).map((entry) => entry.manifest.motion.effect);
    expect(effects.length).toBeGreaterThan(0);
    for (const effect of effects) expect(registry.byId.has(effect)).toBe(true);
  });
});

describe('the byte-ceiling check fails an effect over its budget', () => {
  it('FAILS when measured gz bytes exceed the declared ceiling', () => {
    // The DoD assertion.
    const fixture = loadMotionRegistry(OVER_BUDGET);
    let thrown: MotionByteCeilingError | undefined;
    try {
      assertByteCeilings(fixture.file.effects, fixture.dir);
    } catch (error) {
      thrown = error as MotionByteCeilingError;
    }
    expect(thrown).toBeInstanceOf(MotionByteCeilingError);
    expect(thrown!.failures).toHaveLength(1);
    const [failure] = thrown!.failures;
    expect(failure!.id).toBe('fat_effect');
    expect(failure!.declared).toBe(120);
    expect(failure!.measured).toBeGreaterThan(120);
    expect(thrown!.message).toMatch(/fat_effect \(tier_a\): \d+ gz bytes, declared ceiling 120/);

    // The effect beside it passes: the failure is attributable, not registry-wide.
    const measurements = measureEffects(fixture.file.effects, fixture.dir);
    expect(measurements.find((m) => m.id === 'thin_effect')!.state).toBe('pass');
  });

  it('fails an effect whose declared source is not on disk', () => {
    const fixture = loadMotionRegistry(OVER_BUDGET);
    const ghost = { ...fixture.file.effects[0]!, id: 'ghost', sources: ['nope.js'] };
    const [measurement] = measureEffects([ghost], fixture.dir);
    expect(measurement!.state).toBe('fail');
    expect(measurement!.missing).toEqual(['nope.js']);
  });

  it('measures reproducibly, at a fixed compression level', () => {
    expect(gzipBytes('hello world')).toBe(gzipBytes('hello world'));
    expect(gzipBytes(Buffer.from('hello world'))).toBe(gzipBytes('hello world'));
  });
});

describe('the reduced-motion arm follows from the kind of motion', () => {
  it('uses the tri-mode reading, not an author preference', () => {
    expect(REDUCED_MOTION_ARM).toEqual({
      programmatic: 'instant',
      gesture: 'one_to_one',
      loop: 'poster',
    });
    const registry = loadMotionRegistry();
    for (const effect of registry.file.effects) {
      expect(effect.reduced_motion_fallback, effect.id).toBe(
        REDUCED_MOTION_ARM[effect.motion_kind],
      );
    }
  });

  it('refuses an effect that pairs a kind with the wrong arm', () => {
    expect(() =>
      loadMotionRegistry(
        join(import.meta.dirname, 'fixtures', 'motion', 'bad-arm', 'registry.yml'),
      ),
    ).toThrow(MotionRegistryError);
  });
});
