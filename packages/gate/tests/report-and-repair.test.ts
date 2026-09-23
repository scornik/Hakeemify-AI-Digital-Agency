import { describe, expect, it } from 'vitest';

import { buildReport, mergeReports, summarise } from '../src/report.js';
import { assertRegistryWellFormed, runCheck, runChecks, runGate } from '../src/registry.js';
import { defineCheck, type GateContext } from '../src/context.js';
import {
  buildLhciConfig,
  representativeRoutes,
  AXE_TAGS,
  PROJECTS,
  LHCI_ASSERTIONS,
  GATE_POLICY_VERSION,
} from '../src/policy.js';
import { canPublish, nextRepair, planRepairs, repairKey } from '../src/repair.js';
import type { ArtifactBundle, CheckResult, DomArtifact } from '../src/types.js';

const emptyDom: DomArtifact = {
  route: '/',
  finalUrl: 'https://example.test/',
  statusCode: 200,
  lang: 'en',
  title: 'A title that is exactly long enough to pass the length check',
  metaDescription: null,
  canonical: null,
  robots: null,
  viewport: null,
  og: {},
  twitter: {},
  icons: [],
  themeColor: null,
  jsonLd: [],
  headings: [],
  links: [],
  images: [],
  scripts: [],
  stylesheets: [],
  inlineStyleText: '',
  forms: [],
  landmarks: [],
  sections: [],
  text: '',
  attributeText: '',
  canvasCount: 0,
  webglCanvasCount: 0,
  autoplayMedia: [],
  nodeCount: 10,
  maxDepth: 3,
  emptyInteractiveText: [],
  bytes: 100,
};

const bundle: ArtifactBundle = {
  project: 'desktop-chrome',
  build: {
    siteDefinitionHash: 'deadbeef',
    jsBytesByRoute: { '/': 0 },
    routes: ['/'],
    sitemapRoutes: ['/'],
    robotsTxt: 'Sitemap: https://example.test/sitemap.xml',
    llmsTxt: null,
    allowedHosts: [],
    buildYear: 2026,
  },
  dom: emptyDom,
};

const context = {} as GateContext;

const passing = defineCheck({
  id: 'test.passes',
  title: 'passes',
  failureTitle: 'did not pass',
  description: 'a check that passes',
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [1],
  audit: () => ({ passed: true }),
});

const failing = defineCheck({
  id: 'test.fails',
  title: 'fails',
  failureTitle: 'this failed',
  description: 'a check that fails',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [2],
  audit: () => ({ passed: false, items: [{ target: 's_hero' }] }),
});

const throwing = defineCheck({
  id: 'test.throws',
  title: 'throws',
  failureTitle: 'threw',
  description: 'a check whose implementation is broken',
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [3],
  audit: () => {
    throw new Error('gatherer returned nonsense');
  },
});

const needsBrowser = defineCheck({
  id: 'test.needs-runtime',
  title: 'needs the browser',
  failureTitle: 'could not check',
  description: 'a check that needs a runtime artifact',
  severity: 'critical',
  requiredArtifacts: ['runtime'],
  checklistRows: [4],
  audit: () => ({ passed: true }),
});

const options = { context, policyVersion: GATE_POLICY_VERSION };

describe('the registry', () => {
  it('turns a throwing check into an error row rather than a failure', () => {
    const result = runCheck(throwing, bundle, options);
    expect(result.mode).toBe('error');
    expect(result.message).toBe('gatherer returned nonsense');
    expect(result.passed).toBe(false);
  });

  it('turns a missing artifact into notApplicable, not a pass', () => {
    const result = runCheck(needsBrowser, bundle, options);
    expect(result.mode).toBe('notApplicable');
    expect(result.passed).toBe(false);
    expect(result.weight).toBe(0);
  });

  it('turns a missing artifact into an error when the run policy promised it', () => {
    // A gatherer that silently produced nothing must not shrink the gate to the checks that
    // happened to have data.
    const result = runCheck(needsBrowser, bundle, { ...options, requireArtifacts: ['runtime'] });
    expect(result.mode).toBe('error');
    expect(result.message).toMatch(/promised by the run policy but not gathered/);
  });

  it('uses the failure title on a failing row, so the report reads as problems', () => {
    expect(runCheck(failing, bundle, options).title).toBe('this failed');
    expect(runCheck(passing, bundle, options).title).toBe('passes');
  });

  it('can run a named subset', () => {
    const results = runChecks([passing, failing], bundle, { ...options, only: ['test.fails'] });
    expect(results.map((r) => r.id)).toEqual(['test.fails']);
  });

  it('rejects a malformed registry at boot', () => {
    expect(() => assertRegistryWellFormed([passing, passing])).toThrow(/duplicate/);
    expect(() => assertRegistryWellFormed([{ ...passing, checklistRows: [] }])).toThrow(
      /cites no gate-checklist row/,
    );
  });
});

describe('fail-closed aggregation', () => {
  it('nulls the score when a weighted check errors', () => {
    const report = runGate([passing, throwing], bundle, options);
    expect(report.summary.score).toBeNull();
    expect(report.summary.errored).toBe(1);
    expect(report.canShip).toBe(false);
    expect(report.fatal).toContain('test.throws');
  });

  it('scores normally when nothing errored', () => {
    const report = runGate([passing, failing], bundle, options);
    // critical weighs 10, serious 7: one of eleven... 10 earned of 17 weighted.
    expect(report.summary.score).toBeCloseTo(10 / 17);
    expect(report.fatal).toEqual(['test.fails']);
    expect(report.canShip).toBe(false);
  });

  it('ships only when everything weighted passed', () => {
    const report = runGate([passing], bundle, options);
    expect(report.summary.score).toBe(1);
    expect(report.fatal).toEqual([]);
    expect(report.canShip).toBe(true);
  });

  it('does not let a notApplicable row earn or cost anything', () => {
    const report = runGate([passing, needsBrowser], bundle, options);
    expect(report.summary.score).toBe(1);
    expect(report.summary.notApplicable).toBe(1);
    expect(report.canShip).toBe(true);
  });

  it('blocks shipping on a needs_review row without calling it a failure', () => {
    const rows: CheckResult[] = [
      {
        id: 'a11y.axe-incomplete',
        title: 'axe could not decide',
        mode: 'needs_review',
        passed: false,
        severity: 'serious',
        weight: 7,
        items: [],
      },
    ];
    const report = buildReport({
      policyVersion: GATE_POLICY_VERSION,
      project: 'desktop-chrome',
      route: '/',
      siteDefinitionHash: 'deadbeef',
      checks: rows,
    });
    expect(report.summary.needsReview).toBe(1);
    expect(report.summary.failed).toBe(0);
    expect(report.canShip).toBe(false);
  });

  it('reports no score at all when nothing was weighted', () => {
    expect(summarise([]).score).toBeNull();
  });

  it('merges per-page reports so a site ships only if every page does', () => {
    const green = runGate([passing], bundle, options);
    const red = runGate([passing, failing], bundle, options);
    expect(mergeReports([green]).canShip).toBe(true);
    expect(mergeReports([green, red]).canShip).toBe(false);
    expect(mergeReports([green, red]).fatal).toEqual([
      { route: '/', project: 'desktop-chrome', checkId: 'test.fails' },
    ]);
    expect(mergeReports([]).canShip).toBe(false);
  });
});

describe('gate policy', () => {
  it('runs the full axe tag set, not Lighthouse’s subset', () => {
    expect(AXE_TAGS).toEqual([
      'wcag2a',
      'wcag2aa',
      'wcag21a',
      'wcag21aa',
      'wcag22aa',
      'best-practice',
    ]);
  });

  it('has a project for reduced motion and one for dark, because nothing honours either by default', () => {
    const names = PROJECTS.map((project) => project.name);
    expect(names).toContain('reduced-motion');
    expect(names).toContain('dark');
    expect(PROJECTS.find((p) => p.name === 'reduced-motion')?.reducedMotion).toBe('reduce');
  });

  it('gates hard on resource summaries and only warns on timing', () => {
    expect(LHCI_ASSERTIONS['resource-summary:script:size']?.level).toBe('error');
    expect(LHCI_ASSERTIONS['non-composited-animations']?.level).toBe('error');
    expect(LHCI_ASSERTIONS['largest-contentful-paint']?.level).toBe('warn');
    expect(LHCI_ASSERTIONS['total-blocking-time']?.level).toBe('warn');
  });

  it('never gates on the performance category score', () => {
    expect(Object.keys(LHCI_ASSERTIONS).some((id) => id.startsWith('categories'))).toBe(false);
  });

  it('emits an LHCI config with three runs and median-run aggregation on timing', () => {
    const config = buildLhciConfig(['https://example.test/']);
    expect(config.ci.collect.numberOfRuns).toBe(3);
    expect(config.ci.assert.assertions['largest-contentful-paint']).toEqual([
      'warn',
      { maxNumericValue: 2500, aggregationMethod: 'median-run' },
    ]);
    expect(config.ci.assert.assertions['resource-summary:script:size']).toEqual([
      'error',
      { maxNumericValue: 184320 },
    ]);
  });

  it('samples one representative per archetype and arrangement group, deterministically', () => {
    const routes = representativeRoutes([
      { route: '/b', archetype: 'service_clarity', arrangementSignature: 'x' },
      { route: '/a', archetype: 'service_clarity', arrangementSignature: 'x' },
      { route: '/c', archetype: 'authority', arrangementSignature: 'y' },
    ]);
    expect(routes).toEqual(['/a', '/c']);
    // Deterministic, unlike Unlighthouse's random sampling: the same input always samples the
    // same page, so a report is reproducible.
    expect(
      representativeRoutes([
        { route: '/a', archetype: 'service_clarity', arrangementSignature: 'x' },
        { route: '/b', archetype: 'service_clarity', arrangementSignature: 'x' },
        { route: '/c', archetype: 'authority', arrangementSignature: 'y' },
      ]),
    ).toEqual(routes);
  });
});

describe('the repair loop', () => {
  const reportWith = (checks: CheckResult[]) =>
    buildReport({
      policyVersion: GATE_POLICY_VERSION,
      project: 'desktop-chrome',
      route: '/',
      siteDefinitionHash: 'deadbeef',
      checks,
    });

  const row = (id: string, severity: CheckResult['severity'] = 'serious'): CheckResult => ({
    id,
    title: id,
    mode: 'binary',
    passed: false,
    severity,
    weight: 7,
    items: [{ target: 's_hero' }],
    message: `${id} failed`,
  });

  it('plans substitution for a layout failure and regeneration for a copy failure', () => {
    const plans = planRepairs(
      reportWith([row('structure.sd-path-present'), row('content.placeholder-scan')]),
    );
    expect(plans.map((plan) => plan.strategy)).toEqual(['substitute', 'regenerate_copy']);
    expect(plans[0]?.sdId).toBe('s_hero');
  });

  it('plans failure, never relaxation, for a check substitution cannot fix', () => {
    const plans = planRepairs(reportWith([row('perf.js-budget-per-page', 'critical')]));
    expect(plans[0]?.strategy).toBe('fail');
  });

  it('stops immediately when the gate is green', () => {
    const green = runGate([passing], bundle, options);
    expect(nextRepair(green, { attempts: 0, applied: [] })).toEqual({
      kind: 'stop',
      reason: 'the gate is green',
    });
  });

  it('treats a report where nothing ran as not green, rather than as nothing to fix', () => {
    // An empty report has no score, and no score is not a good score.
    const empty = reportWith([]);
    expect(empty.canShip).toBe(false);
    expect(nextRepair(empty, { attempts: 0, applied: [] })).toMatchObject({ kind: 'stop' });
  });

  it('applies the first repairable failure', () => {
    const decision = nextRepair(reportWith([row('structure.section-count')]), {
      attempts: 0,
      applied: [],
    });
    expect(decision.kind).toBe('apply');
  });

  it('stops rather than repeating a repair that already did not help', () => {
    const report = reportWith([row('structure.section-count')]);
    const action = planRepairs(report)[0];
    if (!action) throw new Error('expected a plan');
    const decision = nextRepair(report, { attempts: 1, applied: [repairKey(action)] });
    expect(decision).toMatchObject({ kind: 'stop' });
    expect(decision.kind === 'stop' && decision.reason).toMatch(/already applied and did not help/);
  });

  it('stops when the attempt budget is spent', () => {
    const decision = nextRepair(reportWith([row('structure.section-count')]), {
      attempts: 4,
      applied: [],
    });
    expect(decision).toMatchObject({ kind: 'stop', reason: /budget spent/ });
  });

  it('stops on an unrepairable failure rather than working around it', () => {
    const decision = nextRepair(reportWith([row('bp.no-external-script-unlisted', 'critical')]), {
      attempts: 0,
      applied: [],
    });
    expect(decision).toMatchObject({ kind: 'stop', reason: /not repairable by substitution/ });
  });
});

describe('the done gate', () => {
  const greenReport = runGate([passing], bundle, options);

  it('allows publishing when the report is green and the hash matches', () => {
    expect(canPublish({ report: greenReport, currentSiteDefinitionHash: 'deadbeef' })).toEqual({
      allowed: true,
    });
  });

  it('refuses when the definition changed after the report was produced', () => {
    const result = canPublish({ report: greenReport, currentSiteDefinitionHash: 'cafebabe' });
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/changed after the green report/);
  });

  it('refuses when the report is not green, whatever the hash says', () => {
    const red = runGate([passing, failing], bundle, options);
    expect(canPublish({ report: red, currentSiteDefinitionHash: 'deadbeef' }).allowed).toBe(false);
  });
});
