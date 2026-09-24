/**
 * The check registry: the one place that decides how a check's outcome becomes a report row.
 *
 * Two rules live here rather than in each check, so no individual check can get them wrong:
 *
 * 1. **A missing required artifact is `notApplicable`, not a pass.** A check that needs the
 *    network log and did not get one has not verified anything.
 * 2. **A throwing check is `error`, not a failure.** The distinction matters because a weighted
 *    error nulls the report, whereas a failure is just a failure.
 *
 * Whether a missing artifact is acceptable at all is a policy question, answered by
 * `requireArtifacts` on the run options: a launch-grade run declares the artifacts it expects,
 * and a check whose required artifact is missing then errors instead of excusing itself.
 */
import type {
  ArtifactBundle,
  ArtifactName,
  CheckResult,
  GateCheck,
  ScoreDisplayMode,
} from './types.js';
import { SEVERITY_WEIGHT } from './types.js';
import { buildReport, weightFor, type GateReport } from './report.js';

export interface RunOptions<TContext> {
  readonly context: TContext;
  readonly policyVersion: string;
  /**
   * Artifacts this run promises to provide. A check requiring one of these that finds it
   * missing is an `error`, not `notApplicable` — the gatherer failed, and the gate must not
   * quietly shrink to the checks that happened to have data.
   */
  readonly requireArtifacts?: readonly ArtifactName[];
  readonly only?: readonly string[];
  readonly now?: Date;
}

function artifactPresent(bundle: ArtifactBundle, name: ArtifactName): boolean {
  switch (name) {
    case 'build':
      return bundle.build !== undefined;
    case 'dom':
      return bundle.dom !== undefined;
    case 'axe':
      return bundle.axe !== undefined;
    case 'console':
      return bundle.console !== undefined;
    case 'network':
      return bundle.network !== undefined;
    case 'runtime':
      return bundle.runtime !== undefined;
    case 'lighthouse':
      return bundle.lighthouse !== undefined;
    case 'screenshots':
      return bundle.screenshots !== undefined;
    case 'deploy':
      return bundle.deploy !== undefined;
  }
}

function resultFrom(
  check: GateCheck<never>,
  mode: ScoreDisplayMode,
  partial: Partial<CheckResult>,
): CheckResult {
  return {
    id: check.id,
    title: partial.passed === false ? check.failureTitle : check.title,
    mode,
    passed: partial.passed ?? false,
    severity: check.severity,
    weight: weightFor(check as GateCheck, mode),
    items: partial.items ?? [],
    ...(partial.message === undefined ? {} : { message: partial.message }),
    ...(partial.value === undefined ? {} : { value: partial.value }),
  };
}

export function runCheck<TContext>(
  check: GateCheck<TContext>,
  bundle: ArtifactBundle,
  options: RunOptions<TContext>,
): CheckResult {
  const promised = new Set(options.requireArtifacts ?? []);
  const missing = check.requiredArtifacts.filter((name) => !artifactPresent(bundle, name));

  if (missing.length > 0) {
    const promisedButMissing = missing.filter((name) => promised.has(name));
    if (promisedButMissing.length > 0) {
      return resultFrom(check as unknown as GateCheck<never>, 'error', {
        passed: false,
        message: `required artifact(s) ${promisedButMissing.join(', ')} were promised by the run policy but not gathered`,
        items: promisedButMissing.map((name) => ({ detail: `missing artifact: ${name}` })),
      });
    }
    return resultFrom(check as unknown as GateCheck<never>, 'notApplicable', {
      passed: false,
      message: `not run: ${missing.join(', ')} not gathered for this project`,
    });
  }

  try {
    const outcome = check.audit(bundle, options.context);
    const mode: ScoreDisplayMode = outcome.mode ?? 'binary';
    return resultFrom(check as unknown as GateCheck<never>, mode, {
      passed: outcome.passed,
      ...(outcome.items === undefined ? {} : { items: outcome.items }),
      ...(outcome.message === undefined ? {} : { message: outcome.message }),
      ...(outcome.value === undefined ? {} : { value: outcome.value }),
    });
  } catch (error) {
    return resultFrom(check as unknown as GateCheck<never>, 'error', {
      passed: false,
      message: error instanceof Error ? error.message : 'check threw a non-Error value',
    });
  }
}

export function runChecks<TContext>(
  checks: readonly GateCheck<TContext>[],
  bundle: ArtifactBundle,
  options: RunOptions<TContext>,
): CheckResult[] {
  const selected = options.only
    ? checks.filter((check) => options.only?.includes(check.id))
    : checks;
  return selected.map((check) => runCheck(check, bundle, options));
}

export function runGate<TContext>(
  checks: readonly GateCheck<TContext>[],
  bundle: ArtifactBundle,
  options: RunOptions<TContext>,
): GateReport {
  const results = runChecks(checks, bundle, options);
  return buildReport({
    policyVersion: options.policyVersion,
    project: bundle.project,
    route: bundle.dom.route,
    siteDefinitionHash: bundle.build.siteDefinitionHash,
    checks: results,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

/** Ids must be unique and every check must cite the checklist row it implements. */
export function assertRegistryWellFormed(checks: readonly GateCheck<never>[]): void {
  const seen = new Set<string>();
  for (const check of checks) {
    if (seen.has(check.id)) {
      throw new Error(`duplicate gate check id: ${check.id}`);
    }
    seen.add(check.id);
    if (check.checklistRows.length === 0) {
      throw new Error(`check ${check.id} cites no gate-checklist row`);
    }
    if (!(check.severity in SEVERITY_WEIGHT)) {
      throw new Error(`check ${check.id} has an unknown severity`);
    }
  }
}
