import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  assertPolicy,
  evaluateAssertion,
  freePort,
  runLighthousePass,
  summariseLighthouse,
  unevaluatedErrors,
  type AssertionResult,
} from '../src/lighthouse-pass.js';
import { JS_BUDGET_BYTES, LHCI_ASSERTIONS } from '../src/policy.js';

const root = fileURLToPath(new URL('../fixtures/site-clean', import.meta.url));

/** A minimal LHR shaped like the parts the policy reads. */
function lhr(overrides: {
  resourceSummary?: { resourceType: string; transferSize: number; requestCount: number }[];
  audits?: Record<string, unknown>;
}): Record<string, unknown> {
  const audits: Record<string, unknown> = {
    'resource-summary': {
      score: null,
      details: { items: overrides.resourceSummary ?? [] },
    },
    'unsized-images': { score: 1, details: { items: [] } },
    'render-blocking-insight': { score: 1, details: { items: [] } },
    'non-composited-animations': { score: 1, details: { items: [] } },
    'font-display-insight': { score: 1, details: { items: [] } },
    'image-delivery-insight': { score: 1, details: { items: [] } },
    'lcp-discovery-insight': { score: 1, details: { items: [] } },
    'cumulative-layout-shift': { score: 1, numericValue: 0 },
    'largest-contentful-paint': { score: 1, numericValue: 1000 },
    'total-blocking-time': { score: 1, numericValue: 0 },
    'first-contentful-paint': { score: 1, numericValue: 800 },
    ...overrides.audits,
  };
  return { audits };
}

const clean = (): Record<string, unknown> =>
  lhr({
    resourceSummary: [
      { resourceType: 'script', transferSize: 1000, requestCount: 1 },
      { resourceType: 'font', transferSize: 0, requestCount: 0 },
      { resourceType: 'third-party', transferSize: 0, requestCount: 0 },
    ],
  });

describe('evaluateAssertion', () => {
  it('applies a numeric bound and records what it measured against', () => {
    const result = evaluateAssertion(
      'total-blocking-time',
      { level: 'warn', maxNumericValue: 200, reason: 'timing' },
      { score: 1, numericValue: 250 },
      '/',
    );
    expect(result).toMatchObject({
      passed: false,
      actual: 250,
      expected: 200,
      kind: 'maxNumericValue',
    });
  });

  it('applies a length bound to the audit table', () => {
    const result = evaluateAssertion(
      'unsized-images',
      { level: 'error', maxLength: 0, reason: 'layout shift' },
      { score: 0, details: { items: [{}, {}] } },
      '/',
    );
    expect(result).toMatchObject({ passed: false, actual: 2, expected: 0, kind: 'maxLength' });
  });

  it('returns nothing for an assertion that is switched off', () => {
    expect(
      evaluateAssertion('x', { level: 'off', maxLength: 0, reason: '' }, { score: 1 }, '/'),
    ).toBeNull();
  });

  it('returns nothing rather than a pass when the audit is absent', () => {
    // The caller turns this into a fatal row for error-level budgets. What it must never do is
    // read a missing audit as a satisfied bound.
    expect(
      evaluateAssertion('x', { level: 'error', maxLength: 0, reason: '' }, undefined, '/'),
    ).toBeNull();
  });
});

describe('assertPolicy', () => {
  it('evaluates every row of the policy against a complete run', () => {
    const results = assertPolicy(clean(), '/');
    expect(results.map((row) => row.id).sort()).toEqual(Object.keys(LHCI_ASSERTIONS).sort());
    expect(results.every((row) => row.passed)).toBe(true);
  });

  it('lifts a single resource-summary row out of the audit table', () => {
    const results = assertPolicy(
      lhr({
        resourceSummary: [
          { resourceType: 'script', transferSize: JS_BUDGET_BYTES + 1, requestCount: 4 },
        ],
      }),
      '/',
    );
    expect(results.find((row) => row.id === 'resource-summary:script:size')).toMatchObject({
      passed: false,
      actual: JS_BUDGET_BYTES + 1,
    });
    // A resource type with no requests is genuinely zero, not missing.
    expect(results.find((row) => row.id === 'resource-summary:font:count')).toMatchObject({
      passed: true,
      actual: 0,
    });
  });

  it('treats a missing resource-summary audit as unmeasured, not as zero bytes', () => {
    const results = assertPolicy({ audits: {} }, '/');
    expect(results.some((row) => row.id.startsWith('resource-summary:'))).toBe(false);
  });
});

describe('unevaluatedErrors', () => {
  const errorIds = Object.entries(LHCI_ASSERTIONS)
    .filter(([, assertion]) => assertion.level === 'error')
    .map(([id]) => id);

  it('turns every unevaluated error-level budget into a failing row', () => {
    const rows = unevaluatedErrors([], '/');
    expect(rows.map((row) => row.id).sort()).toEqual([...errorIds].sort());
    expect(rows.every((row) => !row.passed && row.kind === 'absent')).toBe(true);
  });

  it('does not re-report a budget that was evaluated, and ignores warn-level rows', () => {
    expect(unevaluatedErrors(assertPolicy(clean(), '/'), '/')).toEqual([]);
  });

  it('is what makes an audit rename fatal instead of silently green', () => {
    // The failure this exists for: upstream renames `unsized-images`, the id stops matching, and
    // nothing measures layout shift again until somebody notices by eye.
    const renamed = clean();
    delete (renamed['audits'] as Record<string, unknown>)['unsized-images'];
    const missing = unevaluatedErrors(assertPolicy(renamed, '/'), '/');
    expect(missing.map((row) => row.id)).toEqual(['unsized-images']);
    expect(missing[0]?.reason).toMatch(/the budget was not enforced/);
  });
});

describe('summariseLighthouse', () => {
  const fatal: AssertionResult = {
    id: 'resource-summary:script:size',
    level: 'error',
    passed: false,
    actual: 200_000,
    expected: JS_BUDGET_BYTES,
    kind: 'maxNumericValue',
    reason: 'the 180 kB JavaScript budget',
    route: '/',
  };

  it('names the route, the budget and the measurement on a failure', () => {
    const text = summariseLighthouse({
      assertions: [fatal],
      fatal: [fatal],
      warnings: [],
      canShip: false,
      medianByRoute: {},
    });
    expect(text).toContain('resource-summary:script:size');
    expect(text).toContain('200000 > 184320');
  });

  it('says "not evaluated" rather than "null > null" for an absent audit', () => {
    const text = summariseLighthouse({
      assertions: [],
      fatal: [{ ...fatal, actual: null, expected: null, kind: 'absent' }],
      warnings: [],
      canShip: false,
      medianByRoute: {},
    });
    expect(text).toContain('not evaluated');
  });
});

describe('freePort', () => {
  it('returns a bindable port rather than a guessed one', async () => {
    expect(await freePort()).toBeGreaterThan(1024);
  });
});

describe('the Lighthouse pass, against the clean fixture', () => {
  it('runs the real audits and holds the built site to the resource budgets', async () => {
    const result = await runLighthousePass({ root, routes: ['/'], runs: 1 });

    // Every error-level budget must have been measured; that is the point of the pass.
    for (const [id, assertion] of Object.entries(LHCI_ASSERTIONS)) {
      if (assertion.level !== 'error') continue;
      const row = result.assertions.find((candidate) => candidate.id === id);
      expect(row, `${id} was not evaluated`).toBeDefined();
      expect(row?.kind, `${id} was reported absent`).not.toBe('absent');
    }

    expect(result.fatal, summariseLighthouse(result)).toEqual([]);
    expect(result.canShip).toBe(true);
  }, 300_000);
});
