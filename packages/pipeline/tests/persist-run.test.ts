import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  loadGateReport,
  loadRun,
  loadVersion,
  readEvents,
  scope,
  spendForRun,
  testDatabase,
  type Database,
  type TestDatabase,
} from '@ada/db';

import { persistRun } from '../src/postgres-store.js';
import { newRun, setEventClock, appendEvent, type PipelineState } from '../src/state.js';

/**
 * The persistence path, covered unconditionally.
 *
 * `pnpm e2e:fixture` persists only when `DATABASE_URL` is set, which is right — a developer without
 * Docker still needs the acceptance test to run. But an optional path is one that rots: the browser
 * pass sat unrun for a milestone on exactly that basis, and two source files were never committed
 * because nothing exercised them.
 *
 * So this runs on every `pnpm verify`, against Postgres-in-WASM. No service, no `DATABASE_URL`, and
 * the same SQL the real driver executes.
 */
let harness: TestDatabase;
let db: Database;

const SITE = 'ridgeline_roofing';

function fixtureState(runId: string): PipelineState {
  let state = newRun({
    run_id: runId,
    site_id: SITE,
    tenant_id: 'ada_demo',
    seed: 20260923,
    niche: 'roofing',
    registry: {},
    positioning: 'local_trust',
  });
  state = appendEvent(state, 'StageStarted', 'ingest', {});
  state = appendEvent(state, 'StageCompleted', 'ingest', {});
  return {
    ...state,
    cost_usd: 0.003,
    model_calls: [
      {
        call_id: 'c1',
        stage: 'beat_selection',
        provider: 'fake',
        model: 'obedient',
        schema_hash: 'a',
        prompt_hash: 'b',
        output_hash: 'c',
        cost_usd: 0.003,
        duration_ms: 12,
        finish_reason: 'stop',
        attempts: 1,
        guardrail_codes: [],
        memo_hit: false,
      },
    ],
  };
}

const input = (runId: string) => ({
  db,
  siteId: SITE,
  tenantId: 'ada_demo',
  niche: 'roofing',
  positioning: 'local_trust',
  runId,
  versionId: `v_${runId}`,
  state: fixtureState(runId),
  siteDefinition: { schema_version: 1, pages: { home: {} } },
  manifest: { decisions: [] },
  gapReport: { unlocks: [] },
  gate: { policyVersion: 'launch@1', checks: [], summary: { canShip: true } },
});

beforeAll(async () => {
  let tick = 0;
  setEventClock(() => new Date(Date.UTC(2026, 8, 23, 0, 0, tick++)).toISOString());

  // Postgres in WASM, migrated from the committed SQL — the same statements `drizzle-kit migrate`
  // runs against a real server.
  harness = await testDatabase();
  db = harness.db;
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe('persisting a run', () => {
  it('writes the site, version, run, logs and gate report', async () => {
    const result = await persistRun(input('r1'));
    expect(result.events).toBe(2);
    expect(result.modelCalls).toBe(1);
    expect(result.gateReportId).toBe('r1:gate');

    const siteScope = scope(SITE);
    // Read back rather than trusting the write. A persistence step that only writes can be
    // silently broken for weeks.
    expect((await loadVersion(db, siteScope, 'v_r1'))?.createdBy).toBe('pipeline');
    expect((await loadRun(db, siteScope, 'r1'))?.seed).toBe(20260923);
    expect(await readEvents(db, siteScope, 'r1')).toHaveLength(2);
    expect((await loadGateReport(db, siteScope, 'v_r1'))?.policyVer).toBe('launch@1');

    const spend = await spendForRun(db, siteScope, 'r1');
    expect(spend).toMatchObject({ calls: 1 });
    expect(spend.costUsd).toBeCloseTo(0.003);
  });

  it('is idempotent, because a deterministic run re-persists the same rows', async () => {
    // Found by running `pnpm e2e:fixture` twice against one database: the second run failed on a
    // duplicate event id. The pipeline is deterministic, so the same seed produces the same events
    // with the same derived ids — that is the reproducibility guarantee working, not a collision.
    await persistRun(input('r2'));
    await expect(persistRun(input('r2'))).resolves.toMatchObject({ versionId: 'v_r2' });

    // And it did not duplicate.
    expect(await readEvents(db, scope(SITE), 'r2')).toHaveLength(2);
    expect((await spendForRun(db, scope(SITE), 'r2')).calls).toBe(1);
  });

  it('writes a version as draft, never published', async () => {
    // Publishing is stage 16 and confirm-gated. A repository function that could publish as a side
    // effect of saving would route around the gate.
    await persistRun(input('r3'));
    expect((await loadVersion(db, scope(SITE), 'v_r3'))?.status).toBe('draft');
  });

  it('keeps the event tree, so a fan-out stage’s children stay attributable', async () => {
    const events = await readEvents(db, scope(SITE), 'r1');
    // Ids are namespaced by run: two runs emitting event 1 must not collide.
    expect(events.every((event) => event.eventId.startsWith('r1:'))).toBe(true);
  });

  it('does not leak another site’s run', async () => {
    await persistRun({ ...input('r4'), siteId: 'other_site' });
    expect(await loadRun(db, scope(SITE), 'r4')).toBeUndefined();
    expect(await loadRun(db, scope('other_site'), 'r4')).toBeDefined();
  });
});
