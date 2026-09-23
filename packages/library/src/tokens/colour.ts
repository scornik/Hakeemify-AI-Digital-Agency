/**
 * Colour maths for the token compiler.
 *
 * Written here rather than pulled in, for two reasons. The obvious one is ARCHITECTURE §1.6:
 * every colour library worth having drags a licence question and a dependency into the one
 * package whose closure is held to the strict shipped list. The load-bearing one is that
 * WCAG contrast is a **build gate** (SYNTHESIS §7.1) — a check that fails a build must be
 * something we can read end to end, and the sRGB relative-luminance definition is forty lines.
 *
 * Everything here is pure and total: a malformed colour returns `null` rather than throwing,
 * because the caller accumulating violations wants a violation, not a stack trace.
 */

export interface Rgb {
  /** 0–255, integer. */
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Hsl {
  /** Degrees, 0–360. */
  readonly h: number;
  /** 0–1. */
  readonly s: number;
  /** 0–1. */
  readonly l: number;
}

const HEX = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Parse `#abc`, `#aabbcc` or `#aabbccff`. Alpha is accepted and discarded: a token that
 * carries transparency cannot be contrast-checked against anything, so admitting it silently
 * would be worse than rejecting the file that declared it.
 */
export function parseHexColour(value: string): Rgb | null {
  const raw = value.trim();
  if (!HEX.test(raw)) return null;
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (hex.length === 3) {
    const [r, g, b] = [hex[0], hex[1], hex[2]] as [string, string, string];
    return {
      r: Number.parseInt(r + r, 16),
      g: Number.parseInt(g + g, 16),
      b: Number.parseInt(b + b, 16),
    };
  }
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

const pad = (n: number): string => n.toString(16).padStart(2, '0');

/** Lower-case six-digit hex. Channels are clamped and rounded on the way out. */
export function formatHex({ r, g, b }: Rgb): string {
  return `#${pad(clampByte(r))}${pad(clampByte(g))}${pad(clampByte(b))}`;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** WCAG 2.x sRGB → linear transfer function, per channel, on 0–1 input. */
export function srgbToLinear(channel: number): number {
  return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance: 0 for black, 1 for white. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG 2.x contrast ratio, 1–21. Order-independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export type TextSize = 'normal' | 'large';

/**
 * WCAG 2.2 SC 1.4.3 (AA). "Large" is ≥ 18.66px bold or ≥ 24px regular; the author declares
 * which pairs are large, because the compiler cannot know how a pair will be composed.
 */
export function wcagMinimum(size: TextSize): number {
  return size === 'large' ? 3 : 4.5;
}

/**
 * A ratio exactly on the threshold passes. The success criterion is written "at least", and
 * rounding a computed double downwards would fail pairs the standard admits.
 */
export function meetsWcag(ratio: number, size: TextSize): boolean {
  return ratio >= wcagMinimum(size);
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) return { h: 0, s: 0, l };

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
  else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
  else h = 60 * ((rn - gn) / delta + 4);
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sat = Math.min(1, Math.max(0, s));
  const lig = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hue = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lig - c / 2;

  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return {
    r: clampByte((rgb[0] + m) * 255),
    g: clampByte((rgb[1] + m) * 255),
    b: clampByte((rgb[2] + m) * 255),
  };
}
