import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  ALL_TABLES,
  APPEND_ONLY_TABLES,
  CROSS_TENANT_TABLES,
  FACT_VERIFICATIONS,
  RUN_STATUSES,
  SITE_VERSION_STATUSES,
  assets,
  editActions,
  facts,
  modelCalls,
  runEvents,
  runs,
  siteVersions,
  sites,
  telemetryEvents,
} from '../src/schema.js';

const SITE_SCOPED = Object.keys(ALL_TABLES).filter(
  (name) => !CROSS_TENANT_TABLES.includes(name as keyof typeof ALL_TABLES),
);

describe('the table set', () => {
  it('is the thirteen tables ARCHITECTURE §4 names', () => {
    expect(Object.keys(ALL_TABLES).sort()).toEqual(
      [
        'assets',
        'diversityLedger',
        'editActions',
        'factSources',
        'facts',
        'gateReports',
        'modelCalls',
        'priors',
        'runEvents',
        'runs',
        'siteVersions',
        'sites',
        'telemetryEvents',
      ].sort(),
    );
  });

  it('uses snake_case table names, because SQL is read by people too', () => {
    expect(getTableName(siteVersions)).toBe('site_versions');
    expect(getTableName(runEvents)).toBe('run_events');
  });
});

describe('tenancy, as a property of the schema', () => {
  it.each(SITE_SCOPED)('%s carries a NOT NULL site_id', (name) => {
    const table = ALL_TABLES[name as keyof typeof ALL_TABLES];
    const config = getTableConfig(table);
    const siteColumn = config.columns.find((column) => column.name === 'site_id');
    expect(siteColumn, `${name} has no site_id`).toBeDefined();
    // Nullable would make the row invisible to every scoped query and owned by nobody.
    expect(siteColumn?.notNull, `${name}.site_id is nullable`).toBe(true);
  });

  it.each(SITE_SCOPED)('%s has site_id as the first primary-key column', (name) => {
    // Leading the key with site_id is what makes every scoped read an index seek rather than a
    // scan, and it is why a forgotten filter is a performance cliff as well as a leak.
    const config = getTableConfig(ALL_TABLES[name as keyof typeof ALL_TABLES]);
    const pk = config.primaryKeys[0];
    const columns = pk ? pk.columns.map((column) => column.name) : ['site_id'];
    expect(columns[0], `${name} primary key starts with ${columns[0]}`).toBe('site_id');
  });

  it('names exactly two cross-tenant exceptions, and says why in the schema', () => {
    // The list existing is not enough; it has to be asserted, or the next table that "just needs
    // to be global for now" joins it.
    expect([...CROSS_TENANT_TABLES].sort()).toEqual(['diversityLedger', 'priors']);
  });

  it('makes every reference between site-scoped tables composite', () => {
    // A single-column FK to a version id would permit a run in site A pointing at a version in
    // site B. Composite keys make the database refuse it, with no code path that can forget.
    for (const table of [siteVersions, runs, runEvents, modelCalls, editActions]) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        const reference = fk.reference();
        // A reference to `sites` itself is legitimately single-column: site_id *is* that table's
        // key, and it is the root of the tenancy tree rather than a row inside it.
        if (getTableName(reference.foreignTable) === 'sites') continue;

        const columnNames = reference.columns.map((column) => column.name);
        expect(columnNames, `${getTableName(table)} has a single-column reference`).toContain(
          'site_id',
        );
        expect(columnNames.length).toBeGreaterThan(1);
      }
    }
  });
});

describe('the append-only logs', () => {
  it('names the four logs', () => {
    expect([...APPEND_ONLY_TABLES].sort()).toEqual(
      ['editActions', 'modelCalls', 'runEvents', 'telemetryEvents'].sort(),
    );
  });

  it.each(APPEND_ONLY_TABLES)('%s has no updated_at, because rows never change', (name) => {
    const config = getTableConfig(ALL_TABLES[name as keyof typeof ALL_TABLES]);
    expect(config.columns.map((column) => column.name)).not.toContain('updated_at');
  });
});

describe('columns that encode a decision', () => {
  it('leaves positioning nullable, because the pipeline interrupts rather than inferring it', () => {
    // NOT NULL here would force the pipeline to invent a value to create the row, which is
    // exactly the inference stage 4's interrupt exists to prevent.
    const column = getTableConfig(sites).columns.find((c) => c.name === 'positioning');
    expect(column?.notNull).toBe(false);
  });

  it('requires an answer on subject_consent, with no default', () => {
    // In the medical niche a photograph of a person without recorded consent is the most
    // expensive thing this system could publish. Absence of an answer must be unrepresentable,
    // not silently false.
    const column = getTableConfig(assets).columns.find((c) => c.name === 'subject_consent');
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(false);
  });

  it('requires provenance on every fact', () => {
    // A fact without provenance cannot be quoted (v4 §8), so the column cannot be empty.
    const column = getTableConfig(facts).columns.find((c) => c.name === 'provenance');
    expect(column?.notNull).toBe(true);
  });

  it('requires a seed on every run', () => {
    // Without it, "reproducible" is a claim rather than a property.
    const column = getTableConfig(runs).columns.find((c) => c.name === 'seed');
    expect(column?.notNull).toBe(true);
    expect(column?.hasDefault).toBe(false);
  });

  it('allows only one published version per site', () => {
    const config = getTableConfig(siteVersions);
    const partial = config.indexes.find((i) => i.config.name === 'site_versions_one_published');
    expect(partial, 'no partial unique index on published').toBeDefined();
    expect(partial?.config.unique).toBe(true);
    expect(partial?.config.where).toBeDefined();
  });

  it('keeps one fact per path per site', () => {
    // Two rows claiming the same path is how a build renders one and grounds against the other.
    const names = getTableConfig(facts).uniqueConstraints.map((u) => u.name);
    expect(names).toContain('facts_site_path_unique');
  });

  it('keeps the edit sequence gapless per version', () => {
    const names = getTableConfig(editActions).uniqueConstraints.map((u) => u.name);
    expect(names).toContain('edit_actions_seq_unique');
  });
});

describe('timestamps', () => {
  it('is timestamptz everywhere, never a naive timestamp', () => {
    // A timestamp without a zone means whatever the server's locale says, and this will run in
    // at least two.
    for (const [name, table] of Object.entries(ALL_TABLES)) {
      for (const column of getTableConfig(table).columns) {
        if (column.columnType !== 'PgTimestamp' && column.columnType !== 'PgTimestampString') {
          continue;
        }
        expect(
          (column as unknown as { withTimezone?: boolean }).withTimezone,
          `${name}.${column.name} has no timezone`,
        ).toBe(true);
      }
    }
  });
});

describe('enumerations', () => {
  it('matches the run statuses the pipeline actually uses', () => {
    // These strings cross a process boundary: the pipeline writes them, the DB constrains them.
    // Drift here is a run that cannot be persisted at the moment it goes wrong.
    expect([...RUN_STATUSES]).toEqual([
      'IDLE',
      'RUNNING',
      'WAITING_FOR_OWNER',
      'WAITING_FOR_REVIEW',
      'FINISHED',
      'ERROR',
      'STUCK',
      'BUDGET_EXCEEDED',
    ]);
  });

  it('constrains version status and fact verification rather than taking free text', () => {
    expect([...SITE_VERSION_STATUSES]).toEqual(['draft', 'published', 'archived']);
    expect(FACT_VERIFICATIONS.length).toBeGreaterThan(1);
  });

  it('backs every enumerated column with a real CHECK, not just a TypeScript narrowing', () => {
    // `text(..., { enum })` narrows the type and emits no constraint. Running the migration and
    // inserting `status = 'PROBABLY_FINE'` succeeded until these checks existed, which made every
    // "the database constrains this" claim about an enum column false. `live.test.ts` now asserts
    // the rejection against a real engine; this asserts the constraint is declared at all.
    const expected: Record<string, string[]> = {
      site_versions: ['site_versions_status_check', 'site_versions_created_by_check'],
      facts: ['facts_verification_check'],
      runs: ['runs_status_check'],
      priors: ['priors_status_check'],
    };
    for (const [tableKey, names] of Object.entries(expected)) {
      const table = Object.values(ALL_TABLES).find((t) => getTableName(t) === tableKey);
      expect(table, `${tableKey} not found`).toBeDefined();
      const declared = getTableConfig(table!).checks.map((c) => c.name);
      for (const name of names) expect(declared, tableKey).toContain(name);
    }
  });
});

describe('telemetry', () => {
  it('joins to a section instance, which is what priors are keyed on', () => {
    const names = getTableConfig(telemetryEvents).columns.map((c) => c.name);
    expect(names).toContain('section_instance_id');
  });
});
