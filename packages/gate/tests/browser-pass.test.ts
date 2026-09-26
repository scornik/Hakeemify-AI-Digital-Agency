import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runBrowserPass, BrowserUnavailableError } from '../src/browser-pass.js';
import { PROJECTS } from '../src/policy.js';
import { cleanContext } from './fixtures/context.js';

const root = fileURLToPath(new URL('../fixtures/site-clean', import.meta.url));

const build = {
  siteDefinitionHash: 'a'.repeat(64),
  jsBytesByRoute: { '/': 0, '/privacy': 0 },
  sitemapRoutes: ['/', '/privacy'],
  robotsTxt: 'Sitemap: https://ridgelineroofing.example/sitemap.xml',
  llmsTxt: null,
  allowedHosts: [],
  buildYear: 2026,
};

/**
 * One project, one route. The full matrix runs in `pnpm e2e:fixture`; this suite is here to keep
 * the wiring honest — that the browser pass produces the artifacts it promises, and that the
 * checks which are `notApplicable` without a browser genuinely decide once there is one.
 */
describe('the browser pass', () => {
  const desktop = PROJECTS.find((project) => project.name === 'desktop-chrome');
  if (!desktop) throw new Error('the project matrix has no desktop-chrome project');

  it('gathers the artifacts only a browser can produce, and decides the checks that need them', async () => {
    const result = await runBrowserPass({
      root,
      origin: 'https://ridgelineroofing.example',
      context: cleanContext,
      build,
      // Both routes, because `build.routes` is derived from this list: gathering only `/` would
      // make the fixture's own footer link to `/privacy` look like a broken link.
      routes: ['/', '/privacy'],
      projects: [desktop],
    });

    expect(result.reports).toHaveLength(2);
    const report = result.reports[0];
    if (!report) throw new Error('no report');

    const byId = new Map(report.checks.map((check) => [check.id, check]));

    // Each of these is `notApplicable` in the static pass. If any is still notApplicable here,
    // the gatherer silently produced nothing and the gate quietly shrank.
    for (const id of [
      'a11y.axe-violations',
      'a11y.axe-tag-policy',
      'a11y.focus-visible',
      'structure.tab-order-sanity',
      'structure.no-horizontal-scroll',
      'bp.console-clean',
      'bp.no-failed-requests',
      'content.lcp-element-identity',
    ]) {
      expect(byId.get(id)?.mode, `${id} was not decided`).not.toBe('notApplicable');
    }

    // "Clean" has to mean green, or the fixture stops being a baseline. Asserting only that the
    // checks were *decided* is how this fixture spent a milestone requesting an image that did
    // not exist: `bp.no-failed-requests` was decided, and decided against it, and nobody read it.
    const failing = result.reports.flatMap((row) =>
      row.checks.filter((check) => check.mode !== 'notApplicable' && !check.passed),
    );
    expect(result.fatal, JSON.stringify(failing, null, 2)).toEqual([]);
  }, 120_000);

  it('runs axe with the full tag set, not Lighthouse’s subset', async () => {
    const result = await runBrowserPass({
      root,
      origin: 'https://ridgelineroofing.example',
      context: cleanContext,
      build,
      routes: ['/'],
      projects: [desktop],
    });
    const policy = result.reports[0]?.checks.find((check) => check.id === 'a11y.axe-tag-policy');
    expect(policy?.passed).toBe(true);
  }, 120_000);

  it('counts nothing running under reduced motion, which nothing else asserts', async () => {
    const reduced = PROJECTS.find((project) => project.name === 'reduced-motion');
    if (!reduced) throw new Error('the project matrix has no reduced-motion project');

    const result = await runBrowserPass({
      root,
      origin: 'https://ridgelineroofing.example',
      context: cleanContext,
      build,
      routes: ['/'],
      projects: [reduced],
    });
    const check = result.reports[0]?.checks.find(
      (row) => row.id === 'motion.reduced-motion-respected',
    );
    expect(check?.mode).toBe('binary');
    expect(check?.passed).toBe(true);
  }, 120_000);

  it('instruments the page, so a render loop is observable at all', async () => {
    // The init script has to land before the page's own scripts. If it does not, the motion
    // sample comes back `instrumented: false` and the reduced-motion loop check errors rather
    // than passing — which is safe, but means the check never actually decides anything.
    const reduced = PROJECTS.find((project) => project.name === 'reduced-motion');
    if (!reduced) throw new Error('the project matrix has no reduced-motion project');

    const result = await runBrowserPass({
      root,
      origin: 'https://ridgelineroofing.example',
      context: cleanContext,
      build,
      routes: ['/'],
      projects: [reduced],
    });

    const loop = result.reports[0]?.checks.find(
      (check) => check.id === 'motion.no-render-loop-under-reduced-motion',
    );
    expect(loop?.mode, 'the probe did not run on a real page').toBe('binary');
    expect(loop?.passed).toBe(true);
  }, 120_000);

  it('exports a failure type rather than a silent fallback to the static subset', () => {
    // The distinction the two-pass split exists for: a browser that will not start is a failed
    // run, not a smaller one.
    const error = new BrowserUnavailableError(new Error('no executable'));
    expect(error.message).toMatch(/This is a failure, not a reason to fall back/);
    expect(error.message).toMatch(/playwright install chromium/);
  });
});
