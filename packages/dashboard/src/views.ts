/**
 * The four views: run list, run detail, gate report, gap report.
 *
 * Every function here is a **pure function of rows to a string**. No database handle, no request,
 * no clock. That is what lets the tests assert the escaping and the ordering without a server, and
 * it is the same property the gate's checks have for the same reason.
 *
 * The rows are read back out of `jsonb` columns, so they arrive as `unknown`. Nothing here trusts
 * their shape: every field is read through a narrowing helper that returns a default rather than
 * throwing. A dashboard that 500s because one historical run has a field the current code does not
 * expect is a dashboard nobody opens during an incident.
 */
import { badge, checkStatusOf, page, runStatusOf, scroller, tiles, type Tile } from './layout.js';
import { html, pathSegment, type SafeHtml } from './html.js';

// ---------------------------------------------------------------------------------------------
// Narrowing helpers. Defaults, never throws.
// ---------------------------------------------------------------------------------------------

type Row = Readonly<Record<string, unknown>>;

const asRow = (value: unknown): Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Row) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asText = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
const asNumber = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const asBool = (value: unknown): boolean => value === true;

/** Short, sortable, and the same in every column. */
export function shortTime(iso: string): string {
  if (iso === '') return '';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toISOString().replace('T', ' ').slice(0, 19);
}

export function money(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

// ---------------------------------------------------------------------------------------------
// Run list
// ---------------------------------------------------------------------------------------------

export interface RunListRow {
  readonly siteId: string;
  readonly runId: string;
  readonly stage: string;
  readonly status: string;
  readonly costUsd: number;
  readonly versionId: string | null;
  readonly createdAt: string;
}

export function runListView(rows: readonly RunListRow[], source: string): string {
  const spend = rows.reduce((total, row) => total + row.costUsd, 0);
  const summary: Tile[] = [
    { label: 'Runs', value: String(rows.length) },
    {
      label: 'Not finished',
      value: String(rows.filter((row) => row.status !== 'FINISHED').length),
    },
    { label: 'Total spend', value: money(spend) },
  ];

  const body =
    rows.length === 0
      ? html`<div class="empty">
          No runs recorded. A run appears here once it has been persisted — set
          <code>DATABASE_URL</code> and run <code>pnpm e2e:fixture</code>.
        </div>`
      : html`${tiles(summary)}
          <h2>Runs</h2>
          ${scroller(
            'Runs',
            html`<table>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Site</th>
                  <th scope="col">Status</th>
                  <th scope="col">Stage</th>
                  <th scope="col" class="num">Spend</th>
                  <th scope="col">Started</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(
                  (row) =>
                    html`<tr>
                      <td>
                        <a
                          href="/runs/${pathSegment(row.siteId)}/${pathSegment(row.runId)}"
                          class="mono"
                          >${row.runId}</a
                        >
                      </td>
                      <td class="mono">${row.siteId}</td>
                      <td>${badge(runStatusOf(row.status), row.status)}</td>
                      <td class="mono">${row.stage}</td>
                      <td class="num">${money(row.costUsd)}</td>
                      <td class="detail">${shortTime(row.createdAt)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`,
          )}`;

  return page({ title: 'Runs', subtitle: 'Every persisted pipeline run.', body, source });
}

// ---------------------------------------------------------------------------------------------
// Run detail
// ---------------------------------------------------------------------------------------------

export interface EventRowView {
  readonly eventId: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly ts: string;
}

export interface ModelCallRowView {
  readonly stage: string;
  readonly provider: string;
  readonly model: string;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly finishReason: string;
  readonly attempts: number;
  readonly guardrailCodes: readonly string[];
}

export interface RunDetailInput {
  readonly run: RunListRow;
  readonly events: readonly EventRowView[];
  readonly calls: readonly ModelCallRowView[];
  readonly hasGateReport: boolean;
  readonly source: string;
}

/** The stage a `StageStarted`/`StageCompleted` event is about, when it names one. */
function stageOf(payload: unknown): string {
  return asText(asRow(payload)['stage']);
}

/**
 * Payload minus the fields already shown as columns, rendered compactly.
 *
 * Shown rather than hidden behind a disclosure: the payload is where `tier2_skipped`,
 * `guardrail_codes` and the substitution reasons live, and those are the whole reason an operator
 * opens this page.
 */
function payloadDetail(payload: unknown): string {
  const row = { ...asRow(payload) };
  delete row['stage'];
  delete row['ts'];
  const parts = Object.entries(row).map(([key, value]) => `${key}=${compact(value)}`);
  return parts.join('  ');
}

function compact(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 120);
  return String(value).slice(0, 120);
}

export function runDetailView(input: RunDetailInput): string {
  const { run, events, calls } = input;
  const spend = calls.reduce((total, call) => total + call.costUsd, 0);

  const summary: Tile[] = [
    { label: 'Status', value: run.status },
    { label: 'Stage', value: run.stage },
    { label: 'Model calls', value: String(calls.length) },
    { label: 'Spend', value: money(spend) },
    { label: 'Events', value: String(events.length) },
  ];

  const crumbs = html`<a href="/">Runs</a> / <span class="mono">${run.runId}</span>`;

  const body = html`
    ${tiles(summary)}
    <h2>Reports</h2>
    <p class="detail">
      ${
        input.hasGateReport
          ? html`<a href="/runs/${pathSegment(run.siteId)}/${pathSegment(run.runId)}/gate"
              >Gate report</a
            >`
          : 'No gate report stored for this run.'
      }
      ${
        run.versionId === null
          ? ''
          : html` ·
              <a href="/versions/${pathSegment(run.siteId)}/${pathSegment(run.versionId)}/gap"
                >Gap report</a
              >`
      }
    </p>

    <h2>Stage events</h2>
    ${
      events.length === 0
        ? html`<div class="empty">No events recorded.</div>`
        : scroller(
            'Stage events',
            html`<table>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Stage</th>
                  <th scope="col">Detail</th>
                  <th scope="col">At</th>
                </tr>
              </thead>
              <tbody>
                ${events.map(
                  (event) =>
                    html`<tr>
                      <td class="mono">${event.kind}</td>
                      <td class="mono">${stageOf(event.payload)}</td>
                      <td class="detail mono">${payloadDetail(event.payload)}</td>
                      <td class="detail">${shortTime(event.ts)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`,
          )
    }

    <h2>Model calls</h2>
    ${
      calls.length === 0
        ? html`<div class="empty">
            No model calls. A fixture build using the deterministic fake still records them, so an
            empty table means nothing was called.
          </div>`
        : scroller(
            'Model calls',
            html`<table>
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Model</th>
                  <th scope="col">Finish</th>
                  <th scope="col" class="num">Attempts</th>
                  <th scope="col" class="num">ms</th>
                  <th scope="col" class="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                ${calls.map(
                  (call) =>
                    html`<tr>
                      <td class="mono">${call.stage}</td>
                      <td>${call.provider}</td>
                      <td class="mono">${call.model}</td>
                      <td>
                        ${badge(call.finishReason === 'stop' ? 'good' : 'serious', call.finishReason)}
                        ${
                          call.guardrailCodes.length === 0
                            ? ''
                            : html`<span class="detail"> ${call.guardrailCodes.join(', ')}</span>`
                        }
                      </td>
                      <td class="num">${call.attempts}</td>
                      <td class="num">${call.durationMs}</td>
                      <td class="num">${money(call.costUsd)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`,
          )
    }
  `;

  return page({
    title: `Run ${run.runId}`,
    subtitle: `${run.siteId} · seed-reproducible`,
    crumbs,
    body,
    source: input.source,
  });
}

// ---------------------------------------------------------------------------------------------
// Gate report
// ---------------------------------------------------------------------------------------------

export interface GateReportInput {
  readonly siteId: string;
  readonly runId: string;
  readonly versionId: string;
  readonly policyVersion: string;
  /** `checks` as stored: an array of per-(page × project) GateReport documents. */
  readonly reports: unknown;
  readonly summary: unknown;
  readonly source: string;
}

export function gateReportView(input: GateReportInput): string {
  const reports = asArray(input.reports).map(asRow);
  const summary = asRow(input.summary);
  const canShip = asBool(summary['canShip']);
  const fatal = asArray(summary['fatal']).map(asRow);
  const needsReview = asArray(summary['needsReview']).map(asRow);

  const summaryTiles: Tile[] = [
    { label: 'Verdict', value: canShip ? 'can ship' : 'blocked' },
    { label: 'Reports', value: String(reports.length) },
    { label: 'Fatal rows', value: String(fatal.length) },
    { label: 'Needs review', value: String(needsReview.length) },
  ];

  const crumbs = html`<a href="/">Runs</a> /
    <a href="/runs/${pathSegment(input.siteId)}/${pathSegment(input.runId)}" class="mono"
      >${input.runId}</a
    >
    / gate`;

  const body = html`
    <p>${badge(canShip ? 'good' : 'critical', canShip ? 'Can ship' : 'Does not ship')}</p>
    ${tiles(summaryTiles)}
    ${
      fatal.length === 0
        ? ''
        : html`<h2>Fatal</h2>
            ${scroller(
              'Fatal rows',
              html`<table>
                <thead>
                  <tr>
                    <th scope="col">Route</th>
                    <th scope="col">Project</th>
                    <th scope="col">Check</th>
                  </tr>
                </thead>
                <tbody>
                  ${fatal.map(
                    (row) =>
                      html`<tr>
                        <td class="mono">${asText(row['route'])}</td>
                        <td>${asText(row['project'])}</td>
                        <td class="mono">${asText(row['checkId'])}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`,
            )}`
    }
    ${reports.map((report) => reportSection(report))}
  `;

  return page({
    title: 'Gate report',
    subtitle: `policy ${input.policyVersion} · version ${input.versionId}`,
    crumbs,
    body,
    source: input.source,
  });
}

/**
 * One (page × project) report.
 *
 * `notApplicable` rows are counted but not listed. There are dozens of them on a static build —
 * every browser-only check in the static pass — and listing them buries the rows that decided
 * something. The count stays visible so "the gate shrank" is still noticeable.
 */
function reportSection(report: Row): SafeHtml {
  const checks = asArray(report['checks']).map(asRow);
  const summary = asRow(report['summary']);
  const decided = checks.filter((check) => asText(check['mode']) !== 'notApplicable');
  const failing = decided.filter((check) => !asBool(check['passed']));

  const score = summary['score'];
  const scoreText = typeof score === 'number' ? `${Math.round(score * 100)}%` : 'no score';

  return html`
    <h2>${asText(report['route'], '/')} · ${asText(report['project'], 'static')}</h2>
    <p class="detail">
      ${scoreText} · ${decided.length} decided · ${failing.length} failing ·
      ${asNumber(summary['notApplicable'])} not applicable
      ${
        typeof score === 'number'
          ? ''
          : html`<span class="note">
              No score: a weighted check errored, so the mean would be a number that hides a
              gatherer failure.
            </span>`
      }
    </p>
    ${
      failing.length === 0
        ? html`<div class="empty">Every decided check passed.</div>`
        : scroller(
            'Failing checks',
            html`<table>
              <thead>
                <tr>
                  <th scope="col">Result</th>
                  <th scope="col">Check</th>
                  <th scope="col">What it found</th>
                </tr>
              </thead>
              <tbody>
                ${failing.map((check) => {
                  const mode = asText(check['mode']);
                  const severity = asText(check['severity'], 'moderate');
                  const items = asArray(check['items']).map(asRow);
                  return html`<tr>
                    <td>
                      ${badge(
                        checkStatusOf(mode, asBool(check['passed']), severity),
                        mode === 'error' ? 'errored' : severity,
                      )}
                    </td>
                    <td>
                      <span class="mono">${asText(check['id'])}</span><br />
                      <span class="detail">${asText(check['title'])}</span>
                    </td>
                    <td class="detail">
                      ${asText(check['message'])}
                      ${items
                        .slice(0, 5)
                        .map(
                          (item) =>
                            html`<div class="mono">
                              ${asText(item['detail'])}
                              ${item['actual'] === undefined ? '' : html` — ${compact(item['actual'])}`}
                            </div>`,
                        )}
                      ${items.length > 5 ? html`<div>and ${items.length - 5} more</div>` : ''}
                    </td>
                  </tr>`;
                })}
              </tbody>
            </table>`,
          )
    }
  `;
}

// ---------------------------------------------------------------------------------------------
// Gap report
// ---------------------------------------------------------------------------------------------

export interface GapReportInput {
  readonly siteId: string;
  readonly versionId: string;
  readonly gapReport: unknown;
  readonly source: string;
}

/**
 * The gap report read forwards: what the owner can go and change.
 *
 * Unlocks before blocking gaps, because an unlock is an instruction and a blocking gap is a wall.
 * An owner reading this page wants the list of things that would make the site better, not the
 * list of reasons it is as plain as it is.
 */
export function gapReportView(input: GapReportInput): string {
  const report = asRow(input.gapReport);
  const unlocks = asArray(report['unlocks']).map(asRow);
  const blocking = asArray(report['blocking']).map(asRow);

  const crumbs = html`<a href="/">Runs</a> / gap`;

  const body = html`
    ${tiles([
      { label: 'Unlocks', value: String(unlocks.length) },
      { label: 'Blocking gaps', value: String(blocking.length) },
    ])}
    <h2>Provide this, get that</h2>
    ${
      unlocks.length === 0
        ? html`<div class="empty">Nothing further to unlock from the facts on file.</div>`
        : scroller(
            'Unlocks',
            html`<table>
              <thead>
                <tr>
                  <th scope="col">Provide</th>
                  <th scope="col">Unlocks</th>
                </tr>
              </thead>
              <tbody>
                ${unlocks.map(
                  (unlock) =>
                    html`<tr>
                      <td>${asText(unlock['provide'], asText(unlock['predicate']))}</td>
                      <td class="detail">
                        ${asText(unlock['unlocks'], asText(unlock['variant_id']))}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>`,
          )
    }
    ${
      blocking.length === 0
        ? ''
        : html`<h2>Blocking</h2>
            ${scroller(
              'Blocking gaps',
              html`<table>
                <thead>
                  <tr>
                    <th scope="col">Beat</th>
                    <th scope="col">Why nothing was eligible</th>
                  </tr>
                </thead>
                <tbody>
                  ${blocking.map(
                    (gap) =>
                      html`<tr>
                        <td class="mono">${asText(gap['beat_id'], asText(gap['beat']))}</td>
                        <td class="detail">${asText(gap['reason'])}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>`,
            )}`
    }
  `;

  return page({
    title: 'Gap report',
    subtitle: `version ${input.versionId}`,
    crumbs,
    body,
    source: input.source,
  });
}

export function notFoundView(what: string): string {
  return page({
    title: 'Not found',
    body: html`<div class="empty">${what}</div>
      <p><a href="/">Back to runs</a></p>`,
  });
}

export function errorView(message: string): string {
  return page({
    title: 'Error',
    body: html`<div class="empty">${message}</div>
      <p><a href="/">Back to runs</a></p>`,
  });
}
