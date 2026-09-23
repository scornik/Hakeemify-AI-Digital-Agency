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
  runStaticGate,
  summariseResult,
  type ExpectedPage,
  type GateContext,
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
  readonly gate: SiteGateResult;
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
  options: { runId?: string } = {},
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
  ) as { js_bytes_by_route: Record<string, number> };

  const gate = runStaticGate({
    site: {
      root: outDir,
      origin: FIXTURE_ORIGIN,
      siteDefinitionHash: result.siteDefinitionHash,
      jsBytesByRoute: buildManifest.js_bytes_by_route,
      allowedHosts: [],
      buildYear: new Date().getFullYear(),
    },
    context: gateContextFor(result),
    policyVersion: GATE_POLICY_VERSION,
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
        canShip: gate.canShip,
        fatal: gate.fatal,
        needsReview: gate.needsReview,
        reports: gate.reports,
      },
      null,
      2,
    ),
    'utf8',
  );

  return { result, gate, outDir, artifactsDir };
}

export function reportLines(artifacts: FixtureArtifacts): string[] {
  const { result, gate } = artifacts;
  return [
    `site definition hash  ${result.siteDefinitionHash.slice(0, 16)}`,
    `sections              ${result.sections.map((s) => s.variant.id).join(', ')}`,
    `model calls           ${result.state.model_calls.length}, $${result.state.cost_usd.toFixed(4)}`,
    `ruled out             ${result.manifest.decisions.flatMap((d) => d.ruled_out).length} row(s)`,
    `gap report            ${result.gapReport.unlocks.length} unlock(s)`,
    summariseResult(gate),
  ];
}

export { dirname };
