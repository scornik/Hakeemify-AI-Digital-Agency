/**
 * A real Postgres for tests, with no service.
 *
 * PGlite is Postgres compiled to WASM, so constraint semantics — composite foreign keys, partial
 * unique indexes, CHECK constraints, NOT NULL — are the real ones rather than an approximation.
 * That matters more here than convenience: two defects in this schema were found by *executing* it
 * and are invisible to any test that reads the SQL. `text(..., { enum })` emitted no constraint at
 * all, and four log tables had the wrong column name.
 *
 * ## Why it lives in `src` rather than in this package's tests
 *
 * `@ada/pipeline` needs it too, and a package cannot import another package's test files. Putting
 * it here means `drizzle-orm` stays a dependency of exactly one package, which is the layering the
 * rest of the repository has.
 *
 * ## Why the imports are dynamic
 *
 * `@electric-sql/pglite` is a **devDependency**, and a `src` file that imports one at module scope
 * makes the package unloadable wherever dev dependencies are pruned. The dynamic import keeps it
 * out of the module graph until a test asks for it, and `requireDevDependency` turns the absence
 * into a sentence that says what to install rather than a bare resolution error.
 *
 * This is never used in production. Nothing in `client.ts` references it.
 */
import { applyMigration } from './migrate.js';
import type { Database } from './client.js';

export interface TestDatabase {
  readonly db: Database;
  /** The raw handle, for assertions that are clearer as SQL than as a query builder. */
  readonly query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
  close(): Promise<void>;
}

function requireDevDependency(name: string, error: unknown): never {
  throw new Error(
    `${name} could not be loaded, and it is a devDependency used only by tests: ` +
      `${error instanceof Error ? error.message : String(error)}. ` +
      'Run `pnpm install` without --prod.',
  );
}

/**
 * An empty, migrated database. Call `close()` when done — each instance holds a WASM heap, and a
 * suite that leaks them will run out of memory before it runs out of tests.
 */
export async function testDatabase(options: { migrate?: boolean } = {}): Promise<TestDatabase> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let PGlite: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let drizzle: any;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
    ({ drizzle } = await import('drizzle-orm/pglite'));
  } catch (error) {
    requireDevDependency('@electric-sql/pglite', error);
  }

  const schema = await import('./schema.js');
  const pg = new PGlite();
  const db = drizzle(pg, { schema }) as Database;

  if (options.migrate !== false) {
    await applyMigration(async (statement) => pg.exec(statement));
  }

  return {
    db,
    query: async (sql: string) => pg.query(sql) as Promise<{ rows: Record<string, unknown>[] }>,
    close: () => pg.close(),
  };
}
