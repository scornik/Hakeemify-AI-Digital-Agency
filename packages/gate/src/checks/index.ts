import type { Check } from '../context.js';
import { SEO_CHECKS } from './seo.js';
import { STRUCTURE_CHECKS } from './structure.js';
import { CONTENT_CHECKS } from './content.js';
import { A11Y_CHECKS } from './a11y.js';
import { TRUST_CHECKS } from './trust.js';

export * from './seo.js';
export * from './structure.js';
export * from './content.js';
export * from './a11y.js';
export * from './trust.js';

/** Every check the gate knows about. */
export const ALL_CHECKS: readonly Check[] = [
  ...SEO_CHECKS,
  ...STRUCTURE_CHECKS,
  ...CONTENT_CHECKS,
  ...A11Y_CHECKS,
  ...TRUST_CHECKS,
];

/**
 * The checks decidable from the build output and the static DOM alone. These run on every page
 * of every build with no browser, which is what makes a 40-check pass cost seconds.
 */
export const STATIC_CHECKS: readonly Check[] = ALL_CHECKS.filter((check) =>
  check.requiredArtifacts.every((artifact) => artifact === 'dom' || artifact === 'build'),
);

/** The checks that need a real browser. */
export const RUNTIME_CHECKS: readonly Check[] = ALL_CHECKS.filter(
  (check) => !STATIC_CHECKS.includes(check),
);
