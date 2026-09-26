import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The schema, executed.
 *
 * Every other test in this package asserts what the TypeScript or the SQL *says*. This one runs
 * the committed migration against a real Postgres engine and then tries to insert the rows the
 * schema is supposed to refuse. The difference matters: "the FK is composite" is a claim about
 * text, whereas "the database rejected a run pointing at another site's version" is the property
 * anyone actually cares about.
 *
 * PGlite rather than a container: it is Postgres compiled to WASM, so the constraint semantics are
 * the real ones, and it needs no service — which means these assertions run on a laptop with
 * nothing installed and in CI identically. The Postgres service in CI remains for `db:migrate`
 * against a real server.
 */
const sql = readFileSync(
  fileURLToPath(new URL('../migrations/0000_init.sql', import.meta.url)),
  'utf8',
);

const SITE = 'ridgeline';
const OTHER = 'someone_else';

let pg: PGlite;

/** Run the migration exactly as `drizzle-kit migrate` would: statement by statement. */
async function applyMigration(database: PGlite): Promise<void> {
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed !== '') await database.exec(trimmed);
  }
}

async function expectRejected(fn: () => Promise<unknown>, matching: RegExp): Promise<void> {
  let message = '';
  try {
    await fn();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message, 'the database accepted a row it should have refused').toMatch(matching);
}

beforeAll(async () => {
  pg = new PGlite();
  await applyMigration(pg);

  await pg.exec(`
    INSERT INTO sites (site_id, tenant_id, niche) VALUES ('${SITE}', 't1', 'medical');
    INSERT INTO sites (site_id, tenant_id, niche) VALUES ('${OTHER}', 't2', 'medical');
    INSERT INTO site_versions
      (version_id, site_id, site_definition, manifest, gap_report, schema_version, created_by)
      VALUES ('v1', '${SITE}', '{}', '{}', '{}', 1, 'pipeline');
    INSERT INTO site_versions
      (version_id, site_id, site_definition, manifest, gap_report, schema_version, created_by)
      VALUES ('v_other', '${OTHER}', '{}', '{}', '{}', 1, 'pipeline');
  `);
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe('the migration runs', () => {
  it('applies cleanly and creates thirteen tables', async () => {
    const result = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    expect(result.rows[0]?.count).toBe(13);
  });
});

describe('tenancy, enforced by the database', () => {
  it('refuses a run pointing at another site’s version', async () => {
    // The claim the whole tenancy model rests on. With a single-column FK this insert succeeds.
    await expectRejected(
      () =>
        pg.exec(`INSERT INTO runs (run_id, site_id, version_id, stage, seed)
                 VALUES ('r1', '${SITE}', 'v_other', 'ingest', 1)`),
      /runs_version_fk|foreign key/i,
    );
  });

  it('accepts the same run pointing at its own site’s version', async () => {
    await pg.exec(`INSERT INTO runs (run_id, site_id, version_id, stage, seed)
                   VALUES ('r_ok', '${SITE}', 'v1', 'ingest', 1)`);
    const rows = await pg.query<{ run_id: string }>(
      `SELECT run_id FROM runs WHERE site_id = '${SITE}'`,
    );
    expect(rows.rows.map((r) => r.run_id)).toContain('r_ok');
  });

  it('refuses a version descending from another site’s version', async () => {
    await expectRejected(
      () =>
        pg.exec(`INSERT INTO site_versions
                 (version_id, site_id, parent_version_id, site_definition, manifest, gap_report,
                  schema_version, created_by)
                 VALUES ('v2', '${SITE}', 'v_other', '{}', '{}', '{}', 1, 'pipeline')`),
      /site_versions_parent_fk|foreign key/i,
    );
  });

  it('refuses a run event attached to another site’s run', async () => {
    await expectRejected(
      () =>
        pg.exec(`INSERT INTO run_events (event_id, site_id, run_id, kind)
                 VALUES ('e1', '${OTHER}', 'r_ok', 'StageStarted')`),
      /run_events_run_fk|foreign key/i,
    );
  });
});

describe('constraints that encode a decision', () => {
  it('allows only one published version per site', async () => {
    await pg.exec(`UPDATE site_versions SET status = 'published'
                   WHERE site_id = '${SITE}' AND version_id = 'v1'`);
    await pg.exec(`INSERT INTO site_versions
                   (version_id, site_id, site_definition, manifest, gap_report, schema_version,
                    created_by, status)
                   VALUES ('v3', '${SITE}', '{}', '{}', '{}', 1, 'pipeline', 'draft')`);

    // A second published version is what a half-finished deploy looks like.
    await expectRejected(
      () =>
        pg.exec(`UPDATE site_versions SET status = 'published'
                 WHERE site_id = '${SITE}' AND version_id = 'v3'`),
      /site_versions_one_published|unique/i,
    );
  });

  it('allows many drafts and many archived versions', async () => {
    await pg.exec(`INSERT INTO site_versions
                   (version_id, site_id, site_definition, manifest, gap_report, schema_version,
                    created_by, status)
                   VALUES ('v4', '${SITE}', '{}', '{}', '{}', 1, 'pipeline', 'draft')`);
    const rows = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM site_versions
       WHERE site_id = '${SITE}' AND status = 'draft'`,
    );
    expect(rows.rows[0]?.count).toBeGreaterThan(1);
  });

  it('refuses an asset with no answer on subject_consent', async () => {
    // "Nobody recorded consent" must not be representable as false. In the medical niche this is
    // the most expensive row this system could publish.
    await expectRejected(
      () =>
        pg.exec(`INSERT INTO assets (asset_id, site_id, path, width, height, aspect, rights)
                 VALUES ('a1', '${SITE}', '/p.jpg', 100, 100, 1.0, 'licensed')`),
      /subject_consent|not-null|null value/i,
    );
  });

  it('accepts an asset that answers it', async () => {
    await pg.exec(`INSERT INTO assets
                   (asset_id, site_id, path, width, height, aspect, rights, subject_consent)
                   VALUES ('a2', '${SITE}', '/p.jpg', 100, 100, 1.0, 'licensed', false)`);
    const rows = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM assets WHERE site_id = '${SITE}'`,
    );
    expect(rows.rows[0]?.count).toBe(1);
  });

  it('refuses two facts claiming the same path in one site', async () => {
    await pg.exec(`INSERT INTO facts (fact_id, site_id, path, value, provenance)
                   VALUES ('f1', '${SITE}', 'contact.phone', '"01632"', '{}')`);
    // Two rows on one path is how a build renders one and grounds against the other.
    await expectRejected(
      () =>
        pg.exec(`INSERT INTO facts (fact_id, site_id, path, value, provenance)
                 VALUES ('f2', '${SITE}', 'contact.phone', '"other"', '{}')`),
      /facts_site_path_unique|unique/i,
    );
  });

  it('lets two different sites hold the same fact path', async () => {
    // The uniqueness is per site. Two clients both having a phone number is not a conflict.
    await pg.exec(`INSERT INTO facts (fact_id, site_id, path, value, provenance)
                   VALUES ('f3', '${OTHER}', 'contact.phone', '"other"', '{}')`);
    const rows = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM facts WHERE path = 'contact.phone'`,
    );
    expect(rows.rows[0]?.count).toBe(2);
  });

  it('refuses a duplicate edit sequence number on one version', async () => {
    await pg.exec(`INSERT INTO edit_actions
                   (action_id, site_id, version_id, seq, action, inverse, txn_id, actor)
                   VALUES ('ea1', '${SITE}', 'v1', 1, '{}', '{}', 't', 'owner')`);
    // A duplicate seq makes undo ambiguous.
    await expectRejected(
      () =>
        pg.exec(`INSERT INTO edit_actions
                 (action_id, site_id, version_id, seq, action, inverse, txn_id, actor)
                 VALUES ('ea2', '${SITE}', 'v1', 1, '{}', '{}', 't', 'owner')`),
      /edit_actions_seq_unique|unique/i,
    );
  });

  it('refuses a run with no seed', async () => {
    // Without it, "reproducible" is a claim rather than a property.
    await expectRejected(
      () => pg.exec(`INSERT INTO runs (run_id, site_id, stage) VALUES ('r2', '${SITE}', 'ingest')`),
      /seed|not-null|null value/i,
    );
  });

  it('refuses a run status outside the enumeration', async () => {
    await expectRejected(
      () =>
        pg.exec(`INSERT INTO runs (run_id, site_id, stage, seed, status)
                 VALUES ('r3', '${SITE}', 'ingest', 1, 'PROBABLY_FINE')`),
      /check|invalid|constraint/i,
    );
  });
});

describe('the cross-tenant tables', () => {
  it('take rows with no site_id at all, by design', async () => {
    // Priors are learned across tenants — that is what makes them worth having.
    // "window" quoted: it is a reserved word in Postgres. Drizzle always quotes it; hand-written
    // SQL like this does not, and the failure is a syntax error rather than anything obvious.
    await pg.exec(`INSERT INTO priors (arrangement_id, stratum, evidence, "window")
                   VALUES ('hero/a#stacked', '{"niche":"medical"}', '{"n":40}', '2026-Q3')`);
    const rows = await pg.query<{ count: number }>(`SELECT count(*)::int AS count FROM priors`);
    expect(rows.rows[0]?.count).toBe(1);
  });
});
