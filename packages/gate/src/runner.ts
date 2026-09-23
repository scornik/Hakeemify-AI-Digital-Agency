/**
 * The gate runner: build output in, `GateReport` per (page × project) out.
 *
 * Two passes, in the order that makes the cost bearable (Unlighthouse's cheap-then-expensive
 * ordering, applied to checks rather than routes):
 *
 * 1. **Static.** Every page, no browser, ~30 checks. Seconds for a whole site.
 * 2. **Browser.** The project matrix, axe with the full tag set, and the runtime artifacts.
 *
 * The second pass is a separate entry point on purpose. A run that promises browser artifacts
 * and cannot produce them must **error**, not quietly fall back to the static subset — that is
 * what `requireArtifacts` is for, and why the two passes are not one function with a flag.
 */
import { ALL_CHECKS, STATIC_CHECKS } from './checks/index.js';
import { loadSite, type SiteLoadOptions } from './artifacts/fixture-site.js';
import { runGate } from './registry.js';
import { mergeReports, type GateReport } from './report.js';
import { GATE_POLICY_VERSION, PROJECTS, type ProjectDefinition } from './policy.js';
import type { GateContext } from './context.js';
import type { ArtifactBundle } from './types.js';

export interface StaticRunOptions {
  readonly site: SiteLoadOptions;
  readonly context: GateContext;
  readonly policyVersion?: string;
  readonly now?: Date;
}

export interface SiteGateResult {
  readonly reports: readonly GateReport[];
  readonly canShip: boolean;
  readonly fatal: readonly { route: string; project: string; checkId: string }[];
  readonly needsReview: readonly { route: string; project: string; checkId: string }[];
}

/** Pass 1. Deterministic, browserless, runs on every page of every build. */
export function runStaticGate(options: StaticRunOptions): SiteGateResult {
  const bundles = loadSite({ ...options.site, project: options.site.project ?? 'static' });
  const reports = bundles.map((bundle) =>
    runGate(STATIC_CHECKS, bundle, {
      context: options.context,
      policyVersion: options.policyVersion ?? GATE_POLICY_VERSION,
      ...(options.now === undefined ? {} : { now: options.now }),
    }),
  );
  return { reports, ...mergeReports(reports) };
}

export interface BrowserRunOptions {
  readonly bundles: readonly ArtifactBundle[];
  readonly context: GateContext;
  readonly projects?: readonly ProjectDefinition[];
  readonly policyVersion?: string;
}

/**
 * Pass 2. Each bundle must already carry the artifacts its project promised; the registry turns
 * a promised-but-missing artifact into an `error`, which nulls the report.
 */
export function runBrowserGate(options: BrowserRunOptions): SiteGateResult {
  const projects = options.projects ?? PROJECTS;
  const byName = new Map(projects.map((project) => [project.name, project]));

  const reports = options.bundles.map((bundle) => {
    const project = byName.get(bundle.project);
    return runGate(ALL_CHECKS, bundle, {
      context: options.context,
      policyVersion: options.policyVersion ?? GATE_POLICY_VERSION,
      // The project's declared artifacts are a promise. Not producing one is a gatherer failure,
      // not a reason to skip the check.
      requireArtifacts: project?.artifacts ?? [],
    });
  });

  return { reports, ...mergeReports(reports) };
}

/** A one-line summary for a terminal, ordered worst first. */
export function summariseResult(result: SiteGateResult): string {
  if (result.canShip) {
    return `gate green — ${result.reports.length} page/project report(s), no fatal rows`;
  }
  const lines = [
    `gate red — ${result.fatal.length} fatal row(s), ${result.needsReview.length} awaiting review`,
  ];
  for (const row of result.fatal) {
    lines.push(`  fatal   ${row.project} ${row.route}  ${row.checkId}`);
  }
  for (const row of result.needsReview) {
    lines.push(`  review  ${row.project} ${row.route}  ${row.checkId}`);
  }
  return lines.join('\n');
}
