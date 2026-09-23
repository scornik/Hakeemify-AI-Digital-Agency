/**
 * The gate report and its aggregation (ARCHITECTURE §7.6).
 *
 * "GateReport rows; null on any errored weighted check ⇒ fail closed."
 *
 * The rule that matters: a check that *could not run* is not a check that passed. Averaging
 * over the checks that happened to work is how a gate quietly stops being a gate, so a weighted
 * error nulls the score outright and `canShip` is false. `manual`, `informative` and
 * `notApplicable` carry weight 0 and are excluded from the mean, exactly as Lighthouse does;
 * `needs_review` carries its weight but blocks shipping until a reviewer signs it off.
 */
import type { CheckResult, GateCheck, ScoreDisplayMode } from './types.js';
import { SEVERITY_WEIGHT } from './types.js';

export interface GateReportSummary {
  /** 0..1, or **null** when any weighted check errored. Null is not a bad score; it is no score. */
  readonly score: number | null;
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly errored: number;
  readonly needsReview: number;
  readonly manual: number;
  readonly notApplicable: number;
  readonly informative: number;
}

export interface GateReport {
  readonly policyVersion: string;
  readonly project: string;
  readonly route: string;
  readonly siteDefinitionHash: string;
  readonly generatedAt: string;
  readonly checks: readonly CheckResult[];
  readonly summary: GateReportSummary;
  /** Fatal rows: a failing check with weight, or an errored weighted check. */
  readonly fatal: readonly string[];
  /** True only when nothing fatal, nothing errored, and nothing awaits a reviewer. */
  readonly canShip: boolean;
}

/** Modes that take part in the score. Everything else is excluded from the mean. */
const SCORED_MODES: readonly ScoreDisplayMode[] = ['binary', 'numeric', 'needs_review'];

/**
 * Modes that carry the check's weight. `error` is included deliberately: weight is what makes a
 * check matter, and the fail-closed rule is "a *weighted* check errored". Zeroing the weight of
 * an errored check would make that rule unreachable — a gate that silently stops gating as soon
 * as a gatherer breaks.
 */
const WEIGHT_BEARING_MODES: readonly ScoreDisplayMode[] = [...SCORED_MODES, 'error'];

export function isScored(mode: ScoreDisplayMode): boolean {
  return SCORED_MODES.includes(mode);
}

export function weightFor(check: GateCheck, mode: ScoreDisplayMode): number {
  return WEIGHT_BEARING_MODES.includes(mode) ? SEVERITY_WEIGHT[check.severity] : 0;
}

export function summarise(checks: readonly CheckResult[]): GateReportSummary {
  let weighted = 0;
  let earned = 0;
  let passed = 0;
  let failed = 0;
  let errored = 0;
  let needsReview = 0;
  let manual = 0;
  let notApplicable = 0;
  let informative = 0;

  for (const check of checks) {
    switch (check.mode) {
      case 'error':
        errored += 1;
        break;
      case 'manual':
        manual += 1;
        break;
      case 'notApplicable':
        notApplicable += 1;
        break;
      case 'informative':
        informative += 1;
        break;
      case 'needs_review':
        needsReview += 1;
        break;
      case 'binary':
      case 'numeric':
        if (check.passed) passed += 1;
        else failed += 1;
        break;
    }

    if (!isScored(check.mode)) continue;
    weighted += check.weight;
    if (check.passed) earned += check.weight;
  }

  // A weighted check that errored means the gate does not know. Report no score rather than a
  // score computed over the subset that happened to run.
  const anyWeightedError = checks.some((c) => c.mode === 'error' && c.weight > 0);
  const score = anyWeightedError || weighted === 0 ? null : earned / weighted;

  return {
    score: anyWeightedError ? null : score,
    total: checks.length,
    passed,
    failed,
    errored,
    needsReview,
    manual,
    notApplicable,
    informative,
  };
}

export function buildReport(input: {
  policyVersion: string;
  project: string;
  route: string;
  siteDefinitionHash: string;
  checks: readonly CheckResult[];
  now?: Date;
}): GateReport {
  const summary = summarise(input.checks);

  const fatal = input.checks
    .filter(
      (check) =>
        (check.mode === 'binary' || check.mode === 'numeric') && !check.passed && check.weight > 0,
    )
    .map((check) => check.id);

  const erroredWeighted = input.checks
    .filter((check) => check.mode === 'error' && check.weight > 0)
    .map((check) => check.id);

  const allFatal = [...fatal, ...erroredWeighted];

  return {
    policyVersion: input.policyVersion,
    project: input.project,
    route: input.route,
    siteDefinitionHash: input.siteDefinitionHash,
    generatedAt: (input.now ?? new Date()).toISOString(),
    checks: input.checks,
    summary,
    fatal: allFatal,
    canShip: allFatal.length === 0 && summary.needsReview === 0 && summary.score !== null,
  };
}

/** Merge per-page reports into one site-level verdict. A site ships only if every page does. */
export function mergeReports(reports: readonly GateReport[]): {
  canShip: boolean;
  fatal: { route: string; project: string; checkId: string }[];
  needsReview: { route: string; project: string; checkId: string }[];
} {
  const fatal: { route: string; project: string; checkId: string }[] = [];
  const needsReview: { route: string; project: string; checkId: string }[] = [];

  for (const report of reports) {
    for (const checkId of report.fatal) {
      fatal.push({ route: report.route, project: report.project, checkId });
    }
    for (const check of report.checks) {
      if (check.mode === 'needs_review') {
        needsReview.push({ route: report.route, project: report.project, checkId: check.id });
      }
    }
  }

  return {
    canShip: reports.length > 0 && reports.every((r) => r.canShip),
    fatal,
    needsReview,
  };
}
