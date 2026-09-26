import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { ALL_TABLES } from '../src/schema.js';

/**
 * The committed migration, read as text.
 *
 * ARCHITECTURE §4: "code schema prints DB schema, never the reverse." `drizzle-kit generate`
 * prints this file from `schema.ts`, and these tests assert the printing happened — that the SQL
 * which will actually run carries the constraints the TypeScript claims.
 *
 * What this does **not** do is full drift detection: it cannot tell you that a column added to
 * `schema.ts` is missing here unless the column is one of the load-bearing ones named below. Add
 * a table and the first test fails; widen a text column and nothing does. Regeneration is manual
 * (`pnpm --filter @ada/db run db:generate`) and stated as such in HANDOFF rather than implied to
 * be automatic.
 */
const sql = readFileSync(
  fileURLToPath(new URL('../migrations/0000_init.sql', import.meta.url)),
  'utf8',
);

describe('the committed migration', () => {
  it('creates every table in the schema', () => {
    // The cheap drift check that does work: a new table in schema.ts fails here until someone
    // regenerates.
    for (const table of Object.values(ALL_TABLES)) {
      expect(sql, `${getTableName(table)} is missing from the migration`).toContain(
        `CREATE TABLE "${getTableName(table)}"`,
      );
    }
  });

  it('carries the composite self-references, not single-column ones', () => {
    // If these arrive as single-column FKs, a version can descend from another site's version and
    // the database will allow it. This is the constraint the whole tenancy model rests on.
    expect(sql).toContain(
      'FOREIGN KEY ("site_id","parent_version_id") REFERENCES "public"."site_versions"("site_id","version_id")',
    );
    expect(sql).toContain(
      'FOREIGN KEY ("site_id","parent_id") REFERENCES "public"."run_events"("site_id","event_id")',
    );
  });

  it('enforces one published version per site as a partial unique index', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "site_versions_one_published".*WHERE status = 'published'/,
    );
  });

  it('requires an answer on subject_consent, with no default', () => {
    // `boolean NOT NULL` with no DEFAULT. A default of false would make "nobody recorded consent"
    // and "consent was refused" the same row.
    expect(sql).toContain('"subject_consent" boolean NOT NULL');
    expect(sql).not.toMatch(/"subject_consent" boolean NOT NULL DEFAULT/);
  });

  it('leaves positioning nullable, because the pipeline interrupts instead of inferring', () => {
    expect(sql).toMatch(/"positioning" text(?!\s+NOT NULL)/);
  });

  it('emits a CHECK for every enumerated column', () => {
    // The gap this closes was found by running the migration, not by reading it: drizzle's
    // `enum` option is a type narrowing and emits nothing.
    for (const name of [
      'runs_status_check',
      'site_versions_status_check',
      'site_versions_created_by_check',
      'facts_verification_check',
      'priors_status_check',
    ]) {
      expect(sql, name).toContain(name);
    }
    expect(sql).toContain(`"status" IN ('IDLE', 'RUNNING'`);
  });

  it('requires a seed on every run', () => {
    expect(sql).toContain('"seed" integer NOT NULL');
  });

  it('uses timestamp with time zone throughout', () => {
    expect(sql).toContain('with time zone');
    // A naive timestamp column would mean whatever the server's locale says.
    expect(sql).not.toMatch(/timestamp(?! with time zone)/);
  });

  it('makes site_id NOT NULL wherever it appears', () => {
    const declarations = sql.match(/"site_id" text[^,\n]*/g) ?? [];
    expect(declarations.length).toBeGreaterThan(8);
    for (const declaration of declarations) {
      expect(declaration, declaration).toContain('NOT NULL');
    }
  });
});
