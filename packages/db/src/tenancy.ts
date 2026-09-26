/**
 * The tenancy layer (ARCHITECTURE §4).
 *
 * > Multi-tenancy: `site_id` on every row, a filter layer on every query, and a write hook that
 * > rejects cross-tenant references.
 *
 * ## Why this is a module and not a code-review rule
 *
 * "Remember to filter by `site_id`" is a rule that holds until the first query written in a hurry,
 * and the failure is silent: a query that forgets the filter returns *more* rows, works in
 * development where there is one tenant, and leaks one client's facts into another client's site
 * in production. Nothing fails, nothing logs, and the bug is invisible until somebody reads a
 * page that quotes a business they have never heard of.
 *
 * So the filter is not available to be forgotten. `scope()` returns a handle bound to one
 * `site_id`, and every read and write goes through it. There is no exported helper that takes a
 * table and no site.
 *
 * Two layers, deliberately redundant:
 *
 * 1. **The schema.** Every foreign key between site-scoped tables is composite —
 *    `(site_id, parent_id)` → `(site_id, id)`. Postgres itself refuses a row pointing at another
 *    site's parent. This is the layer that cannot be bypassed by any code path, including a
 *    migration or a psql session.
 * 2. **This module.** Catches the same class of mistake earlier, with a message that names the
 *    two sites, because a foreign-key violation from the driver does not say *why* it is wrong.
 *
 * The redundancy is the point. Layer 1 is authoritative and unhelpful; layer 2 is helpful and
 * bypassable. Neither alone is enough.
 */
import { and, eq, type Column, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { ALL_TABLES, APPEND_ONLY_TABLES, CROSS_TENANT_TABLES } from './schema.js';

export class CrossTenantWriteError extends Error {
  constructor(
    readonly table: string,
    readonly expectedSiteId: string,
    readonly foundSiteId: string,
  ) {
    super(
      `refusing to write to ${table}: the row belongs to site ${JSON.stringify(foundSiteId)} but ` +
        `this handle is scoped to ${JSON.stringify(expectedSiteId)}. A row that crosses sites is ` +
        'never a legitimate write — if two sites genuinely need the same data, it is two rows.',
    );
    this.name = 'CrossTenantWriteError';
  }
}

export class MissingSiteIdError extends Error {
  constructor(readonly table: string) {
    super(
      `refusing to write to ${table}: the row has no site_id. Every site-scoped row carries one, ` +
        'and a row without it would be invisible to every scoped query and belong to nobody.',
    );
    this.name = 'MissingSiteIdError';
  }
}

export class AppendOnlyViolationError extends Error {
  constructor(
    readonly table: string,
    readonly operation: string,
  ) {
    super(
      `${table} is append-only and cannot be ${operation}. It is an audit log: run events, model ` +
        'calls, edit actions and telemetry. A log you can rewrite does not evidence anything.',
    );
    this.name = 'AppendOnlyViolationError';
  }
}

export class CrossTenantTableError extends Error {
  constructor(readonly table: string) {
    super(
      `${table} is cross-tenant by design (priors and the diversity ledger are learned across ` +
        'sites) and must not be reached through a site-scoped handle. Use the unscoped helpers, ' +
        'and put nothing identifying in it.',
    );
    this.name = 'CrossTenantTableError';
  }
}

type TableName = keyof typeof ALL_TABLES;

function nameOf(table: PgTable): TableName | undefined {
  for (const [key, candidate] of Object.entries(ALL_TABLES)) {
    if (candidate === table) return key as TableName;
  }
  return undefined;
}

/**
 * Validate one row against a scope. Exported so it can be tested directly and so a caller
 * batching inserts can check the whole batch before touching the database.
 */
export function assertRowInScope(
  tableName: string,
  siteId: string,
  row: Readonly<Record<string, unknown>>,
): void {
  const rowSiteId = row['siteId'];
  if (rowSiteId === undefined || rowSiteId === null || rowSiteId === '') {
    throw new MissingSiteIdError(tableName);
  }
  if (rowSiteId !== siteId) {
    throw new CrossTenantWriteError(tableName, siteId, String(rowSiteId));
  }
}

export interface SiteScope {
  readonly siteId: string;
  /**
   * The `where` fragment every scoped read must carry. Returned rather than applied, so a caller
   * composing a complex query still cannot express one without it.
   */
  where(table: PgTable, extra?: SQL): SQL;
  /** Validate rows before an insert, and stamp `siteId` so a caller cannot omit it. */
  rowsFor<T extends Record<string, unknown>>(table: PgTable, rows: readonly T[]): T[];
  /** Refuse an update or delete on an append-only table. */
  assertMutable(table: PgTable, operation: 'updated' | 'deleted'): void;
}

/**
 * Bind every subsequent operation to one site.
 *
 * `scope()` is the only way this module exposes a table for reading or writing. There is
 * deliberately no `unscopedWhere()` convenience: the cross-tenant tables are reached by importing
 * them directly, which makes the exception visible at the call site rather than one argument away.
 */
export function scope(siteId: string): SiteScope {
  if (siteId.trim() === '') {
    throw new MissingSiteIdError('scope()');
  }

  const guard = (table: PgTable): { name: TableName } => {
    const name = nameOf(table);
    if (name === undefined) {
      throw new Error(
        'this table is not in ALL_TABLES, so the tenancy layer cannot reason about it. Add it ' +
          'there, or if it is genuinely cross-tenant add it to CROSS_TENANT_TABLES.',
      );
    }
    if (CROSS_TENANT_TABLES.includes(name)) throw new CrossTenantTableError(name);
    return { name };
  };

  return {
    siteId,

    where(table, extra) {
      const { name } = guard(table);
      const siteColumn = (table as unknown as Record<string, Column | undefined>)['siteId'];
      if (siteColumn === undefined) {
        // Not reachable through the exported API today, but a new table without the column would
        // otherwise produce a query with no filter at all — the exact failure this module exists
        // to prevent, arriving as `eq(undefined, …)` rather than as an error.
        throw new MissingSiteIdError(name);
      }
      const scoped = eq(siteColumn, siteId);
      return extra === undefined ? scoped : (and(scoped, extra) as SQL);
    },

    rowsFor(table, rows) {
      const { name } = guard(table);
      return rows.map((row) => {
        // Stamped rather than required: a caller that must supply site_id on every row is a
        // caller that will eventually supply the wrong one from a variable in scope.
        const stamped = { ...row, siteId } as Record<string, unknown>;
        assertRowInScope(name, siteId, stamped);
        return stamped as typeof row;
      });
    },

    assertMutable(table, operation) {
      const { name } = guard(table);
      if (APPEND_ONLY_TABLES.includes(name)) throw new AppendOnlyViolationError(name, operation);
    },
  };
}

/**
 * Assert a row referencing a parent stays inside one site. The composite foreign keys already
 * guarantee this at the database; this exists so the error names both sites instead of arriving
 * as `violates foreign key constraint "runs_version_fk"`.
 */
export function assertReferenceInScope(
  tableName: string,
  siteId: string,
  parent: Readonly<{ siteId?: unknown }> | null | undefined,
  parentDescription: string,
): void {
  if (parent === null || parent === undefined) return;
  if (parent.siteId !== siteId) {
    throw new CrossTenantWriteError(
      `${tableName} (${parentDescription})`,
      siteId,
      String(parent.siteId),
    );
  }
}
