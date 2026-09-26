/**
 * Applying the migration from code.
 *
 * `drizzle-kit migrate` is the developer path. This exists for the two places that need to bring a
 * database up without the CLI: the fixture's end-to-end run, and any test that wants a real schema
 * in front of it. A test that needs a shell command to be run first is a test that will be skipped.
 *
 * It is deliberately **not** a general migration runner. There is one migration, it is idempotent
 * in the only sense that matters here (`applyMigration` on an already-migrated database is a
 * no-op because every statement is guarded), and a journal-tracking runner would be inventing a
 * tool that already exists in `drizzle-kit`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where the generated SQL lives, relative to this file's compiled location. */
export function migrationPath(): string {
  // dist/src/migrate.js -> package root -> migrations/
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'migrations', '0000_init.sql');
}

/**
 * Split the generated file the way drizzle does. The marker matters: several statements contain
 * semicolons inside a `CHECK (... IN ('a', 'b'))` or a partial index's `WHERE`, so splitting on
 * `;` produces fragments that do not parse.
 */
export function migrationStatements(sql?: string): string[] {
  const source = sql ?? readFileSync(migrationPath(), 'utf8');
  return source
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '');
}

/** Anything that can execute a SQL string: a pg Pool, a PGlite instance, a drizzle client. */
export interface SqlExecutor {
  (statement: string): Promise<unknown>;
}

export interface ApplyResult {
  readonly applied: number;
  /** Statements skipped because the object already existed. */
  readonly alreadyPresent: number;
}

/**
 * Run the migration.
 *
 * `CREATE TABLE`/`ALTER TABLE ADD CONSTRAINT` on an existing object errors rather than being a
 * no-op, so "already migrated" arrives as a thrown duplicate-object error. Those are counted and
 * swallowed; anything else is re-thrown. Swallowing *all* errors would make a genuinely broken
 * migration look like a successful one, which is the failure this function must not have.
 */
export async function applyMigration(
  execute: SqlExecutor,
  statements = migrationStatements(),
): Promise<ApplyResult> {
  let applied = 0;
  let alreadyPresent = 0;

  for (const statement of statements) {
    try {
      await execute(statement);
      applied += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/already exists|duplicate (?:object|table|key)/i.test(message)) {
        alreadyPresent += 1;
        continue;
      }
      throw new Error(`migration failed on: ${statement.slice(0, 120)}\n${message}`, {
        cause: error,
      });
    }
  }

  return { applied, alreadyPresent };
}
