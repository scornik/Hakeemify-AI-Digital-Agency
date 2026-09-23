/**
 * Seed → derived algorithms (SYNTHESIS §7.1, v4 §3).
 *
 * A design system is authored as five numbers and a hue; everything else is computed. That is
 * what makes `hue_adaptable: true` cost nothing: a semantic role is an index into a generated
 * ramp, so changing the seed changes the whole system coherently instead of asking an author
 * to re-pick forty values.
 *
 * Every function here is pure and deterministic. They throw on input that could not produce a
 * scale, because a malformed seed is an authoring error the build must stop on, not a value to
 * be coerced.
 */
import { formatHex, hslToRgb, parseHexColour, rgbToHsl } from './colour.js';

/** v4 §3 and SYNTHESIS §7.1 both specify a ten-step ramp. It is not a parameter. */
export const PALETTE_STEPS = 10;

/**
 * Lightness per step, index 0 lightest. Chosen so that the ends clear AA against each other
 * with room to spare and the middle is usable for borders and surfaces — the role table in a
 * design system picks indices out of this, so the curve is the real contract.
 */
const LIGHTNESS: readonly number[] = [
  0.975, 0.945, 0.89, 0.8, 0.68, 0.545, 0.43, 0.33, 0.225, 0.135,
];

/**
 * Saturation multiplier per step. The extremes are desaturated because a fully saturated
 * near-white or near-black reads as a colour cast rather than a surface.
 */
const SATURATION: readonly number[] = [0.35, 0.45, 0.6, 0.8, 0.95, 1.0, 1.0, 0.95, 0.85, 0.75];

/**
 * A ten-step ramp from one seed colour.
 *
 * The seed contributes **hue and saturation only**; lightness comes from the curve. Two seeds
 * with the same hue and different lightness therefore produce the same ramp, which is the
 * point: the author picks a colour, not a position on a scale, and the scale is the system's.
 */
export function generatePalette(seed: string): string[] {
  const rgb = parseHexColour(seed);
  if (rgb === null)
    throw new TokenAlgorithmError(`palette seed ${JSON.stringify(seed)} is not a hex colour`);
  const { h, s } = rgbToHsl(rgb);
  return LIGHTNESS.map((l, index) =>
    formatHex(hslToRgb({ h, s: s * (SATURATION[index] ?? 1), l })),
  );
}

export class TokenAlgorithmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenAlgorithmError';
  }
}

export interface ScaleStep {
  /** The authored step, e.g. `-1` or `0.5`. */
  readonly step: number;
  /** A CSS-safe custom-property fragment: `-1` → `n1`, `0.5` → `0-5`. */
  readonly name: string;
  readonly px: number;
}

/**
 * `-1` → `n1` and `0.5` → `0-5`. A custom property may legally contain a minus or a dot, but
 * `--ds-type-size--1` and `--ds-space-0.5` are both a nuisance to read and a nuisance to grep,
 * and the gate greps token names.
 */
export function stepName(step: number): string {
  const sign = step < 0 ? 'n' : '';
  return sign + Math.abs(step).toString().replace('.', '-');
}

export interface TypeScaleInput {
  readonly base: number;
  readonly ratio: number;
  readonly steps: readonly number[];
}

/** `base · ratio^step` (v4 §3: `{ base: 17px, ratio: 1.25, steps: [-1..5] }`). */
export function typeScale({ base, ratio, steps }: TypeScaleInput): ScaleStep[] {
  if (!(base > 0)) throw new TokenAlgorithmError(`type scale base must be positive, got ${base}`);
  if (!(ratio > 1)) throw new TokenAlgorithmError(`type scale ratio must be > 1, got ${ratio}`);
  return steps.map((step) => ({
    step,
    name: stepName(step),
    px: round(base * Math.pow(ratio, step)),
  }));
}

export interface SpacingScaleInput {
  readonly unit: number;
  readonly steps: readonly number[];
}

/** `unit · step` (v4 §3: `{ unit: 8px, steps: [0.5, 1, 2, 3, 5, 8, 13] }`). */
export function spacingScale({ unit, steps }: SpacingScaleInput): ScaleStep[] {
  if (!(unit > 0)) throw new TokenAlgorithmError(`spacing unit must be positive, got ${unit}`);
  return steps.map((step) => {
    if (step < 0) throw new TokenAlgorithmError(`spacing step must not be negative, got ${step}`);
    return { step, name: stepName(step), px: round(unit * step) };
  });
}

export interface RadiusScaleInput {
  readonly base: number;
  readonly steps: readonly number[];
}

/**
 * `base · step`. v4 §3 writes the radius scale as literal pixels `[0, 2, 4]`; expressing it as
 * a seed times a step list keeps it in the same seed → derived shape as everything else, and
 * a 2px base with steps `[0, 1, 2]` reproduces v4's values exactly.
 */
export function radiusScale({ base, steps }: RadiusScaleInput): ScaleStep[] {
  if (!(base >= 0)) throw new TokenAlgorithmError(`radius base must not be negative, got ${base}`);
  return steps.map((step) => {
    if (step < 0) throw new TokenAlgorithmError(`radius step must not be negative, got ${step}`);
    return { step, name: stepName(step), px: round(base * step) };
  });
}

/** Four decimal places: enough for a 1.25 ratio at seven steps, short enough to diff. */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
