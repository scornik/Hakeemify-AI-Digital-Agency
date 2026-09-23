/**
 * The repair-loop interface (ARCHITECTURE §7.7).
 *
 * P2 defines the contract only; the pipeline owns execution. The shape matters more than the
 * implementation, because it encodes three rules that are easy to lose under deadline:
 *
 * 1. **Repair order is substitute → regenerate copy → fail.** Never relax `requires`, never
 *    loosen a threshold, never drop a check.
 * 2. **The same substitution twice is a stop, not a third attempt.** OpenHands' stuck detector,
 *    applied to the gate: an action that did not work the first time will not work the second.
 * 3. **Verify the render.** After a substitution the page is re-rendered and the new section is
 *    asserted present by `data-sd-id` before the gate is believed. An edit is not done when the
 *    code changed; it is done when the render changed.
 */
import type { GateReport } from './report.js';
import type { CheckResult } from './types.js';

export const REPAIR_STRATEGIES = ['substitute', 'regenerate_copy', 'fail'] as const;
export type RepairStrategy = (typeof REPAIR_STRATEGIES)[number];

export interface RepairAction {
  readonly strategy: RepairStrategy;
  readonly checkId: string;
  /** The section the repair targets, where the failure is attributable to one. */
  readonly sdId?: string;
  readonly sdPath?: string;
  readonly reason: string;
}

/** A stable key for "this exact repair", so a repeat can be detected rather than retried. */
export function repairKey(action: RepairAction): string {
  return [action.strategy, action.checkId, action.sdId ?? '', action.sdPath ?? ''].join('|');
}

/** Which check ids a substitution can plausibly fix, versus which need different copy. */
const COPY_FAILURES = new Set([
  'content.placeholder-scan',
  'content.facts-provenance',
  'seo.title-length',
  'seo.description-length',
  'seo.title-unique',
  'seo.description-unique',
  'seo.link-text',
  'content.no-empty-text-nodes',
]);

const UNREPAIRABLE = new Set([
  // Structural promises the gate cannot repair by swapping a section.
  'perf.js-budget-per-page',
  'bp.no-external-script-unlisted',
  'legal.pages-present',
  'legal.consent-before-tracking',
  'schema.facts-match',
]);

export function planRepairs(report: GateReport): RepairAction[] {
  const failing = report.checks.filter(
    (check) => (check.mode === 'binary' || check.mode === 'numeric') && !check.passed,
  );
  return failing.map((check) => planOne(check));
}

function planOne(check: CheckResult): RepairAction {
  const sdId = check.items.find((item) => item.target !== undefined)?.target;
  const sdPath = check.items.find((item) => item.sd_path !== undefined)?.sd_path;

  const strategy: RepairStrategy = UNREPAIRABLE.has(check.id)
    ? 'fail'
    : COPY_FAILURES.has(check.id)
      ? 'regenerate_copy'
      : 'substitute';

  return {
    strategy,
    checkId: check.id,
    ...(sdId === undefined ? {} : { sdId }),
    ...(sdPath === undefined ? {} : { sdPath }),
    reason: check.message ?? check.title,
  };
}

export interface RepairLoopState {
  readonly attempts: number;
  readonly applied: readonly string[];
}

export type RepairDecision =
  | { readonly kind: 'apply'; readonly action: RepairAction }
  | { readonly kind: 'stop'; readonly reason: string };

export interface RepairLimits {
  readonly maxAttempts: number;
}

/**
 * Decide the next move. Returns `stop` rather than looping when a repair has already been
 * tried, when nothing is repairable, or when the attempt budget is spent — the gate's job is to
 * refuse, not to keep trying.
 */
export function nextRepair(
  report: GateReport,
  state: RepairLoopState,
  limits: RepairLimits = { maxAttempts: 4 },
): RepairDecision {
  if (report.canShip) return { kind: 'stop', reason: 'the gate is green' };
  if (state.attempts >= limits.maxAttempts) {
    return { kind: 'stop', reason: `repair budget spent after ${state.attempts} attempt(s)` };
  }

  const applied = new Set(state.applied);
  for (const action of planRepairs(report)) {
    if (action.strategy === 'fail') {
      return { kind: 'stop', reason: `${action.checkId} is not repairable by substitution` };
    }
    const key = repairKey(action);
    if (applied.has(key)) {
      // Proposing the same repair twice is the stuck signal. Stop rather than spend the budget.
      return { kind: 'stop', reason: `repair ${key} was already applied and did not help` };
    }
    return { kind: 'apply', action };
  }

  return { kind: 'stop', reason: 'no repairable failure remains, but the gate is not green' };
}

/**
 * The done gate (ARCHITECTURE §7.8). Publish is refused unless the hash of the definition being
 * published is the hash the green report was produced for.
 */
export function canPublish(input: { report: GateReport; currentSiteDefinitionHash: string }): {
  allowed: boolean;
  reason?: string;
} {
  if (!input.report.canShip) {
    return {
      allowed: false,
      reason: `the gate report is not green (${input.report.fatal.join(', ')})`,
    };
  }
  if (input.report.siteDefinitionHash !== input.currentSiteDefinitionHash) {
    return {
      allowed: false,
      reason:
        'the site definition changed after the green report was produced; re-run the gate ' +
        `(report ${input.report.siteDefinitionHash.slice(0, 12)}, current ${input.currentSiteDefinitionHash.slice(0, 12)})`,
    };
  }
  return { allowed: true };
}
