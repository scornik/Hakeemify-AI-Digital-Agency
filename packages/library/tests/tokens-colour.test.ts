import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  formatHex,
  hslToRgb,
  meetsWcag,
  parseHexColour,
  relativeLuminance,
  rgbToHsl,
  wcagMinimum,
} from '../src/tokens/colour.js';

describe('hex parsing', () => {
  it('accepts three-, six- and eight-digit forms', () => {
    expect(parseHexColour('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHexColour('#1F4E8C')).toEqual({ r: 31, g: 78, b: 140 });
    expect(parseHexColour('#1f4e8cff')).toEqual({ r: 31, g: 78, b: 140 });
  });

  it('rejects anything else, rather than guessing', () => {
    expect(parseHexColour('rgb(1,2,3)')).toBeNull();
    expect(parseHexColour('#12345')).toBeNull();
    expect(parseHexColour('CanvasText')).toBeNull();
    expect(parseHexColour('')).toBeNull();
  });

  it('round-trips through the formatter', () => {
    expect(formatHex({ r: 31, g: 78, b: 140 })).toBe('#1f4e8c');
    expect(formatHex(parseHexColour('#abcdef')!)).toBe('#abcdef');
  });
});

describe('relative luminance', () => {
  // The two anchors of the WCAG 2.x definition.
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 10);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10);
  });

  it('uses the linear segment below the 0.03928 knee', () => {
    // #0a0a0a is 10/255 = 0.0392, just under the knee, so the linear branch runs.
    const lum = relativeLuminance({ r: 10, g: 10, b: 10 });
    expect(lum).toBeCloseTo(10 / 255 / 12.92, 10);
  });
});

describe('contrast ratio', () => {
  it('is 21:1 for black on white, in either order', () => {
    const black = { r: 0, g: 0, b: 0 };
    const white = { r: 255, g: 255, b: 255 };
    expect(contrastRatio(black, white)).toBeCloseTo(21, 6);
    expect(contrastRatio(white, black)).toBeCloseTo(21, 6);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio({ r: 31, g: 78, b: 140 }, { r: 31, g: 78, b: 140 })).toBeCloseTo(1, 10);
  });

  it('matches a hand-checked reference pair', () => {
    // #767676 on #ffffff is the canonical "just passes AA" grey.
    const ratio = contrastRatio({ r: 0x76, g: 0x76, b: 0x76 }, { r: 255, g: 255, b: 255 });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.6);
  });
});

describe('WCAG thresholds', () => {
  it('is 4.5 for normal text and 3 for large text', () => {
    expect(wcagMinimum('normal')).toBe(4.5);
    expect(wcagMinimum('large')).toBe(3);
  });

  it('admits a ratio exactly on the threshold', () => {
    expect(meetsWcag(4.5, 'normal')).toBe(true);
    expect(meetsWcag(4.49, 'normal')).toBe(false);
    expect(meetsWcag(3, 'large')).toBe(true);
  });
});

describe('HSL round trip', () => {
  it('survives a round trip within one 8-bit step', () => {
    for (const hex of ['#1f4e8c', '#5a6068', '#ffffff', '#000000', '#c81e1e', '#0f9d58']) {
      const rgb = parseHexColour(hex)!;
      const back = hslToRgb(rgbToHsl(rgb));
      expect(Math.abs(back.r - rgb.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - rgb.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - rgb.b)).toBeLessThanOrEqual(1);
    }
  });

  it('gives a grey zero saturation and keeps it grey', () => {
    const hsl = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(hsl.s).toBe(0);
    expect(hslToRgb({ h: 200, s: 0, l: 0.5 })).toEqual({ r: 128, g: 128, b: 128 });
  });
});
