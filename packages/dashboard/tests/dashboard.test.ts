import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { testDatabase, type Database, type TestDatabase } from '@ada/db';

import { escapeHtml, html, raw } from '../src/html.js';
import { badge, checkStatusOf, runStatusOf } from '../src/layout.js';
import {
  gapReportView,
  gateReportView,
  money,
  runDetailView,
  runListView,
  shortTime,
} from '../src/views.js';
import { DEFAULT_HOST, isLoopback, parseRoute, render, startDashboard } from '../src/server.js';

describe('escaping', () => {
  it('escapes every interpolated value', () => {
    const nasty = '<script>alert(1)</script>';
    expect(html`<p>${nasty}</p>`.value).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  });

  it('escapes quotes, so a value is safe inside an attribute', () => {
    expect(escapeHtml(`" onmouseover="alert(1)`)).not.toContain('"');
    expect(escapeHtml("' onfocus='x")).not.toContain("'");
  });

  it('renders null and undefined as nothing, not as the words', () => {
    // A missing version id is blank in a table, not the string "null".
    expect(html`<td>${null}</td>`.value).toBe('<td></td>');
    expect(html`<td>${undefined}</td>`.value).toBe('<td></td>');
  });

  it('joins arrays and lets raw() through', () => {
    expect(html`${[1, 2, 3]}`.value).toBe('123');
    expect(html`${raw('<b>x</b>')}`.value).toBe('<b>x</b>');
  });

  it('escapes nested interpolation, so a safe wrapper cannot launder an unsafe value', () => {
    const inner = html`<td>${'<img onerror=x>'}</td>`;
    expect(
      html`<tr>
        ${inner}
      </tr>`.value,
    ).toContain('&lt;img onerror=x&gt;');
  });
});

describe('status is never colour alone', () => {
  it('ships a glyph and a label beside the colour', () => {
    // On a light surface `warning` and `serious` are below 3:1 by design — the icon and label are
    // the mitigation. This project's own gate also fails a build for colour-alone meaning.
    const mark = badge('warning', 'WAITING_FOR_OWNER').value;
    expect(mark).toContain('badge--warning');
    expect(mark).toContain('aria-hidden="true"');
    expect(mark).toContain('WAITING_FOR_OWNER');
  });

  it('maps run statuses onto the four reserved steps', () => {
    expect(runStatusOf('FINISHED')).toBe('good');
    expect(runStatusOf('WAITING_FOR_OWNER')).toBe('warning');
    expect(runStatusOf('BUDGET_EXCEEDED')).toBe('serious');
    expect(runStatusOf('ERROR')).toBe('critical');
  });

  it('treats an unknown status as unhealthy, not as fine', () => {
    // Same rule as the providers' finish reasons: an unrecognised terminal state is not success.
    expect(runStatusOf('PROBABLY_FINE')).toBe('critical');
  });

  it('maps a check by mode before severity', () => {
    expect(checkStatusOf('notApplicable', false, 'critical')).toBe('neutral');
    expect(checkStatusOf('error', false, 'minor')).toBe('critical');
    expect(checkStatusOf('needs_review', false, 'minor')).toBe('warning');
    expect(checkStatusOf('binary', true, 'critical')).toBe('good');
    expect(checkStatusOf('binary', false, 'serious')).toBe('serious');
  });
});

describe('the run list', () => {
  const row = {
    siteId: 'ridgeline_roofing',
    runId: 'b_fixture',
    stage: 'publish',
    status: 'FINISHED',
    costUsd: 0.003,
    versionId: 'v_abc',
    createdAt: '2026-10-04T09:00:00.000Z',
  };

  it('links each run and totals the spend', () => {
    const page = runListView([row, { ...row, runId: 'b_two', costUsd: 0.007 }], 'localhost/ada');
    expect(page).toContain('/runs/ridgeline_roofing/b_fixture');
    expect(page).toContain('$0.0100');
  });

  it('says how to get runs when there are none, rather than showing an empty table', () => {
    // An empty list reads as "no runs". It is usually "not connected".
    const page = runListView([], '');
    expect(page).toContain('DATABASE_URL');
  });

  it('escapes a hostile site id into the href and the cell', () => {
    const page = runListView([{ ...row, siteId: '"><script>alert(1)</script>' }], '');
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('%3E%3Cscript%3E');
  });

  it('formats money to four places, because a run costs thousandths', () => {
    expect(money(0.003)).toBe('$0.0030');
  });

  it('formats a timestamp the same way in every column', () => {
    expect(shortTime('2026-10-04T09:00:00.000Z')).toBe('2026-10-04 09:00:00');
    // An unparseable value is shown, not swallowed.
    expect(shortTime('not a date')).toBe('not a date');
    expect(shortTime('')).toBe('');
  });
});

describe('the run detail', () => {
  const input = {
    run: {
      siteId: 's',
      runId: 'r',
      stage: 'gate',
      status: 'FINISHED',
      costUsd: 0.003,
      versionId: 'v1',
      createdAt: '2026-10-04T09:00:00.000Z',
    },
    events: [
      {
        eventId: 'r:1',
        kind: 'StageCompleted',
        payload: { stage: 'anti_slop', tier2_judged: false, tier2_skipped: 'no judge configured' },
        ts: '2026-10-04T09:00:01.000Z',
      },
    ],
    calls: [
      {
        stage: 'beat_selection',
        provider: 'fake',
        model: 'obedient',
        costUsd: 0.001,
        durationMs: 12,
        finishReason: 'stop',
        attempts: 1,
        guardrailCodes: [],
      },
    ],
    hasGateReport: true,
    source: 'localhost/ada',
  };

  it('shows the payload fields an operator opens the page for', () => {
    // tier2_skipped, guardrail codes and substitution reasons live in the payload. Hiding them
    // behind a disclosure defeats the point of the page.
    const pageHtml = runDetailView(input);
    expect(pageHtml).toContain('tier2_skipped');
    expect(pageHtml).toContain('no judge configured');
  });

  it('does not repeat the stage in the detail column', () => {
    const pageHtml = runDetailView(input);
    // `stage` has its own column, so it is stripped from the rendered payload.
    expect(pageHtml).not.toContain('stage=anti_slop');
  });

  it('links the gate report only when one is stored', () => {
    expect(runDetailView(input)).toContain('/gate');
    expect(runDetailView({ ...input, hasGateReport: false })).toContain(
      'No gate report stored for this run.',
    );
  });

  it('flags a finish reason that is not stop', () => {
    const page = runDetailView({
      ...input,
      calls: [{ ...input.calls[0]!, finishReason: 'length', guardrailCodes: ['truncated_output'] }],
    });
    expect(page).toContain('badge--serious');
    expect(page).toContain('truncated_output');
  });

  it('says an empty call table means nothing was called', () => {
    // A fixture build with the deterministic fake still records calls, so empty is informative.
    expect(runDetailView({ ...input, calls: [] })).toContain('nothing was called');
  });
});

describe('the gate report', () => {
  const base = {
    siteId: 's',
    runId: 'r',
    versionId: 'v1',
    policyVersion: 'launch@1',
    source: '',
  };

  it('leads with the verdict', () => {
    const page = gateReportView({
      ...base,
      reports: [],
      summary: { canShip: false, fatal: [{ route: '/', project: 'static', checkId: 'a11y.x' }] },
    });
    expect(page).toContain('Does not ship');
    expect(page).toContain('a11y.x');
  });

  it('lists failing checks and hides notApplicable ones, but keeps the count', () => {
    // There are dozens of notApplicable rows on a static build. Listing them buries the rows that
    // decided something; dropping the count would hide a gate that shrank.
    const page = gateReportView({
      ...base,
      summary: { canShip: true, fatal: [], needsReview: [] },
      reports: [
        {
          route: '/',
          project: 'static',
          summary: { score: 0.97, notApplicable: 11 },
          checks: [
            { id: 'seo.title-present', mode: 'binary', passed: true, severity: 'serious' },
            { id: 'a11y.axe-violations', mode: 'notApplicable', passed: false },
            {
              id: 'content.placeholder-scan',
              mode: 'binary',
              passed: false,
              severity: 'critical',
              message: 'found lorem ipsum',
              items: [{ detail: 'in s_hook.headline' }],
            },
          ],
        },
      ],
    });
    expect(page).toContain('content.placeholder-scan');
    expect(page).toContain('found lorem ipsum');
    expect(page).toContain('11 not applicable');
    expect(page).not.toContain('seo.title-present');
  });

  it('explains a null score rather than printing 0%', () => {
    // Null is not a bad score; it is no score, because a weighted check errored.
    const page = gateReportView({
      ...base,
      summary: { canShip: false, fatal: [] },
      reports: [{ route: '/', project: 'static', summary: { score: null }, checks: [] }],
    });
    expect(page).toContain('no score');
    // Whitespace-normalised: the template literal wraps prose across lines, and asserting on the
    // raw string would make every reflow a test failure.
    expect(page.replace(/\s+/g, ' ')).toContain('hides a gatherer failure');
  });

  it('survives a report document with fields it does not expect', () => {
    // A dashboard that 500s because one historical run has an unfamiliar shape is a dashboard
    // nobody opens during an incident.
    expect(() => gateReportView({ ...base, reports: 'not an array', summary: 42 })).not.toThrow();
  });

  it('escapes a hostile check message', () => {
    const page = gateReportView({
      ...base,
      summary: { canShip: true, fatal: [] },
      reports: [
        {
          route: '/',
          project: 'static',
          summary: { score: 1 },
          checks: [
            {
              id: 'x',
              mode: 'binary',
              passed: false,
              severity: 'minor',
              message: '<img src=x onerror=alert(1)>',
            },
          ],
        },
      ],
    });
    expect(page).not.toContain('<img src=x');
    expect(page).toContain('&lt;img src=x');
  });
});

describe('the gap report', () => {
  it('puts unlocks before blocking gaps', () => {
    // An unlock is an instruction; a blocking gap is a wall. The owner wants the instructions.
    const page = gapReportView({
      siteId: 's',
      versionId: 'v1',
      source: '',
      gapReport: {
        unlocks: [{ provide: '4 before/after pairs', unlocks: 'proof/transformation' }],
        blocking: [{ beat_id: 'hook', reason: 'no eligible variant' }],
      },
    });
    expect(page.indexOf('4 before/after pairs')).toBeLessThan(page.indexOf('no eligible variant'));
  });

  it('says so when there is nothing to unlock', () => {
    const page = gapReportView({ siteId: 's', versionId: 'v', source: '', gapReport: {} });
    expect(page).toContain('Nothing further to unlock');
  });
});

describe('routing', () => {
  it('parses the four routes', () => {
    expect(parseRoute('/')).toEqual({ kind: 'runs' });
    expect(parseRoute('/health')).toEqual({ kind: 'health' });
    expect(parseRoute('/runs/s/r')).toEqual({ kind: 'run', siteId: 's', runId: 'r' });
    expect(parseRoute('/runs/s/r/gate')).toEqual({ kind: 'gate', siteId: 's', runId: 'r' });
    expect(parseRoute('/versions/s/v/gap')).toEqual({ kind: 'gap', siteId: 's', versionId: 'v' });
  });

  it('decodes a segment once', () => {
    expect(parseRoute('/runs/my%20site/r')).toMatchObject({ siteId: 'my site' });
  });

  it('does not throw on a malformed escape', () => {
    expect(() => parseRoute('/runs/%E0%A4%A/r')).not.toThrow();
  });

  it('returns not-found rather than guessing', () => {
    expect(parseRoute('/runs')).toEqual({ kind: 'not-found' });
    expect(parseRoute('/runs/s/r/nope')).toEqual({ kind: 'not-found' });
    expect(parseRoute('/../../etc/passwd')).toEqual({ kind: 'not-found' });
  });
});

describe('binding', () => {
  it('defaults to loopback', () => {
    // The dashboard renders a client's facts with no authentication. A default of 0.0.0.0 "for
    // Docker" is how an internal tool ends up indexed.
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(isLoopback(DEFAULT_HOST)).toBe(true);
    expect(isLoopback('0.0.0.0')).toBe(false);
  });
});

describe('against a real database', () => {
  let harness: TestDatabase;
  let db: Database;
  let origin: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    harness = await testDatabase();
    db = harness.db;

    await harness.query(
      `INSERT INTO sites (site_id, tenant_id, niche) VALUES ('s1', 't1', 'medical')`,
    );
    await harness.query(
      `INSERT INTO site_versions (version_id, site_id, site_definition, manifest, gap_report,
        schema_version, created_by)
       VALUES ('v1', 's1', '{}', '{}', '{"unlocks":[{"provide":"two more photos"}]}', 1,
        'pipeline')`,
    );
    await harness.query(
      `INSERT INTO runs (run_id, site_id, version_id, stage, status, seed, cost_usd)
       VALUES ('r1', 's1', 'v1', 'gate', 'FINISHED', 1, 0.003)`,
    );
    await harness.query(
      `INSERT INTO run_events (event_id, site_id, run_id, kind, payload)
       VALUES ('r1:1', 's1', 'r1', 'StageCompleted', '{"stage":"gate"}')`,
    );
    await harness.query(
      `INSERT INTO model_calls (call_id, site_id, run_id, stage, provider, model, schema_hash,
        prompt_hash, output_hash, cost_usd, duration_ms, finish_reason, attempts)
       VALUES ('c1', 's1', 'r1', 'beat_selection', 'fake', 'obedient', 'a', 'b', 'c', 0.001, 12,
        'stop', 1)`,
    );
    await harness.query(
      `INSERT INTO gate_reports (report_id, site_id, version_id, policy_ver, checks, summary)
       VALUES ('r1:gate', 's1', 'v1', 'launch@1', '[]', '{"canShip":true,"fatal":[]}')`,
    );

    const started = await startDashboard({ db, port: 0, sourceLabel: 'pglite' });
    origin = started.origin.replace(
      ':0',
      `:${(started.server.address() as { port: number }).port}`,
    );
    close = () =>
      new Promise<void>((resolve) => {
        started.server.close(() => resolve());
      });
  }, 120_000);

  afterAll(async () => {
    await close?.();
    await harness?.close();
  });

  it('serves the run list from real rows', async () => {
    const response = await fetch(`${origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const body = await response.text();
    expect(body).toContain('r1');
    expect(body).toContain('$0.0030');
  });

  it('serves a run with its events and calls', async () => {
    const body = await (await fetch(`${origin}/runs/s1/r1`)).text();
    expect(body).toContain('StageCompleted');
    expect(body).toContain('beat_selection');
  });

  it('serves the gate report and the gap report', async () => {
    expect(await (await fetch(`${origin}/runs/s1/r1/gate`)).text()).toContain('Can ship');
    expect(await (await fetch(`${origin}/versions/s1/v1/gap`)).text()).toContain('two more photos');
  });

  it('404s a run in another site, rather than leaking it', async () => {
    // The scoped read is what does this; the route alone would happily look it up.
    const response = await fetch(`${origin}/runs/other_site/r1`);
    expect(response.status).toBe(404);
  });

  it('sends the security headers', async () => {
    const response = await fetch(`${origin}/health`);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('refuses anything that is not GET or HEAD', async () => {
    // Read-only means read-only: an unauthenticated POST that could spend the run budget is a
    // vulnerability, and the ceilings cap one run rather than the number of runs.
    const response = await fetch(`${origin}/`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  it('says in /health that there is no trigger, and why', async () => {
    const body = (await (await fetch(`${origin}/health`)).json()) as {
      readOnly: boolean;
      trigger: string;
    };
    expect(body.readOnly).toBe(true);
    expect(body.trigger).toContain('authentication');
  });

  it('404s an unknown path', async () => {
    expect((await fetch(`${origin}/nope`)).status).toBe(404);
  });

  it('renders a route directly, without a socket', async () => {
    const result = await render({ kind: 'runs' }, db, 'pglite');
    expect(result.status).toBe(200);
    expect(result.body).toContain('r1');
  });
});
