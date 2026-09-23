/**
 * Gate policy: the Playwright project matrix, the axe tag set, and the LHCI assertions.
 *
 * Kept as data in one file so the whole policy is readable at once and versioned as a unit
 * (Ghost's gscan pattern: a versioned rule pack with fatal and warning classes, where
 * `canShip = !hasFatal`).
 *
 * The performance rule that matters: **budgets gate on deterministic resource summaries, never
 * on the performance score**. Sizes and counts are exact on a static build; LCP and TBT move
 * run to run, so they warn on the median of three and never fail a build on their own.
 */

export const GATE_POLICY_VERSION = 'launch@1';

/** 180 kB per page (ARCHITECTURE §7). */
export const JS_BUDGET_BYTES = 184_320;

export interface ProjectDefinition {
  readonly name: string;
  readonly device: string | null;
  readonly viewport: { width: number; height: number } | null;
  readonly colorScheme: 'light' | 'dark';
  readonly reducedMotion: 'no-preference' | 'reduce';
  /** Which artifacts this project is expected to produce. */
  readonly artifacts: readonly (
    'dom' | 'axe' | 'console' | 'network' | 'runtime' | 'screenshots'
  )[];
}

/**
 * One spec, five projects. `reduced-motion` and `dark` exist because nothing in the animation
 * or component ecosystem honours either by default, so both need a run of their own rather than
 * a note in a review.
 */
export const PROJECTS: readonly ProjectDefinition[] = [
  {
    name: 'desktop-chrome',
    device: 'Desktop Chrome',
    viewport: { width: 1350, height: 940 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    artifacts: ['dom', 'axe', 'console', 'network', 'runtime', 'screenshots'],
  },
  {
    name: 'mobile-safari',
    device: 'iPhone 14',
    viewport: null,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    artifacts: ['dom', 'axe', 'console', 'network', 'runtime', 'screenshots'],
  },
  {
    name: 'tablet',
    device: 'iPad (gen 7)',
    viewport: null,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    artifacts: ['dom', 'axe', 'screenshots'],
  },
  {
    name: 'reduced-motion',
    device: 'Desktop Chrome',
    viewport: { width: 1350, height: 940 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    artifacts: ['dom', 'runtime', 'screenshots'],
  },
  {
    name: 'dark',
    device: 'Desktop Chrome',
    viewport: { width: 1350, height: 940 },
    colorScheme: 'dark',
    reducedMotion: 'no-preference',
    artifacts: ['dom', 'axe', 'screenshots'],
  },
];

/**
 * The full tag set, not Lighthouse's subset. `incomplete` results are kept and surfaced as
 * `needs_review` rather than discarded.
 */
export const AXE_TAGS: readonly string[] = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
];

export type AssertionLevel = 'off' | 'warn' | 'error';

export interface LhciAssertion {
  readonly level: AssertionLevel;
  readonly maxNumericValue?: number;
  readonly maxLength?: number;
  readonly minScore?: number;
  readonly aggregationMethod?: 'median' | 'median-run' | 'optimistic' | 'pessimistic';
  readonly reason: string;
}

/**
 * Deterministic rows are `error`; timing rows are `warn` on the median run. `categories:*` is
 * absent on purpose — a category score is an average over audits with different determinism,
 * and gating on it is how a flaky metric ends up blocking a deploy.
 */
export const LHCI_ASSERTIONS: Readonly<Record<string, LhciAssertion>> = {
  'resource-summary:script:size': {
    level: 'error',
    maxNumericValue: JS_BUDGET_BYTES,
    reason: 'the 180 kB JavaScript budget, exact on a static build',
  },
  'resource-summary:font:count': {
    level: 'error',
    maxNumericValue: 2,
    reason: 'two font files; a third is almost always an unused weight',
  },
  'resource-summary:font:size': {
    level: 'error',
    maxNumericValue: 204_800,
    reason: '200 kB of fonts',
  },
  'resource-summary:third-party:count': {
    level: 'error',
    maxNumericValue: 2,
    reason: 'fonts and analytics only',
  },
  'unsized-images': { level: 'error', maxLength: 0, reason: 'layout shift, deterministic' },
  'render-blocking-insight': {
    level: 'error',
    maxLength: 0,
    reason: 'deterministic on static output',
  },
  'non-composited-animations': {
    level: 'error',
    maxLength: 0,
    reason: 'this is what enforces the motion budget mechanically',
  },
  'font-display-insight': {
    level: 'error',
    maxLength: 0,
    reason: 'invisible text while fonts load',
  },
  'image-delivery-insight': {
    level: 'error',
    maxLength: 0,
    reason: 'oversized or unmodern images',
  },
  'lcp-discovery-insight': {
    level: 'error',
    maxLength: 0,
    reason: 'the hero must be discoverable in HTML',
  },
  'cumulative-layout-shift': {
    level: 'error',
    maxNumericValue: 0.1,
    aggregationMethod: 'median-run',
    reason: 'near-deterministic on static output',
  },
  'largest-contentful-paint': {
    level: 'warn',
    maxNumericValue: 2500,
    aggregationMethod: 'median-run',
    reason: 'timing; warn on the median of three, never fail a build alone',
  },
  'total-blocking-time': {
    level: 'warn',
    maxNumericValue: 200,
    aggregationMethod: 'median-run',
    reason: 'timing',
  },
  'first-contentful-paint': {
    level: 'warn',
    maxNumericValue: 1800,
    aggregationMethod: 'median-run',
    reason: 'timing',
  },
};

export interface LhciConfig {
  readonly ci: {
    readonly collect: { readonly numberOfRuns: number; readonly url?: readonly string[] };
    readonly assert: { readonly assertions: Record<string, unknown> };
  };
}

/** Emit the `lighthouserc` shape LHCI consumes, from the policy above. */
export function buildLhciConfig(urls: readonly string[]): LhciConfig {
  const assertions: Record<string, unknown> = {};
  for (const [id, assertion] of Object.entries(LHCI_ASSERTIONS)) {
    const options: Record<string, unknown> = {};
    if (assertion.maxNumericValue !== undefined)
      options['maxNumericValue'] = assertion.maxNumericValue;
    if (assertion.maxLength !== undefined) options['maxLength'] = assertion.maxLength;
    if (assertion.minScore !== undefined) options['minScore'] = assertion.minScore;
    if (assertion.aggregationMethod !== undefined) {
      options['aggregationMethod'] = assertion.aggregationMethod;
    }
    assertions[id] = [assertion.level, options];
  }
  return {
    ci: {
      // Three serial runs; the median run is the one asserted against. Never run Lighthouse
      // instances concurrently on one machine.
      collect: { numberOfRuns: 3, url: urls },
      assert: { assertions },
    },
  };
}

/**
 * Pages are grouped by (archetype, arrangement signature) and only one representative per group
 * gets the expensive Lighthouse pass — Unlighthouse's sampling, made deterministic by picking
 * the first route in sorted order rather than at random.
 */
export function representativeRoutes(
  pages: readonly { route: string; archetype: string; arrangementSignature: string }[],
): string[] {
  const groups = new Map<string, string[]>();
  for (const page of pages) {
    const key = `${page.archetype}|${page.arrangementSignature}`;
    const list = groups.get(key) ?? [];
    list.push(page.route);
    groups.set(key, list);
  }
  return [...groups.values()].map((routes) => [...routes].sort()[0] as string).sort();
}
