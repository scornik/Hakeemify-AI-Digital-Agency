import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { loadSite } from '../src/artifacts/fixture-site.js';
import { STATIC_CHECKS, ALL_CHECKS } from '../src/checks/index.js';
import { runChecks, runGate, assertRegistryWellFormed } from '../src/registry.js';
import { GATE_POLICY_VERSION, JS_BUDGET_BYTES } from '../src/policy.js';
import { runBrowserGate, runStaticGate, summariseResult } from '../src/runner.js';
import type { CheckResult } from '../src/types.js';
import { brokenContext, cleanContext } from './fixtures/context.js';

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

const ORIGIN = 'https://ridgelineroofing.example';

const cleanBundles = loadSite({
  root: fixture('site-clean'),
  origin: ORIGIN,
  siteDefinitionHash: 'a'.repeat(64),
  jsBytesByRoute: { '/': 0, '/privacy': 0 },
  allowedHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  buildYear: 2026,
});

const brokenBundles = loadSite({
  root: fixture('site-broken'),
  origin: ORIGIN,
  siteDefinitionHash: 'b'.repeat(64),
  // The home page ships well over the 180 kB budget.
  jsBytesByRoute: { '/': 320_000, '/services': 1_000 },
  allowedHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
  buildYear: 2026,
});

/**
 * A check counts as failing when the machine decided it failed, or could not decide and needs a
 * reviewer, or could not run. `manual` rows are excluded: they are never auto-passed by design,
 * so they are present on a clean site too and say nothing about it.
 */
function failingIds(results: readonly CheckResult[]): string[] {
  return results
    .filter(
      (result) =>
        !result.passed &&
        (result.mode === 'binary' ||
          result.mode === 'numeric' ||
          result.mode === 'needs_review' ||
          result.mode === 'error'),
    )
    .map((result) => result.id)
    .sort();
}

describe('the check registry', () => {
  it('is well formed: unique ids, every check citing a checklist row', () => {
    expect(() => assertRegistryWellFormed(ALL_CHECKS as never)).not.toThrow();
  });

  it('splits into checks that need a browser and checks that do not', () => {
    expect(STATIC_CHECKS.length).toBeGreaterThan(25);
    expect(STATIC_CHECKS.length).toBeLessThan(ALL_CHECKS.length);
    for (const check of STATIC_CHECKS) {
      expect(check.requiredArtifacts.every((a) => a === 'dom' || a === 'build')).toBe(true);
    }
  });
});

describe('site-clean', () => {
  it('loads both pages', () => {
    expect(cleanBundles.map((bundle) => bundle.dom.route).sort()).toEqual(['/', '/privacy']);
  });

  it.each([0, 1])('produces zero fatal rows on page %i', (index) => {
    const bundle = cleanBundles[index];
    if (!bundle) throw new Error('missing bundle');
    const report = runGate(STATIC_CHECKS, bundle, {
      context: cleanContext,
      policyVersion: GATE_POLICY_VERSION,
    });
    expect(report.fatal).toEqual([]);
    expect(report.summary.errored).toBe(0);
  });

  it('fails no static check at all', () => {
    for (const bundle of cleanBundles) {
      const results = runChecks(STATIC_CHECKS, bundle, {
        context: cleanContext,
        policyVersion: GATE_POLICY_VERSION,
      });
      expect(failingIds(results)).toEqual([]);
    }
  });

  it('reports the runtime checks as notApplicable rather than passing them', () => {
    const bundle = cleanBundles[0];
    if (!bundle) throw new Error('missing bundle');
    const results = runChecks(ALL_CHECKS, bundle, {
      context: cleanContext,
      policyVersion: GATE_POLICY_VERSION,
    });
    const axe = results.find((result) => result.id === 'a11y.axe-violations');
    expect(axe?.mode).toBe('notApplicable');
    expect(axe?.passed).toBe(false);
    expect(axe?.weight).toBe(0);
  });

  it('carries the meaningful-alt row as a reviewer question, not a pass', () => {
    const bundle = cleanBundles[0];
    if (!bundle) throw new Error('missing bundle');
    const results = runChecks(STATIC_CHECKS, bundle, {
      context: cleanContext,
      policyVersion: GATE_POLICY_VERSION,
    });
    const alt = results.find((result) => result.id === 'a11y.meaningful-alt');
    expect(alt?.mode).toBe('manual');
    expect(alt?.weight).toBe(0);
  });
});

describe('site-broken', () => {
  /**
   * Every static check fails somewhere across the broken site's two pages. The failures are
   * split across pages because some are mutually exclusive on one: a page cannot both lack a
   * title and ship a duplicate of another page's title.
   */
  const EXPECTED_FAILURES = [
    'a11y.heading-order',
    'a11y.image-alt-present',
    'a11y.landmark-main',
    'a11y.reduced-motion-css',
    'a11y.viewport-zoomable',
    'bp.no-external-script-unlisted',
    'content.facts-provenance',
    'content.image-art-direction-grade',
    'content.image-dimensions-match-slot',
    'content.language-consistency',
    'content.no-empty-text-nodes',
    'content.placeholder-scan',
    'legal.copyright-year',
    'legal.pages-present',
    'links.anchor-targets',
    'links.internal-200',
    'links.no-orphans',
    'motion.autoplay-media',
    'motion.webgl-count',
    'nav.consistent',
    'perf.dom-size',
    'perf.js-budget-per-page',
    'perf.unsized-images',
    'schema.facts-match',
    'schema.jsonld-valid',
    'seo.canonical-self',
    'seo.crawlable-anchors',
    'seo.description-length',
    'seo.description-present',
    'seo.description-unique',
    'seo.h1-single',
    'seo.is-crawlable',
    'seo.link-text',
    'seo.og-twitter',
    'seo.robots-sitemap-ref',
    'seo.sitemap-consistency',
    'seo.title-length',
    'seo.title-present',
    'seo.title-unique',
    'structure.cta-present',
    'structure.sd-path-present',
    'structure.section-count',
    'trust.contact-parity',
    'trust.favicon-manifest',
  ].sort();

  it('fails exactly the expected set of checks across its pages', () => {
    const union = new Set<string>();
    for (const bundle of brokenBundles) {
      for (const id of failingIds(
        runChecks(STATIC_CHECKS, bundle, {
          context: brokenContext,
          policyVersion: GATE_POLICY_VERSION,
        }),
      )) {
        union.add(id);
      }
    }
    expect([...union].sort()).toEqual(EXPECTED_FAILURES);
  });

  it('covers every static check, so nothing ships untested', () => {
    const covered = new Set(EXPECTED_FAILURES);
    const uncovered = STATIC_CHECKS.map((check) => check.id)
      .filter((id) => !covered.has(id))
      // `meaningful-alt` is a manual row by construction and cannot be made to fail.
      .filter((id) => id !== 'a11y.meaningful-alt');
    expect(uncovered).toEqual([]);
  });

  it('cannot ship', () => {
    const bundle = brokenBundles[0];
    if (!bundle) throw new Error('missing bundle');
    const report = runGate(STATIC_CHECKS, bundle, {
      context: brokenContext,
      policyVersion: GATE_POLICY_VERSION,
    });
    expect(report.canShip).toBe(false);
    expect(report.fatal.length).toBeGreaterThan(20);
  });

  it('reports the JS budget overrun with the measured value', () => {
    const bundle = brokenBundles[0];
    if (!bundle) throw new Error('missing bundle');
    const results = runChecks(STATIC_CHECKS, bundle, {
      context: brokenContext,
      policyVersion: GATE_POLICY_VERSION,
    });
    const budget = results.find((result) => result.id === 'perf.js-budget-per-page');
    expect(budget).toMatchObject({ mode: 'numeric', passed: false, value: 320_000 });
    expect(JS_BUDGET_BYTES).toBe(184_320);
  });

  it('names the placeholder text it found rather than just failing', () => {
    const bundle = brokenBundles[0];
    if (!bundle) throw new Error('missing bundle');
    const results = runChecks(STATIC_CHECKS, bundle, {
      context: brokenContext,
      policyVersion: GATE_POLICY_VERSION,
    });
    const placeholder = results.find((result) => result.id === 'content.placeholder-scan');
    const details = placeholder?.items.map((item) => item.detail ?? '').join(' ');
    expect(details).toContain('lorem ipsum');
    expect(details).toContain('TODO/TBD');
    expect(details).toContain('unresolved template token');
  });
});

describe('the site runner', () => {
  const site = {
    root: fixture('site-clean'),
    origin: ORIGIN,
    siteDefinitionHash: 'a'.repeat(64),
    jsBytesByRoute: { '/': 0, '/privacy': 0 },
    allowedHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
    buildYear: 2026,
  };

  it('runs the static pass over a whole site and reports it green', () => {
    const result = runStaticGate({ site, context: cleanContext });
    expect(result.reports).toHaveLength(2);
    expect(result.fatal).toEqual([]);
    expect(result.canShip).toBe(true);
    expect(summariseResult(result)).toMatch(/gate green/);
  });

  it('reports a site red when any one page is red', () => {
    const result = runStaticGate({
      site: { ...site, root: fixture('site-broken'), jsBytesByRoute: { '/': 320_000 } },
      context: brokenContext,
    });
    expect(result.canShip).toBe(false);
    expect(summariseResult(result)).toMatch(/gate red/);
  });

  it('errors rather than skipping when a project promised an artifact it did not gather', () => {
    // The whole point of the two-pass split: a browser pass that produced nothing must fail
    // loudly, not silently shrink to the checks that happened to have data.
    const bundles = loadSite({ ...site, project: 'desktop-chrome' });
    const result = runBrowserGate({ bundles, context: cleanContext });
    expect(result.canShip).toBe(false);
    const errored = result.reports
      .flatMap((report) => report.checks)
      .filter((check) => check.mode === 'error');
    expect(errored.length).toBeGreaterThan(0);
    expect(errored[0]?.message).toMatch(/promised by the run policy but not gathered/);
    expect(result.reports[0]?.summary.score).toBeNull();
  });
});
