/**
 * The Lighthouse pass: collect, take the median run, assert the policy.
 *
 * Why this is not a shell-out to `@lhci/cli`: LHCI wants a server, an upload target and a config
 * file, and it evaluates assertions from that file. `policy.ts` already holds the assertions as
 * typed data, and having two copies of a gate policy is how the two drift. So collection uses
 * Lighthouse's programmatic API and evaluation reads the same `LHCI_ASSERTIONS` the rest of the
 * gate does. `buildLhciConfig()` still emits a `lighthouserc` for anyone who wants to run the CLI
 * directly, generated from that one source.
 *
 * The rule the whole pass is shaped around: **budgets gate on deterministic resource summaries,
 * never on the performance score**. Sizes and counts are exact on a static build, so they are
 * `error`. LCP, TBT and FCP move run to run, so they are `warn` on the median of three, and
 * `categories:performance` is absent from the policy entirely — there is a test asserting it
 * cannot drift back in.
 */
import { createServer } from 'node:net';

import { serveStatic } from './artifacts/serve.js';
import { LHCI_ASSERTIONS, type AssertionLevel, type LhciAssertion } from './policy.js';

export class LighthouseUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'the Lighthouse pass could not start. This is a failure, not a reason to skip the budgets: ' +
        `run \`npx playwright install chromium\`. (${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'LighthouseUnavailableError';
  }
}

export interface AssertionResult {
  readonly id: string;
  readonly level: AssertionLevel;
  readonly passed: boolean;
  readonly actual: number | null;
  readonly expected: number | null;
  /** Which bound was applied, so a failure says what it measured against. */
  readonly kind: 'maxNumericValue' | 'maxLength' | 'minScore' | 'absent';
  readonly reason: string;
  readonly route: string;
}

export interface LighthousePassResult {
  readonly assertions: readonly AssertionResult[];
  /** Failing rows at `error`. Anything here means the build does not ship. */
  readonly fatal: readonly AssertionResult[];
  readonly warnings: readonly AssertionResult[];
  readonly canShip: boolean;
  /** The median LHR per route, kept so a failure can be re-read without re-running. */
  readonly medianByRoute: Readonly<Record<string, unknown>>;
}

/** Ask the OS for a free port rather than guessing one and colliding with a real browser. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

interface AuditRow {
  score: number | null;
  numericValue?: number;
  details?: { items?: unknown[] };
}

/**
 * Evaluate one assertion against one audit. Returns null when the audit is absent from the run,
 * which is reported by the caller rather than silently passing — a budget that does not apply is
 * different from a budget that was met.
 */
export function evaluateAssertion(
  id: string,
  assertion: LhciAssertion,
  audit: AuditRow | undefined,
  route: string,
): AssertionResult | null {
  if (assertion.level === 'off') return null;
  if (audit === undefined) return null;

  if (assertion.maxNumericValue !== undefined) {
    const actual = audit.numericValue ?? null;
    if (actual === null) return null;
    return {
      id,
      level: assertion.level,
      passed: actual <= assertion.maxNumericValue,
      actual,
      expected: assertion.maxNumericValue,
      kind: 'maxNumericValue',
      reason: assertion.reason,
      route,
    };
  }

  if (assertion.maxLength !== undefined) {
    const actual = audit.details?.items?.length ?? 0;
    return {
      id,
      level: assertion.level,
      passed: actual <= assertion.maxLength,
      actual,
      expected: assertion.maxLength,
      kind: 'maxLength',
      reason: assertion.reason,
      route,
    };
  }

  if (assertion.minScore !== undefined) {
    const actual = audit.score;
    if (actual === null) return null;
    return {
      id,
      level: assertion.level,
      passed: actual >= assertion.minScore,
      actual,
      expected: assertion.minScore,
      kind: 'minScore',
      reason: assertion.reason,
      route,
    };
  }

  return null;
}

/**
 * `resource-summary:script:size` is one assertion id addressing one row of the
 * `resource-summary` audit's table. Lighthouse reports the whole table under a single audit, so
 * the row has to be lifted out before the bound can be applied.
 */
function resourceSummaryAudit(lhr: Record<string, unknown>, id: string): AuditRow | undefined {
  const match = /^resource-summary:([a-z-]+):(size|count)$/.exec(id);
  if (!match) return undefined;
  const [, resourceType, field] = match;

  const audits = lhr['audits'] as Record<
    string,
    { details?: { items?: Record<string, unknown>[] } }
  >;
  const summary = audits?.['resource-summary'];
  // The audit itself being absent is not "zero bytes" — it means the run did not measure this at
  // all. Returning undefined makes the caller report the budget as unevaluated, which for an
  // `error`-level row is fatal. A size budget that silently reads zero is worse than no budget.
  if (!summary) return undefined;
  const items = summary.details?.items ?? [];
  const row = items.find((item) => item['resourceType'] === resourceType);
  if (!row) {
    // A type with no requests is genuinely zero, not missing: a page with no third-party
    // requests passes a third-party budget.
    return { score: null, numericValue: 0, details: { items: [] } };
  }
  return {
    score: null,
    numericValue: Number(row[field === 'size' ? 'transferSize' : 'requestCount'] ?? 0),
  };
}

export function assertPolicy(
  lhr: Record<string, unknown>,
  route: string,
  assertions: Readonly<Record<string, LhciAssertion>> = LHCI_ASSERTIONS,
): AssertionResult[] {
  const audits = (lhr['audits'] ?? {}) as Record<string, AuditRow>;
  const out: AssertionResult[] = [];

  for (const [id, assertion] of Object.entries(assertions)) {
    const audit = id.startsWith('resource-summary:') ? resourceSummaryAudit(lhr, id) : audits[id];
    const result = evaluateAssertion(id, assertion, audit, route);
    if (result !== null) out.push(result);
  }
  return out;
}

/**
 * Fail closed on a budget that never got evaluated. An `error`-level assertion whose audit is
 * missing from the run is not a pass: the audit could have been renamed upstream, dropped by a
 * category filter, or errored during collection, and in every one of those cases the budget
 * stopped gating while the report stayed green.
 */
export function unevaluatedErrors(
  evaluated: readonly AssertionResult[],
  route: string,
  assertions: Readonly<Record<string, LhciAssertion>> = LHCI_ASSERTIONS,
): AssertionResult[] {
  const seen = new Set(evaluated.map((row) => row.id));
  return Object.entries(assertions)
    .filter(([id, assertion]) => assertion.level === 'error' && !seen.has(id))
    .map(([id, assertion]) => ({
      id,
      level: assertion.level,
      passed: false,
      actual: null,
      expected: null,
      kind: 'absent' as const,
      reason: `${assertion.reason} — but the audit produced no value, so the budget was not enforced`,
      route,
    }));
}

export interface LighthousePassOptions {
  readonly root: string;
  /** Representative routes only — one per (archetype × arrangement) group. */
  readonly routes: readonly string[];
  /** Three serial runs is Lighthouse's own guidance; never run instances concurrently. */
  readonly runs?: number;
  readonly assertions?: Readonly<Record<string, LhciAssertion>>;
}

export async function runLighthousePass(
  options: LighthousePassOptions,
): Promise<LighthousePassResult> {
  const runs = options.runs ?? 3;
  const site = await serveStatic(options.root);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lighthouse: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let computeMedianRun: any;
  try {
    ({ chromium } = await import('@playwright/test'));
    ({ default: lighthouse } = await import('lighthouse'));
    ({ computeMedianRun } = await import('lighthouse/core/lib/median-run.js'));
  } catch (error) {
    await site.close();
    throw new LighthouseUnavailableError(error);
  }

  const port = await freePort();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  try {
    browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  } catch (error) {
    await site.close();
    throw new LighthouseUnavailableError(error);
  }

  const assertions: AssertionResult[] = [];
  const medianByRoute: Record<string, unknown> = {};

  try {
    for (const route of options.routes) {
      const url = `${site.origin}${route === '/' ? '/' : route}`;
      const lhrs: Record<string, unknown>[] = [];

      for (let run = 0; run < runs; run += 1) {
        const result = await lighthouse(
          url,
          { port, output: 'json', logLevel: 'silent' },
          // Only the categories the policy actually asserts against. Collecting the rest costs
          // time and tempts somebody into gating on a category score later.
          {
            extends: 'lighthouse:default',
            settings: { onlyCategories: ['performance', 'best-practices'] },
          },
        );
        if (result?.lhr) lhrs.push(result.lhr as Record<string, unknown>);
      }

      if (lhrs.length === 0) {
        throw new LighthouseUnavailableError(new Error(`no Lighthouse run completed for ${route}`));
      }

      // The run nearest the multi-metric median, not the best and not the mean: a mean over a
      // bimodal distribution describes a page that never loaded that way.
      const median = (computeMedianRun(lhrs) ?? lhrs[0]) as Record<string, unknown>;
      medianByRoute[route] = median;

      const evaluated = assertPolicy(median, route, options.assertions);
      assertions.push(...evaluated);
      assertions.push(...unevaluatedErrors(evaluated, route, options.assertions));
    }
  } finally {
    await browser.close();
    await site.close();
  }

  const failing = assertions.filter((row) => !row.passed);
  const fatal = failing.filter((row) => row.level === 'error');

  return {
    assertions,
    fatal,
    warnings: failing.filter((row) => row.level === 'warn'),
    canShip: fatal.length === 0,
    medianByRoute,
  };
}

export function summariseLighthouse(result: LighthousePassResult): string {
  if (result.canShip) {
    return `budgets green — ${result.assertions.length} assertion(s), ${result.warnings.length} warning(s)`;
  }
  const lines = [`budgets red — ${result.fatal.length} over budget`];
  for (const row of result.fatal) {
    const measured = row.kind === 'absent' ? 'not evaluated' : `${row.actual} > ${row.expected}`;
    lines.push(`  ${row.route}  ${row.id}  ${measured}  (${row.reason})`);
  }
  return lines.join('\n');
}
