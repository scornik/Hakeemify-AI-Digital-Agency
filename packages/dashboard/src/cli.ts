#!/usr/bin/env node
/**
 * `node dist/src/cli.js` — open the dashboard against `DATABASE_URL`.
 *
 * Exits rather than defaulting when there is no database: a dashboard pointed at nothing shows an
 * empty run list, which reads as "no runs" rather than as "not connected".
 */
import { connect, resolveDatabaseUrl } from '@ada/db';

import { DEFAULT_HOST, DEFAULT_PORT, startDashboard } from './server.js';

const url = resolveDatabaseUrl();
const connection = connect({ url });

const host = process.env['ADA_DASHBOARD_HOST'] ?? DEFAULT_HOST;
const port = Number(process.env['ADA_DASHBOARD_PORT'] ?? DEFAULT_PORT);

const { origin, exposureWarning } = await startDashboard({
  db: connection.db,
  host,
  port,
  // Host and database name only. A connection string in a footer is a password in a screenshot.
  sourceLabel: `${new URL(url).host}${new URL(url).pathname}`,
});

if (exposureWarning !== undefined) console.warn(`WARNING: ${exposureWarning}`);
// `warn` rather than `log`: this is the one line an operator needs on stderr beside the warning
// above, and the repo's lint rule allows only warn and error.
console.warn(`dashboard on ${origin} (read-only)`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void connection.close().then(() => process.exit(0));
  });
}
