/**
 * The connection.
 *
 * One pool per process, created explicitly and closed explicitly. No module-level singleton that
 * connects on import: a package that opens a socket because something typed `import` is a package
 * that connects during a unit test, during a build, and during `--help`.
 *
 * ## Why the URL is never defaulted
 *
 * `DATABASE_URL` missing throws `DatabaseUrlMissingError`. The tempting default is
 * `postgres://localhost/ada`, and it is the wrong tempting default: a process that silently
 * connects to a local database when its configuration is absent will, in production, silently
 * connect to nothing and report that persistence is working. An error at startup is cheap; a
 * pipeline that believes it persisted is not.
 *
 * `drizzle.config.ts` does carry a local fallback, because migration generation is a developer
 * action against a developer machine and failing it on an unset variable is noise. Generation
 * does not write client data.
 */
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export class DatabaseUrlMissingError extends Error {
  constructor(variable: string) {
    super(
      `${variable} is not set, and there is deliberately no default. A default would let a ` +
        'process connect somewhere plausible when its configuration is absent and report that ' +
        'persistence is working. Set it, or use the in-memory checkpoint store explicitly.',
    );
    this.name = 'DatabaseUrlMissingError';
  }
}

export interface ConnectOptions {
  readonly url?: string;
  /** Overrides merged over the defaults below. Mostly for tests and for a read replica. */
  readonly pool?: PoolConfig;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface Connection {
  readonly db: Database;
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * Defaults chosen for a batch pipeline rather than a web server: few connections, and a
 * `statement_timeout` so a query that will never finish fails instead of holding a connection
 * until the process is killed. A run has a wall-clock ceiling; its queries need one too, or the
 * ceiling is enforced only between calls.
 */
export const POOL_DEFAULTS: PoolConfig = {
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
  // A pipeline stage holding a transaction open is a bug, not a slow query.
  idle_in_transaction_session_timeout: 60_000,
};

export function resolveDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
  variable = 'DATABASE_URL',
): string {
  const url = env[variable];
  if (url === undefined || url.trim() === '') throw new DatabaseUrlMissingError(variable);
  return url;
}

export function connect(options: ConnectOptions = {}): Connection {
  const url = options.url ?? resolveDatabaseUrl(options.env);
  const pool = new Pool({ ...POOL_DEFAULTS, connectionString: url, ...options.pool });

  // An `error` listener is not optional on a pg Pool: an idle client that errors emits on the
  // pool, and an unhandled 'error' event takes the whole process down — during a build, that
  // looks like a crash with no stack in our code.
  pool.on('error', (error) => {
    console.error('[@ada/db] idle client error:', error.message);
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
    close: () => pool.end(),
  };
}

/** Run `fn` with a connection and close it afterwards, even when `fn` throws. */
export async function withConnection<T>(
  options: ConnectOptions,
  fn: (db: Database) => Promise<T>,
): Promise<T> {
  const connection = connect(options);
  try {
    return await fn(connection.db);
  } finally {
    await connection.close();
  }
}
