import { describe, expect, it } from 'vitest';
import {
  PALETTE_STEPS,
  generatePalette,
  radiusScale,
  spacingScale,
  typeScale,
} from '../src/tokens/algorithms.js';
import { contrastRatio, parseHexColour, relativeLuminance } from '../src/tokens/colour.js';

describe('palette generation', () => {
  const palette = generatePalette('#1f4e8c');

  it('produces exactly ten steps', () => {
    expect(palette).toHaveLength(PALETTE_STEPS);
    expect(palette.every((step) => parseHexColour(step) !== null)).toBe(true);
  });

  it('darkens monotonically from index 0', () => {
    const luminance = palette.map((hex) => relativeLuminance(parseHexColour(hex)!));
    for (let i = 1; i < luminance.length; i += 1) {
      expect(luminance[i]!).toBeLessThan(luminance[i - 1]!);
    }
  });

  it('spans enough range for a role table to find an AA pair at the ends', () => {
    expect(
      contrastRatio(parseHexColour(palette[0]!)!, parseHexColour(palette[9]!)!),
    ).toBeGreaterThan(12);
  });

  it('is deterministic — the same seed is the same ramp', () => {
    expect(generatePalette('#1f4e8c')).toEqual(palette);
  });

  it('keeps a grey seed grey at every step', () => {
    for (const step of generatePalette('#808080')) {
      const rgb = parseHexColour(step)!;
      expect(rgb.r).toBe(rgb.g);
      expect(rgb.g).toBe(rgb.b);
    }
  });

  it('refuses a seed it cannot parse', () => {
    expect(() => generatePalette('teal')).toThrow(/not a hex colour/i);
  });
});

describe('type scale', () => {
  it('is base * ratio^step, per v4 §3', () => {
    const scale = typeScale({ base: 17, ratio: 1.25, steps: [-1, 0, 1, 2] });
    expect(scale.map((s) => s.step)).toEqual([-1, 0, 1, 2]);
    expect(scale[0]!.px).toBeCloseTo(17 / 1.25, 4);
    expect(scale[1]!.px).toBeCloseTo(17, 4);
    expect(scale[3]!.px).toBeCloseTo(17 * 1.25 * 1.25, 4);
  });

  it('names negative steps without a CSS-illegal minus', () => {
    const scale = typeScale({ base: 17, ratio: 1.25, steps: [-2, -1, 0] });
    expect(scale.map((s) => s.name)).toEqual(['n2', 'n1', '0']);
  });

  it('rejects a ratio that would not produce a scale', () => {
    expect(() => typeScale({ base: 17, ratio: 1, steps: [0] })).toThrow(/ratio/i);
    expect(() => typeScale({ base: 0, ratio: 1.25, steps: [0] })).toThrow(/base/i);
  });
});

describe('spacing scale', () => {
  it('is unit * step, per v4 §3', () => {
    const scale = spacingScale({ unit: 8, steps: [0.5, 1, 2, 13] });
    expect(scale.map((s) => s.px)).toEqual([4, 8, 16, 104]);
  });

  it('names a fractional step without a CSS-illegal dot', () => {
    expect(spacingScale({ unit: 8, steps: [0.5, 1.25] }).map((s) => s.name)).toEqual([
      '0-5',
      '1-25',
    ]);
  });

  it('rejects a non-positive unit', () => {
    expect(() => spacingScale({ unit: 0, steps: [1] })).toThrow(/unit/i);
  });
});

describe('radius scale', () => {
  it('is base * step, so v4 §3’s [0, 2, 4] falls out of a 2px base', () => {
    expect(radiusScale({ base: 2, steps: [0, 1, 2] }).map((s) => s.px)).toEqual([0, 2, 4]);
  });

  it('rejects a negative step', () => {
    expect(() => radiusScale({ base: 2, steps: [-1] })).toThrow(/negative/i);
  });
});
