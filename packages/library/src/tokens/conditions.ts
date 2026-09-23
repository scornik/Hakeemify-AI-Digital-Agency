/**
 * The conditions table (SYNTHESIS §7.1, "Chakra/S2").
 *
 * One map from condition name to the selector and at-rule that carry it. Two consequences,
 * both deliberate:
 *
 * - **Dark mode is a condition, not a second file.** A `_dark` column on a token cannot drift
 *   from its base value, and a design system cannot ship a dark theme that is missing a role.
 * - **`reduced_motion` is in the same table as `dark`.** ARCHITECTURE §1.2 requires the kill
 *   switch to exist in `tokens.css` independently of any JS; making reduced motion a token
 *   condition rather than a component contract is what makes that structural.
 */

export const CONDITION_NAMES = [
  'dark',
  'reduced_motion',
  'forced_colors',
  'print',
  'touch',
] as const;
export type ConditionName = (typeof CONDITION_NAMES)[number];

export interface ConditionRule {
  /** An at-rule prelude, or `null` for a bare selector. */
  readonly at: string | null;
  readonly selector: string;
}

export interface ConditionDefinition {
  readonly name: ConditionName;
  readonly description: string;
  /** Emitted in order; a token override under this condition is written into every rule. */
  readonly rules: readonly ConditionRule[];
}

/**
 * `dark` gets two rules on purpose. The media query is the default, scoped so an explicit
 * `data-ds-scheme="light"` can opt out of it, and the attribute rule lets an owner force dark
 * without JS reading a preference. Everything else is a single media query: the user agent
 * decides, and nothing in the page may override it.
 */
export const CONDITIONS: Readonly<Record<ConditionName, ConditionDefinition>> = {
  dark: {
    name: 'dark',
    description: 'User-agent dark preference, or an explicit data-ds-scheme="dark".',
    rules: [
      {
        at: '@media (prefers-color-scheme: dark)',
        selector: ':root:not([data-ds-scheme="light"])',
      },
      { at: null, selector: ':root[data-ds-scheme="dark"]' },
    ],
  },
  reduced_motion: {
    name: 'reduced_motion',
    description: 'ARCHITECTURE §1.2 — asserted by the gate, enforced here without JS.',
    rules: [{ at: '@media (prefers-reduced-motion: reduce)', selector: ':root' }],
  },
  forced_colors: {
    name: 'forced_colors',
    description: 'Windows high contrast and friends: hand the palette back to the OS.',
    rules: [{ at: '@media (forced-colors: active)', selector: ':root' }],
  },
  print: {
    name: 'print',
    description: 'Ink on paper: white ground, black text, no motion.',
    rules: [{ at: '@media print', selector: ':root' }],
  },
  touch: {
    name: 'touch',
    description: 'Coarse pointer without hover — tap targets grow, hover affordances do not.',
    rules: [{ at: '@media (hover: none) and (pointer: coarse)', selector: ':root' }],
  },
};

export function isConditionName(value: string): value is ConditionName {
  return (CONDITION_NAMES as readonly string[]).includes(value);
}

/**
 * The reduced-motion kill switch, emitted into every `tokens.css` whether or not the design
 * system declares any motion tokens.
 *
 * ARCHITECTURE §1.2: 0 of 16 sampled Aceternity components and 5 of 78 MagicUI components
 * honour `prefers-reduced-motion`. A component contract that everybody ignores is not a
 * contract; a stylesheet rule with `!important` in the base layer is.
 */
export const REDUCED_MOTION_KILL_SWITCH = `@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}`;

/** `@layer` order, per SYNTHESIS §7.1: reset < base < tokens < recipes. */
export const LAYER_ORDER = ['reset', 'base', 'tokens', 'recipes'] as const;
