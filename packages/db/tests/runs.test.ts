import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '../src/schema.js';
import {
  appendEvents,
  loadRun,
  readEvents,
  recordModelCalls,
  saveCheckpoint,
  spendForRun,
} from '../src/runs.js';
import { scope } from '../src/tenancy.js';
import type { Database } from '../src/client.js';

/**
 * The repository, against a real engine.
 *
 * `runs.ts` is where the tenancy layer and the schema meet, and the interesting question is not
 * whether a select compiles — it is whether a scoped query actually excludes another site's rows,
 * and whether an upsert replaces rather than duplicates. Both need SQL to have run.
 */
const sql = readFileSync(
  fileURLToPath(new URL('../migrations/0000_init.sql', import.meta.url)),
  'utf8',
);

const SITE = 'ridgeline';
const OTHER = 'someone_else';

let pg: PGlite;
let db: Database;

const checkpoint = (stage: string, cost = 0) => ({
  run_id: 'r1',
  stage,
  status: 'RUNNING',
  state: { stage },
  cost_usd: cost,
  iterations: 1,
  seed: 20260923,
});

beforeAll(async () => {
  pg = new PGlite();
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed !== '') await pg.exec(trimmed);
  }
  // `drizzle/pglite` rather than node-postgres: same query builder, same SQL, no socket.
  db = drizzle(pg, { schema }) as unknown as Database;

  await pg.exec(`
    INSERT INTO sites (site_id, tenant_id, niche) VALUES ('${SITE}', 't1', 'medical');
    INSERT INTO sites (site_id, tenant_id, niche) VALUES ('${OTHER}', 't2', 'medical');
  `);
}, 120_000);

afterAll(async () => {
  await pg?.close();
});

describe('checkpoints', () => {
  it('inserts on first save and updates on the next', async () => {
    await saveCheckpoint(db, scope(SITE), checkpoint('ingest'));
    await saveCheckpoint(db, scope(SITE), checkpoint('positioning', 0.004));

    const row = await loadRun(db, scope(SITE), 'r1');
    expect(row?.stage).toBe('positioning');
    expect(row?.costUsd).toBeCloseTo(0.004);

    // One row per run, not one per stage: the run row is a cursor and the history is in the log.
    const count = await pg.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM runs WHERE run_id = 'r1'`,
    );
    expect(count.rows[0]?.count).toBe(1);
  });

  it('does not find another site’s run', async () => {
    // The assertion the whole tenancy layer exists for, and the one that only a live query can
    // make: a forgotten filter returns this row instead of undefined.
    await saveCheckpoint(db, scope(OTHER), { ...checkpoint('ingest'), run_id: 'r_other' });
    expect(await loadRun(db, scope(SITE), 'r_other')).toBeUndefined();
    expect(await loadRun(db, scope(OTHER), 'r_other')).toBeDefined();
  });

  it('refuses to write a run into another site through a scope', async () => {
    // The scope stamps site_id, so the only way to reach this is to ask for it explicitly.
    expect(() =>
      scope(SITE).rowsFor(schema.runs, [{ runId: 'x', siteId: OTHER, stage: 'ingest', seed: 1 }]),
    ).not.toThrow();
    // …and the stamp wins, rather than the row's own claim.
    const [stamped] = scope(SITE).rowsFor(schema.runs, [{ runId: 'x', siteId: OTHER }]);
    expect(stamped?.siteId).toBe(SITE);
  });
});

describe('the event log', () => {
  it('appends in order and reads back scoped', async () => {
    await appendEvents(db, scope(SITE), [
      { event_id: 'e1', run_id: 'r1', kind: 'StageStarted', payload: { stage: 'ingest' } },
      { event_id: 'e2', run_id: 'r1', kind: 'StageCompleted', payload: { stage: 'ingest' } },
    ]);
    const events = await readEvents(db, scope(SITE), 'r1');
    expect(events.map((e) => e.kind)).toEqual(['StageStarted', 'StageCompleted']);
  });

  it('rejects a duplicate event id rather than merging it', async () => {
    // Two events sharing an id is a bug to surface, not a row to overwrite.
    let failed = false;
    try {
      await appendEvents(db, scope(SITE), [{ event_id: 'e1', run_id: 'r1', kind: 'StageStarted' }]);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it('writes nothing for an empty batch', async () => {
    expect(await appendEvents(db, scope(SITE), [])).toBe(0);
  });

  it('does not return another site’s events', async () => {
    const events = await readEvents(db, scope(OTHER), 'r1');
    expect(events).toEqual([]);
  });
});

describe('the model-call audit', () => {
  const call = (id: string, cost: number) => ({
    call_id: id,
    run_id: 'r1',
    stage: 'beat_selection',
    provider: 'ollama',
    model: 'qwen3',
    schema_hash: 'a',
    prompt_hash: 'b',
    output_hash: 'c',
    cost_usd: cost,
    duration_ms: 120,
    finish_reason: 'stop',
    attempts: 1,
    guardrail_codes: [],
  });

  it('records one row per call and sums what the run spent', async () => {
    await recordModelCalls(db, scope(SITE), [call('c1', 0.002), call('c2', 0.003)]);
    const spend = await spendForRun(db, scope(SITE), 'r1');
    expect(spend.calls).toBe(2);
    // Read back from the audit rows, not from the run's own cost field: if the two disagree, the
    // audit is the one that was written per call.
    expect(spend.costUsd).toBeCloseTo(0.005);
  });

  it('keeps guardrail codes as an array, not a joined string', async () => {
    await recordModelCalls(db, scope(SITE), [
      { ...call('c3', 0), guardrail_codes: ['ineligible_value', 'unknown_field'] },
    ]);
    const rows = await pg.query<{ guardrail_codes: string[] }>(
      `SELECT guardrail_codes FROM model_calls WHERE call_id = 'c3'`,
    );
    expect(rows.rows[0]?.guardrail_codes).toEqual(['ineligible_value', 'unknown_field']);
  });

  it('reports zero spend for a site that made no calls', async () => {
    expect(await spendForRun(db, scope(OTHER), 'r1')).toEqual({ calls: 0, costUsd: 0 });
  });
});
