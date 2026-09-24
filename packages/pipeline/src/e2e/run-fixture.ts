/**
 * The end-to-end fixture build (P6).
 *
 * One committed business, through all sixteen stages, to a green gate, emitting the three
 * documents the system exists to produce. Every model call goes through the deterministic fake:
 * a pipeline whose output depends on a model's mood cannot claim reproducibility, and
 * reproducibility is one of the things being built — the last assertion here is that the same
 * seed produces the same `SiteDefinition` hash.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadManifests, LIBRARY_ROOT } from '@ada/library';
import {
  GATE_POLICY_VERSION,
  JS_BUDGET_BYTES,
  representativeRoutes,
  runBrowserPass,
  writeDeployConfig,
  runLighthousePass,
  runStaticGate,
  summariseLighthouse,
  summariseResult,
  type ExpectedPage,
  type GateContext,
  type DeployTarget,
  type LighthousePassResult,
  type SiteGateResult,
} from '@ada/gate';

import { runBuild, type BuildResult, type SlotPlan } from '../build.js';
import { toVariantViews } from '../library-adapter.js';
import { obedientProvider } from '../model/fake.js';
import type { LibraryView } from '../library-view.js';
import {
  ARCHETYPES,
  ART_DIRECTIONS,
  DESIGN_SYSTEMS,
  PLAYBOOKS,
  POSITIONS,
} from './fixture-assets.js';
import {
  FIXTURE_ASSETS,
  FIXTURE_LEGAL,
  FIXTURE_ORIGIN,
  FIXTURE_REGISTRY,
  FIXTURE_SEO,
  fixtureFacts,
} from './fixture-business.js';

export const FIXTURE_SEED = 20260923;

/**
 * What each scaffold slot binds to. Copy is written here rather than generated, because the
 * fixture's job is to exercise the pipeline, not to test a model — and every string below is
 * held to the same `grounded_in` leash the real thing is.
 */
export function fixtureSlotPlanner(input: { variant: { id: string } }): readonly SlotPlan[] {
  switch (input.variant.id) {
    case 'hero/service_statement':
      return [
        {
          slot: 'headline',
          kind: 'generated',
          text: 'Roofing for the three valleys, since 1998',
          grounded_in: ['f_founded'],
        },
        {
          slot: 'standfirst',
          kind: 'generated',
          text: 'Replacement, storm repair and gutter renewal, by the same crew every time.',
          grounded_in: [],
        },
        { slot: 'media', kind: 'asset', asset_id: 'crew_on_ridge' },
      ];
    case 'services/plain_list':
      return [
        { slot: 'heading', kind: 'generated', text: 'What we do', grounded_in: [] },
        { slot: 'services', kind: 'fact', fact_id: 'f_services' },
      ];
    case 'proof/credential_bar':
      return [
        { slot: 'heading', kind: 'generated', text: 'Insured and accredited', grounded_in: [] },
        { slot: 'credentials', kind: 'fact', fact_id: 'f_credentials' },
      ];
    case 'faq/native_disclosure':
      return [
        { slot: 'heading', kind: 'generated', text: 'Before you ask for a quote', grounded_in: [] },
        { slot: 'questions', kind: 'fact', fact_id: 'f_faq' },
      ];
    case 'cta/direct_contact':
      return [
        { slot: 'heading', kind: 'generated', text: 'Ask for an estimate', grounded_in: [] },
        { slot: 'promise', kind: 'fact', fact_id: 'f_response' },
        { slot: 'phone', kind: 'fact', fact_id: 'f_phone' },
        { slot: 'email', kind: 'fact', fact_id: 'f_email' },
      ];
    default:
      throw new Error(`the fixture has no slot plan for ${input.variant.id}`);
  }
}

/** The authored library, plus the fixture-only archetypes, positions and playbook. */
export function fixtureLibraryView(): LibraryView {
  const manifests = loadManifests().map(({ manifest }) => manifest);
  return {
    commit: 'a7f31c2',
    variants: toVariantViews(manifests),
    archetypes: ARCHETYPES,
    designSystems: DESIGN_SYSTEMS,
    artDirections: ART_DIRECTIONS,
    positions: POSITIONS,
    playbooks: PLAYBOOKS,
  };
}

export async function buildFixtureSite(runId = 'b_fixture'): Promise<BuildResult> {
  return runBuild({
    runId,
    siteId: 'ridgeline_roofing',
    tenantId: 'ada_demo',
    niche: 'roofing',
    locale: 'en-GB',
    origin: FIXTURE_ORIGIN,
    seed: FIXTURE_SEED,
    // Owner-declared. The pipeline interrupts rather than inferring it; the fixture answers.
    positioning: 'local_trust',
    registry: FIXTURE_REGISTRY,
    library: fixtureLibraryView(),
    provider: obedientProvider('fixture'),
    slotPlanner: fixtureSlotPlanner,
    seo: FIXTURE_SEO,
    assets: FIXTURE_ASSETS,
    legal: FIXTURE_LEGAL,
    // Scaffolds exist so this is possible; a client build would find nothing eligible and stop.
    allowScaffold: true,
  });
}

export interface FixtureArtifacts {
  readonly result: BuildResult;
  /** Pass 1: every page, no browser. */
  readonly gate: SiteGateResult;
  /** Pass 2: the project matrix in a real browser. Absent only when explicitly skipped. */
  readonly browserGate?: SiteGateResult;
  /** Pass 3: the resource budgets, on the median of three Lighthouse runs. */
  readonly lighthouse?: LighthousePassResult;
  readonly outDir: string;
  readonly artifactsDir: string;
}

/** Everything the gate needs to compare what shipped against what was decided. */
export function gateContextFor(result: BuildResult): GateContext {
  const facts = fixtureFacts();
  const definition = result.siteDefinition as {
    pages: Record<
      string,
      {
        route: string;
        archetype: string;
        order: string[];
        sections: Record<string, { variant_id: string; arrangement_id: string; family: string }>;
      }
    >;
  };

  const pages: ExpectedPage[] = Object.entries(definition.pages).map(([pageId, page]) => ({
    route: page.route,
    archetype: page.archetype,
    title: FIXTURE_SEO.title,
    description: FIXTURE_SEO.description,
    canonical: FIXTURE_SEO.canonical,
    indexable: true,
    sections: page.order.map((instanceId) => {
      const section = page.sections[instanceId];
      return {
        sdId: instanceId,
        sdPath: `pages.${pageId}.sections.${instanceId}`,
        variantId: section?.variant_id ?? '',
        arrangementId: section?.arrangement_id ?? '',
        family: section?.family ?? '',
      };
    }),
    minSections: 5,
    maxSections: 9,
    lcpSdId: 's_hook',
  }));

  const quotableFacts = Object.values(facts)
    .filter((fact) => fact.quotable)
    .map((fact) => ({ id: fact.id, path: fact.id, text: renderFactText(fact.value) }));

  return {
    origin: FIXTURE_ORIGIN,
    pages,
    // The build year is grounded in the build, not the registry, and the footer prints it.
    quotableFacts: [
      ...quotableFacts,
      { id: 'f_build_year', path: 'build.year', text: String(new Date().getFullYear()) },
    ],
    businessName: 'Ridgeline Roofing Ltd',
    contact: { phone: '01632 960144', email: 'office@ridgelineroofing.example' },
    artDirectionGradeId: 'warm_lift',
    jsBudgetBytes: JS_BUDGET_BYTES,
    allowedHosts: [],
    legalRoutes: [],
    buildYear: new Date().getFullYear(),
    consentRequired: false,
  };
}

function renderFactText(value: unknown, depth = 0): string {
  if (value === null || value === undefined || depth > 5) return '';
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>)
      .map((child) => renderFactText(child, depth + 1))
      .join(' ');
  }
  return String(value);
}

/**
 * Build, render, gate, and write the artifacts. Returns rather than exits, so the test and the
 * CLI can both assert on the same result.
 */
export async function runFixtureEndToEnd(
  options: {
    runId?: string;
    browser?: boolean;
    lighthouse?: boolean;
    deployTarget?: DeployTarget;
  } = {},
): Promise<FixtureArtifacts> {
  const result = await buildFixtureSite(options.runId ?? 'b_fixture');

  const artifactsDir = join(LIBRARY_ROOT, '..', '..', 'artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  const definitionPath = join(artifactsDir, 'site-definition.json');
  const factsPath = join(artifactsDir, 'facts.json');
  writeFileSync(definitionPath, JSON.stringify(result.siteDefinition, null, 2), 'utf8');
  writeFileSync(factsPath, JSON.stringify(fixtureFacts(), null, 2), 'utf8');

  // ---- 12. render --------------------------------------------------------------------------
  const outDir = join(LIBRARY_ROOT, 'dist-e2e');
  execFileSync(
    process.execPath,
    [
      join(LIBRARY_ROOT, 'scripts', 'build-site.mjs'),
      `--definition=${definitionPath}`,
      `--facts=${factsPath}`,
      `--out=${outDir}`,
    ],
    { cwd: LIBRARY_ROOT, stdio: 'inherit' },
  );

  // ---- 13. gate ----------------------------------------------------------------------------
  const buildManifest = JSON.parse(
    readFileSync(join(outDir, '_ada', 'build-manifest.json'), 'utf8'),
  ) as { js_bytes_by_route: Record<string, number>; routes: string[] };

  // ---- 12b. the deploy config ----------------------------------------------------------------
  // Emitted here rather than in the renderer: the renderer produces a host-agnostic static
  // directory, and which host it lands on is a build decision, not a rendering one. Making
  // @ada/library depend on @ada/gate to write a header file would also drag the gate's
  // dependencies into the closure shipped to a client.
  //
  // Vercel for the fixture. Like the roofing niche, that is fixture data and not a product
  // choice — all three adapters are covered by @ada/gate's unit tests.
  const deployTarget: DeployTarget = options.deployTarget ?? 'vercel';
  writeDeployConfig(outDir, {
    target: deployTarget,
    allowedHosts: [],
    shipsJavaScript: Object.values(buildManifest.js_bytes_by_route).some((bytes) => bytes > 0),
  });

  const gate = runStaticGate({
    site: {
      root: outDir,
      origin: FIXTURE_ORIGIN,
      siteDefinitionHash: result.siteDefinitionHash,
      jsBytesByRoute: buildManifest.js_bytes_by_route,
      allowedHosts: [],
      buildYear: new Date().getFullYear(),
      deployTarget,
    },
    context: gateContextFor(result),
    policyVersion: GATE_POLICY_VERSION,
  });

  // ---- 13b. the browser pass ---------------------------------------------------------------
  // The static pass decided everything the build output can decide. This is the rest: axe with
  // the full tag set, computed focus states, tab order, the LCP element, the network log, and an
  // actual count of animations running under `prefers-reduced-motion: reduce`.
  //
  // It is not optional and it is not skipped on failure. `options.browser: false` exists for the
  // unit suite, which must not require a browser binary to typecheck the package.
  const browserGate =
    options.browser === false
      ? undefined
      : await runBrowserPass({
          root: outDir,
          origin: FIXTURE_ORIGIN,
          context: gateContextFor(result),
          build: {
            siteDefinitionHash: result.siteDefinitionHash,
            jsBytesByRoute: buildManifest.js_bytes_by_route,
            sitemapRoutes: [
              ...readFileSync(join(outDir, 'sitemap.xml'), 'utf8').matchAll(
                /<loc>\s*([^<\s]+)\s*<\/loc>/g,
              ),
            ].map((match) => new URL(match[1] as string).pathname),
            robotsTxt: readFileSync(join(outDir, 'robots.txt'), 'utf8'),
            llmsTxt: null,
            allowedHosts: [],
            buildYear: new Date().getFullYear(),
          },
          routes: buildManifest.routes,
          policyVersion: GATE_POLICY_VERSION,
        });

  // ---- 13c. the resource budgets -----------------------------------------------------------
  // Only one page per (archetype × arrangement signature) gets the expensive pass: two pages
  // built from the same sections cannot disagree about their script budget. What is asserted is
  // the deterministic half of the policy — sizes, counts, unsized images, render-blocking
  // resources — on the median of three runs. Timing rows warn and never fail a build alone.
  const lighthouse =
    options.lighthouse === false
      ? undefined
      : await runLighthousePass({
          root: outDir,
          routes: representativeRoutes(
            gateContextFor(result).pages.map((page) => ({
              route: page.route,
              archetype: page.archetype,
              arrangementSignature: page.sections
                .map((section) => `${section.variantId}@${section.arrangementId}`)
                .join('+'),
            })),
          ),
        });

  // ---- 14-15. the two client-facing documents ----------------------------------------------
  writeFileSync(
    join(artifactsDir, 'build-rationale.json'),
    JSON.stringify(result.manifest, null, 2),
    'utf8',
  );
  writeFileSync(
    join(artifactsDir, 'gap-report.json'),
    JSON.stringify(result.gapReport, null, 2),
    'utf8',
  );
  writeFileSync(
    join(artifactsDir, 'gate-report.json'),
    JSON.stringify(
      {
        static: {
          canShip: gate.canShip,
          fatal: gate.fatal,
          needsReview: gate.needsReview,
          reports: gate.reports,
        },
        browser: browserGate
          ? {
              canShip: browserGate.canShip,
              fatal: browserGate.fatal,
              needsReview: browserGate.needsReview,
              reports: browserGate.reports,
            }
          : null,
        lighthouse: lighthouse
          ? {
              canShip: lighthouse.canShip,
              // The median LHRs are deliberately not written here: they are ~2 MB each and the
              // budget rows say everything a reader needs. Re-run the pass to see them.
              assertions: lighthouse.assertions,
            }
          : null,
      },
      null,
      2,
    ),
    'utf8',
  );

  return {
    result,
    gate,
    ...(browserGate === undefined ? {} : { browserGate }),
    ...(lighthouse === undefined ? {} : { lighthouse }),
    outDir,
    artifactsDir,
  };
}

/**
 * The build ships only if every pass is green. Kept here rather than in the CLI so the test and
 * `pnpm e2e:fixture` cannot disagree about what "green" means.
 */
export function canShip(artifacts: FixtureArtifacts): boolean {
  return (
    artifacts.gate.canShip &&
    (artifacts.browserGate?.canShip ?? true) &&
    (artifacts.lighthouse?.canShip ?? true)
  );
}

export function reportLines(artifacts: FixtureArtifacts): string[] {
  const { result, gate, browserGate, lighthouse } = artifacts;
  return [
    `site definition hash  ${result.siteDefinitionHash.slice(0, 16)}`,
    `sections              ${result.sections.map((s) => s.variant.id).join(', ')}`,
    `model calls           ${result.state.model_calls.length}, $${result.state.cost_usd.toFixed(4)}`,
    `ruled out             ${result.manifest.decisions.flatMap((d) => d.ruled_out).length} row(s)`,
    `gap report            ${result.gapReport.unlocks.length} unlock(s)`,
    `static pass           ${summariseResult(gate)}`,
    browserGate
      ? `browser pass          ${summariseResult(browserGate)}`
      : 'browser pass          skipped',
    lighthouse
      ? `budget pass           ${summariseLighthouse(lighthouse)}`
      : 'budget pass           skipped',
  ];
}

export { dirname };
