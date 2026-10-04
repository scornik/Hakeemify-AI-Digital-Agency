/**
 * The server.
 *
 * `node:http`, no framework, no middleware. Four routes and a health check; a router is a
 * `switch` on a parsed path, and nothing here needs more.
 *
 * ## It binds to loopback, and will not bind elsewhere by accident
 *
 * This dashboard renders **one client's facts and another's generated copy**, with no
 * authentication of any kind. Binding `0.0.0.0` publishes a tenant's data to the network.
 *
 * So the host is `127.0.0.1` and changing it takes an explicit `ADA_DASHBOARD_HOST`, which also
 * prints a warning naming what is being exposed. A default of `0.0.0.0` "for convenience in
 * Docker" is how an internal tool ends up indexed, and the convenience is one flag.
 *
 * ## Read-only, and the reason is money
 *
 * There is no POST. Triggering a build from an unauthenticated endpoint would let anyone who can
 * reach the port spend the run budget — the ceilings in `resolveBudgets` cap one run, not the
 * number of runs. A trigger belongs behind authentication and a job queue, and neither exists
 * yet, so neither does the button. `GET /health` reports that plainly rather than leaving an
 * operator to discover it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
  findGateReport,
  findRun,
  listAllRuns,
  loadVersion,
  readEvents,
  readModelCalls,
  scope,
  type Database,
  type ModelCallRow,
  type RunRow,
} from '@ada/db';

import {
  errorView,
  gapReportView,
  gateReportView,
  notFoundView,
  runDetailView,
  runListView,
  type ModelCallRowView,
  type RunListRow,
} from './views.js';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4317;

export interface DashboardOptions {
  readonly db: Database;
  readonly host?: string;
  readonly port?: number;
  /** Shown in the footer so an operator knows which database they are reading. */
  readonly sourceLabel?: string;
}

/** A parsed route. Returned rather than dispatched so the routing is testable without a socket. */
export type Route =
  | { readonly kind: 'runs' }
  | { readonly kind: 'run'; readonly siteId: string; readonly runId: string }
  | { readonly kind: 'gate'; readonly siteId: string; readonly runId: string }
  | { readonly kind: 'gap'; readonly siteId: string; readonly versionId: string }
  | { readonly kind: 'health' }
  | { readonly kind: 'not-found' };

/**
 * Parse a path into a route.
 *
 * Segments are decoded once, here. A site id arrives from the URL and goes into a SQL parameter
 * and into HTML; the first is safe because every query is parameterised through drizzle, and the
 * second because every interpolation is escaped by `html`. Neither relies on this function
 * sanitising anything, which is why it does not try to.
 */
export function parseRoute(pathname: string): Route {
  const parts = pathname.split('/').filter((part) => part !== '');
  const decoded = parts.map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      // A malformed escape is not a route. Left as-is so it matches nothing below.
      return part;
    }
  });

  if (decoded.length === 0) return { kind: 'runs' };
  if (decoded.length === 1 && decoded[0] === 'health') return { kind: 'health' };

  if (decoded[0] === 'runs' && decoded.length === 3) {
    return { kind: 'run', siteId: decoded[1] as string, runId: decoded[2] as string };
  }
  if (decoded[0] === 'runs' && decoded.length === 4 && decoded[3] === 'gate') {
    return { kind: 'gate', siteId: decoded[1] as string, runId: decoded[2] as string };
  }
  if (decoded[0] === 'versions' && decoded.length === 4 && decoded[3] === 'gap') {
    return { kind: 'gap', siteId: decoded[1] as string, versionId: decoded[2] as string };
  }

  return { kind: 'not-found' };
}

export interface Rendered {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

const HTML = 'text/html; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * Render a route. Pure in everything except the database read, so a test drives it directly
 * without binding a port.
 */
export async function render(route: Route, db: Database, sourceLabel: string): Promise<Rendered> {
  switch (route.kind) {
    case 'health':
      return {
        status: 200,
        contentType: JSON_TYPE,
        body: JSON.stringify({
          ok: true,
          readOnly: true,
          // Said out loud rather than left to be discovered: an operator looking for a trigger
          // should learn why there is not one from the service itself.
          trigger: 'absent — a build trigger needs authentication and a job queue first',
        }),
      };

    case 'runs': {
      const rows = await listAllRuns(db);
      return {
        status: 200,
        contentType: HTML,
        body: runListView(rows.map(toRunListRow), sourceLabel),
      };
    }

    case 'run': {
      const siteScope = scope(route.siteId);
      const run = await findRun(db, siteScope, route.runId);
      if (run === undefined) {
        return { status: 404, contentType: HTML, body: notFoundView('No such run.') };
      }

      const events = await readEvents(db, siteScope, route.runId);
      const calls = await readModelCalls(db, siteScope, route.runId);
      const gate = await findGateReport(db, siteScope, `${route.runId}:gate`);

      return {
        status: 200,
        contentType: HTML,
        body: runDetailView({
          run: toRunListRow(run),
          events: events.map((event) => ({
            eventId: event.eventId,
            kind: event.kind,
            payload: event.payload,
            ts: event.ts,
          })),
          calls: calls.map(toModelCallRow),
          hasGateReport: gate !== undefined,
          source: sourceLabel,
        }),
      };
    }

    case 'gate': {
      const report = await findGateReport(db, scope(route.siteId), `${route.runId}:gate`);
      if (report === undefined) {
        return {
          status: 404,
          contentType: HTML,
          body: notFoundView('No gate report stored for that run.'),
        };
      }
      return {
        status: 200,
        contentType: HTML,
        body: gateReportView({
          siteId: route.siteId,
          runId: route.runId,
          versionId: report.versionId,
          policyVersion: report.policyVer,
          reports: report.checks,
          summary: report.summary,
          source: sourceLabel,
        }),
      };
    }

    case 'gap': {
      const version = await loadVersion(db, scope(route.siteId), route.versionId);
      if (version === undefined) {
        return { status: 404, contentType: HTML, body: notFoundView('No such version.') };
      }
      return {
        status: 200,
        contentType: HTML,
        body: gapReportView({
          siteId: route.siteId,
          versionId: route.versionId,
          gapReport: version.gapReport,
          source: sourceLabel,
        }),
      };
    }

    default:
      return { status: 404, contentType: HTML, body: notFoundView('No such page.') };
  }
}

function toRunListRow(row: RunRow): RunListRow {
  return {
    siteId: row.siteId,
    runId: row.runId,
    stage: row.stage,
    status: row.status,
    costUsd: row.costUsd,
    versionId: row.versionId,
    createdAt: row.createdAt,
  };
}

function toModelCallRow(row: ModelCallRow): ModelCallRowView {
  return {
    stage: row.stage,
    provider: row.provider,
    model: row.model,
    costUsd: row.costUsd,
    durationMs: row.durationMs,
    finishReason: row.finishReason,
    attempts: row.attempts,
    guardrailCodes: row.guardrailCodes,
  };
}

/** The two headers worth setting on a page that renders a client's data with no auth. */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // No scripts at all: the dashboard ships none, so an injected one has nothing to hide among.
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export function createDashboard(options: DashboardOptions): Server {
  const sourceLabel = options.sourceLabel ?? '';

  return createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      // Read-only means read-only. Anything that is not a GET or HEAD is refused before routing,
      // so a future handler cannot accidentally become writable.
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { 'content-type': HTML, allow: 'GET, HEAD', ...SECURITY_HEADERS });
        response.end(errorView('This dashboard is read-only.'));
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      try {
        const result = await render(parseRoute(url.pathname), options.db, sourceLabel);
        response.writeHead(result.status, {
          'content-type': result.contentType,
          ...SECURITY_HEADERS,
        });
        response.end(request.method === 'HEAD' ? undefined : result.body);
      } catch (error) {
        // The message is shown: this is a loopback tool for the person who owns the database, and
        // hiding the reason behind "something went wrong" costs them the incident.
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(500, { 'content-type': HTML, ...SECURITY_HEADERS });
        response.end(errorView(message));
      }
    })();
  });
}

export interface StartResult {
  readonly server: Server;
  readonly origin: string;
  /** Present when the host is not loopback. Printed by the CLI; surfaced here for tests. */
  readonly exposureWarning?: string;
}

export function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export async function startDashboard(options: DashboardOptions): Promise<StartResult> {
  const host = options.host ?? DEFAULT_HOST;
  const port = options.port ?? DEFAULT_PORT;
  const server = createDashboard(options);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const warning = isLoopback(host)
    ? undefined
    : `the dashboard is bound to ${host}, not loopback. It has no authentication and renders ` +
      'client facts and generated copy. Put it behind something, or bind 127.0.0.1.';

  return {
    server,
    origin: `http://${host}:${port}`,
    ...(warning === undefined ? {} : { exposureWarning: warning }),
  };
}
