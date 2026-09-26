import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  AppendOnlyViolationError,
  CrossTenantTableError,
  CrossTenantWriteError,
  MissingSiteIdError,
  assertReferenceInScope,
  assertRowInScope,
  scope,
} from '../src/tenancy.js';
import { diversityLedger, facts, priors, runEvents, runs, siteVersions } from '../src/schema.js';

/** Render a fragment to real SQL, which is the only assertion that says what will be executed. */
function render(fragment: SQL): { sql: string; params: unknown[] } {
  const query = new PgDialect().sqlToQuery(fragment);
  return { sql: query.sql, params: query.params };
}

const SITE = 'ridgeline_roofing';
const OTHER = 'someone_else';

describe('scoping', () => {
  it('binds a handle to one site', () => {
    expect(scope(SITE).siteId).toBe(SITE);
  });

  it('refuses an empty site id rather than scoping to everything', () => {
    // A handle scoped to '' would filter on '' and quietly return nothing — or, with the filter
    // optimised away, everything.
    expect(() => scope('')).toThrow(MissingSiteIdError);
    expect(() => scope('   ')).toThrow(MissingSiteIdError);
  });

  it('produces a where fragment that names the site', () => {
    const { sql, params } = render(scope(SITE).where(facts));
    expect(sql).toContain('"site_id"');
    // Parameterised, not interpolated: a site id is untrusted input like any other.
    expect(sql).toContain('$1');
    expect(params).toEqual([SITE]);
  });

  it('composes with an extra predicate without dropping the site filter', () => {
    const inner = scope(SITE).where(facts);
    const { sql, params } = render(scope(SITE).where(facts, inner));
    // Both halves present: composing must narrow the query, never replace the scope.
    expect(sql.match(/"site_id"/g)?.length).toBe(2);
    expect(params).toEqual([SITE, SITE]);
  });
});

describe('writes', () => {
  it('stamps site_id so a caller cannot omit it', () => {
    // Required-and-checked would mean every call site repeats the id, and one of them will
    // eventually repeat the wrong variable.
    const [row] = scope(SITE).rowsFor(facts, [{ factId: 'f_phone', path: 'contact.phone' }]);
    expect(row).toMatchObject({ siteId: SITE, factId: 'f_phone' });
  });

  it('overwrites a row that names a different site rather than trusting it', () => {
    const [row] = scope(SITE).rowsFor(facts, [{ factId: 'f', siteId: OTHER }]);
    expect(row?.siteId).toBe(SITE);
  });

  it('rejects a row with no site id at all', () => {
    expect(() => assertRowInScope('facts', SITE, { factId: 'f' })).toThrow(MissingSiteIdError);
    expect(() => assertRowInScope('facts', SITE, { factId: 'f', siteId: '' })).toThrow(
      MissingSiteIdError,
    );
  });

  it('rejects a row belonging to another site, and names both', () => {
    let message = '';
    try {
      assertRowInScope('facts', SITE, { siteId: OTHER });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain(SITE);
    expect(message).toContain(OTHER);
    // The advice matters: the instinct on seeing this error is to relax the check.
    expect(message).toContain('it is two rows');
  });
});

describe('references', () => {
  it('accepts a parent in the same site', () => {
    expect(() =>
      assertReferenceInScope('runs', SITE, { siteId: SITE }, 'version_id'),
    ).not.toThrow();
  });

  it('rejects a parent in another site', () => {
    // The composite foreign keys already stop this at the database. This exists so the message
    // names both sites instead of arriving as `violates foreign key constraint "runs_version_fk"`.
    expect(() => assertReferenceInScope('runs', SITE, { siteId: OTHER }, 'version_id')).toThrow(
      CrossTenantWriteError,
    );
  });

  it('treats an absent parent as fine, because the column is nullable', () => {
    expect(() => assertReferenceInScope('runs', SITE, null, 'version_id')).not.toThrow();
    expect(() => assertReferenceInScope('runs', SITE, undefined, 'version_id')).not.toThrow();
  });
});

describe('append-only enforcement', () => {
  it('refuses to update or delete a log', () => {
    for (const operation of ['updated', 'deleted'] as const) {
      expect(() => scope(SITE).assertMutable(runEvents, operation)).toThrow(
        AppendOnlyViolationError,
      );
    }
  });

  it('explains what the log is for, not just that it is locked', () => {
    let message = '';
    try {
      scope(SITE).assertMutable(runEvents, 'updated');
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('audit log');
  });

  it('allows updates to the tables that are genuinely mutable', () => {
    for (const table of [runs, siteVersions, facts]) {
      expect(() => scope(SITE).assertMutable(table, 'updated')).not.toThrow();
    }
  });
});

describe('the cross-tenant exceptions', () => {
  it('refuses to reach priors through a site-scoped handle', () => {
    // Priors are learned across tenants — that is what makes them worth having — so reaching them
    // through a site scope means somebody has misunderstood what they are.
    expect(() => scope(SITE).where(priors)).toThrow(CrossTenantTableError);
    expect(() => scope(SITE).where(diversityLedger)).toThrow(CrossTenantTableError);
  });

  it('says to put nothing identifying in them', () => {
    let message = '';
    try {
      scope(SITE).where(priors);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('nothing identifying');
  });

  it('refuses to write to them through a scope as well as read', () => {
    expect(() => scope(SITE).rowsFor(priors, [{ arrangementId: 'a' }])).toThrow(
      CrossTenantTableError,
    );
  });
});
