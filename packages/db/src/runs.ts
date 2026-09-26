/**
 * Run persistence: checkpoints, events and model calls.
 *
 * The pipeline's `CheckpointStore` is synchronous (`save`, `latest`, `at`, `all`) because its
 * in-memory implementation is a Map. A database is not, and pretending otherwise would mean
 * either blocking the event loop or losing writes. So this module exposes the **async
 * repository**, and the pipeline wraps it in a store that buffers.
 *
 * That is a real trade-off and worth stating: the wrapper's `save()` returns before the row is
 * durable. A crash between a stage completing and the flush loses that checkpoint, and the run
 * resumes from the previous stage — which is exactly what a checkpoint is for, so the failure mode
 * is a repeated stage rather than a corrupt run. `flush()` is awaited at the points where
 * durability actually matters: before an interrupt that waits on a person, and at the end of a run.
 *
 * Every function here takes a `SiteScope`. There is no overload that takes a bare `siteId`, so a
 * caller cannot reach a row without going through the tenancy layer.
 */
import { and, desc, eq } from 'drizzle-orm';

import type { Database } from './client.js';
import { modelCalls, runEvents, runs } from './schema.js';
import { type SiteScope } from './tenancy.js';

export interface CheckpointRow {
  readonly run_id: string;
  readonly stage: string;
  readonly status: string;
  readonly state: unknown;
  readonly cost_usd: number;
  readonly iterations: number;
  readonly seed: number;
  readonly version_id?: string | null;
}

/**
 * Upsert on `(site_id, run_id)`. One row per run, holding the latest checkpoint — the stage
 * history lives in `run_events`, which is append-only, so the run row is a cursor rather than a
 * log and re-running a stage is an update rather than a duplicate.
 */
export async function saveCheckpoint(
  db: Database,
  scope: SiteScope,
  checkpoint: CheckpointRow,
): Promise<void> {
  const [row] = scope.rowsFor(runs, [
    {
      runId: checkpoint.run_id,
      versionId: checkpoint.version_id ?? null,
      stage: checkpoint.stage,
      status: checkpoint.status as never,
      checkpoint: checkpoint.state as never,
      costUsd: checkpoint.cost_usd,
      iterations: checkpoint.iterations,
      seed: checkpoint.seed,
    },
  ]);

  await db
    .insert(runs)
    .values(row as never)
    .onConflictDoUpdate({
      target: [runs.siteId, runs.runId],
      set: {
        stage: row?.stage as never,
        status: row?.status as never,
        checkpoint: row?.checkpoint as never,
        costUsd: row?.costUsd as never,
        iterations: row?.iterations as never,
        versionId: row?.versionId as never,
      },
    });
}

export async function loadRun(
  db: Database,
  scope: SiteScope,
  runId: string,
): Promise<typeof runs.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(runs)
    .where(scope.where(runs, eq(runs.runId, runId)))
    .limit(1);
  return rows[0];
}

/** Every run for a site, newest first. Scoped; there is no unscoped variant. */
export async function listRuns(
  db: Database,
  scope: SiteScope,
  limit = 50,
): Promise<(typeof runs.$inferSelect)[]> {
  return db.select().from(runs).where(scope.where(runs)).orderBy(desc(runs.createdAt)).limit(limit);
}

export interface EventRow {
  readonly event_id: string;
  readonly run_id: string;
  readonly kind: string;
  readonly payload?: unknown;
  readonly parent_id?: string | null;
}

/**
 * What to do when a row with this id is already present.
 *
 * Both answers are correct in different places, which is why it is a parameter rather than a
 * policy:
 *
 * - **`error`** (the default) is right *during* a run. Two different events sharing an id is a bug
 *   to surface, not a row to merge, and silently dropping the second would lose a real event.
 * - **`skip`** is right when **re-persisting a run that already succeeded**. The pipeline is
 *   deterministic: the same seed produces the same events with the same derived ids, so the row is
 *   not a different event, it is the same one. `persistRun` passes `skip` for exactly this reason —
 *   found by running `pnpm e2e:fixture` twice against one database, where the second run failed.
 *
 * Never `update`: these tables are append-only, and overwriting a log row is the thing that makes
 * a log worthless.
 */
export type IfExists = 'error' | 'skip';

/**
 * Append events. Batched into one statement: a stage can emit a dozen, and a round trip each would
 * make the log's cost proportional to how carefully the pipeline reports itself.
 */
export async function appendEvents(
  db: Database,
  scope: SiteScope,
  events: readonly EventRow[],
  options: { ifExists?: IfExists } = {},
): Promise<number> {
  if (events.length === 0) return 0;
  const rows = scope.rowsFor(
    runEvents,
    events.map((event) => ({
      eventId: event.event_id,
      runId: event.run_id,
      parentId: event.parent_id ?? null,
      kind: event.kind,
      payload: (event.payload ?? {}) as never,
    })),
  );
  const insert = db.insert(runEvents).values(rows as never);
  await (options.ifExists === 'skip'
    ? insert.onConflictDoNothing({ target: [runEvents.siteId, runEvents.eventId] })
    : insert);
  return rows.length;
}

export async function readEvents(
  db: Database,
  scope: SiteScope,
  runId: string,
): Promise<(typeof runEvents.$inferSelect)[]> {
  return db
    .select()
    .from(runEvents)
    .where(scope.where(runEvents, eq(runEvents.runId, runId)))
    .orderBy(runEvents.ts);
}

export interface ModelCallRowInput {
  readonly call_id: string;
  readonly run_id: string;
  readonly stage: string;
  readonly provider: string;
  readonly model: string;
  readonly schema_hash: string;
  readonly prompt_hash: string;
  readonly output_hash: string;
  readonly cost_usd: number;
  readonly duration_ms: number;
  readonly finish_reason: string;
  readonly attempts: number;
  readonly guardrail_codes: readonly string[];
}

/** One row per call, including memo hits and fallbacks: the audit is what was spent, and on what. */
export async function recordModelCalls(
  db: Database,
  scope: SiteScope,
  calls: readonly ModelCallRowInput[],
  options: { ifExists?: IfExists } = {},
): Promise<number> {
  if (calls.length === 0) return 0;
  const rows = scope.rowsFor(
    modelCalls,
    calls.map((call) => ({
      callId: call.call_id,
      runId: call.run_id,
      stage: call.stage,
      provider: call.provider,
      model: call.model,
      schemaHash: call.schema_hash,
      promptHash: call.prompt_hash,
      outputHash: call.output_hash,
      costUsd: call.cost_usd,
      durationMs: call.duration_ms,
      finishReason: call.finish_reason,
      attempts: call.attempts,
      guardrailCodes: [...call.guardrail_codes],
    })),
  );
  const insert = db.insert(modelCalls).values(rows as never);
  await (options.ifExists === 'skip'
    ? insert.onConflictDoNothing({ target: [modelCalls.siteId, modelCalls.callId] })
    : insert);
  return rows.length;
}

/** What a run actually spent, read back from the audit rows rather than from the run's own field. */
export async function spendForRun(
  db: Database,
  scope: SiteScope,
  runId: string,
): Promise<{ calls: number; costUsd: number }> {
  const rows = await db
    .select({ costUsd: modelCalls.costUsd })
    .from(modelCalls)
    .where(and(scope.where(modelCalls), eq(modelCalls.runId, runId)));
  return {
    calls: rows.length,
    costUsd: rows.reduce((total, row) => total + row.costUsd, 0),
  };
}
