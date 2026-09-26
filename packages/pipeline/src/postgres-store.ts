/**
 * The Postgres-backed checkpoint store.
 *
 * `CheckpointStore` is synchronous — `save`, `latest`, `at`, `all` — because the in-memory
 * implementation is a Map. A database is not synchronous, and the three ways to pretend otherwise
 * are all worse than admitting it:
 *
 * - **block the event loop** on every stage boundary;
 * - **change the interface to async**, which makes every stage in `build.ts` await a write it does
 *   not care about and turns a pure `(state) => state` into something that can fail for reasons
 *   unrelated to the build;
 * - **fire and forget**, and lose writes silently.
 *
 * So this store buffers. `save()` records the checkpoint in memory and enqueues a write;
 * `flush()` awaits the queue. The honest consequence, stated rather than buried: **`save()`
 * returning does not mean the row is durable.**
 *
 * That is acceptable for exactly one reason. A lost checkpoint means the run resumes from the
 * previous stage — which is what a checkpoint is *for*. The failure mode is a repeated stage, not
 * a corrupt run. It would not be acceptable for the audit rows, which is why `run_events` and
 * `model_calls` are written through `flush()` too and why `flush()` is awaited at the points where
 * durability is the whole point:
 *
 * - before an interrupt that waits on a person (they may not come back for a day);
 * - at the end of a run, successful or not.
 *
 * `errors` accumulates anything the queue could not write. A store that swallowed them would
 * report a persisted run that is not in the database, so `flush()` rejects and the caller decides.
 */
import {
  appendEvents,
  connect,
  recordModelCalls,
  saveCheckpoint,
  saveGateReport,
  saveVersion,
  scope,
  upsertSite,
  type Connection,
  type Database,
  type SiteScope,
} from '@ada/db';

import type {
  Checkpoint,
  CheckpointStore,
  ModelCallRecord,
  PipelineState,
  RunEvent,
  Stage,
} from './state.js';

export interface PostgresStoreOptions {
  readonly db: Database;
  readonly siteId: string;
  /** Written on `flush()`. Omitted, only checkpoints are persisted. */
  readonly runId?: string;
}

export class PostgresCheckpointStore implements CheckpointStore {
  private readonly rows = new Map<string, Checkpoint[]>();
  private readonly pending: (() => Promise<void>)[] = [];
  private readonly scope: SiteScope;
  readonly errors: Error[] = [];

  constructor(private readonly options: PostgresStoreOptions) {
    // Through the tenancy layer, not around it: there is no path in this class that touches a
    // table without a scope.
    this.scope = scope(options.siteId);
  }

  /**
   * Kept in memory *and* enqueued. The in-memory copy is what `latest`/`at`/`all` read, so the
   * synchronous half of the interface answers from the same data the writer will persist rather
   * than from a stale read.
   */
  save(checkpoint: Checkpoint): void {
    const list = this.rows.get(checkpoint.run_id) ?? [];
    const existing = list.findIndex((row) => row.stage === checkpoint.stage);
    if (existing >= 0) list[existing] = checkpoint;
    else list.push(checkpoint);
    this.rows.set(checkpoint.run_id, list);

    this.pending.push(async () => {
      await saveCheckpoint(this.options.db, this.scope, {
        run_id: checkpoint.run_id,
        stage: checkpoint.stage,
        status: checkpoint.status,
        state: checkpoint,
        // Read off the run state the checkpoint carries, not off the checkpoint: the checkpoint
        // is an envelope, and duplicating these onto it would give two places to disagree.
        cost_usd: checkpoint.state.cost_usd,
        iterations: list.length,
        seed: checkpoint.state.seed,
      });
    });
  }

  latest(runId: string): Checkpoint | undefined {
    return this.rows.get(runId)?.at(-1);
  }

  at(runId: string, stage: Stage): Checkpoint | undefined {
    return this.rows.get(runId)?.find((row) => row.stage === stage);
  }

  all(runId: string): readonly Checkpoint[] {
    return this.rows.get(runId) ?? [];
  }

  /** Enqueue the append-only rows. Never written eagerly: a stage emits a dozen events. */
  recordEvents(runId: string, events: readonly RunEvent[]): void {
    if (events.length === 0) return;
    this.pending.push(async () => {
      await appendEvents(
        this.options.db,
        this.scope,
        events.map((event, index) => ({
          // Derived rather than random, so replaying the same run produces the same ids and a
          // double flush is a primary-key conflict instead of a duplicated log.
          event_id: `${runId}:${index}:${event.kind}`,
          run_id: runId,
          kind: event.kind,
          payload: event,
        })),
      );
    });
  }

  recordModelCalls(runId: string, calls: readonly ModelCallRecord[]): void {
    if (calls.length === 0) return;
    this.pending.push(async () => {
      await recordModelCalls(
        this.options.db,
        this.scope,
        calls.map((call, index) => ({
          call_id: `${runId}:${index}`,
          run_id: runId,
          stage: call.stage,
          provider: call.provider,
          model: call.model,
          schema_hash: call.schema_hash,
          prompt_hash: call.prompt_hash,
          output_hash: call.output_hash,
          cost_usd: call.cost_usd,
          duration_ms: call.duration_ms,
          finish_reason: call.finish_reason,
          attempts: call.attempts,
          guardrail_codes: call.guardrail_codes,
        })),
      );
    });
  }

  /** Writes queued in order. Rejects with the first failure, having attempted them all. */
  async flush(): Promise<void> {
    const queued = this.pending.splice(0, this.pending.length);
    for (const write of queued) {
      try {
        await write();
      } catch (error) {
        this.errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    const first = this.errors[0];
    if (first !== undefined) {
      throw new Error(
        `${this.errors.length} write(s) to Postgres failed; the run is not fully persisted. ` +
          `First: ${first.message}`,
      );
    }
  }

  get pendingWrites(): number {
    return this.pending.length;
  }
}

/**
 * Open a connection and hand back a store plus the closer.
 *
 * Deliberately not a singleton. The pipeline is a batch process: one run, one connection, closed
 * when it finishes. A module-level pool would connect during a unit test.
 */
export function postgresStore(options: { siteId: string; url?: string; runId?: string }): {
  store: PostgresCheckpointStore;
  connection: Connection;
} {
  const connection = connect(options.url === undefined ? {} : { url: options.url });
  return {
    store: new PostgresCheckpointStore({
      db: connection.db,
      siteId: options.siteId,
      ...(options.runId === undefined ? {} : { runId: options.runId }),
    }),
    connection,
  };
}

// ---------------------------------------------------------------------------------------------
// Persisting a completed run
// ---------------------------------------------------------------------------------------------

export interface PersistRunInput {
  readonly db: Database;
  readonly siteId: string;
  readonly tenantId: string;
  readonly niche: string;
  readonly positioning: string | null;
  readonly runId: string;
  readonly versionId: string;
  readonly state: PipelineState;
  readonly siteDefinition: unknown;
  readonly manifest: unknown;
  readonly gapReport: unknown;
  readonly schemaVersion?: number;
  /** Omitted when the gate has not run. */
  readonly gate?: { policyVersion: string; checks: unknown; summary: unknown };
}

export interface PersistRunResult {
  readonly versionId: string;
  readonly events: number;
  readonly modelCalls: number;
  readonly gateReportId: string | null;
}

/**
 * Write everything a finished run produced, in dependency order.
 *
 * Order is not stylistic: the composite foreign keys mean a version cannot precede its site, and a
 * run event cannot precede its run. Getting it wrong does not corrupt anything — the database
 * refuses the row — but it fails in the middle, leaving a half-written run. So the order is
 * explicit here rather than emergent from whatever the caller happened to do first.
 *
 * Not wrapped in a transaction, and that is a choice worth stating: a partially persisted run is
 * recoverable (every write is an upsert keyed on ids the run already owns, so re-running persists
 * the rest), whereas a transaction spanning this much work holds a connection for the length of a
 * build. If a caller needs atomicity it can open one; the default should not.
 */
export async function persistRun(input: PersistRunInput): Promise<PersistRunResult> {
  const siteScope = scope(input.siteId);

  // 1. The site, because every other table references it.
  await upsertSite(input.db, siteScope, {
    site_id: input.siteId,
    tenant_id: input.tenantId,
    niche: input.niche,
    positioning: input.positioning,
  });

  // 2. The version: what rendered, why, and what the owner could change.
  await saveVersion(input.db, siteScope, {
    version_id: input.versionId,
    site_definition: input.siteDefinition,
    manifest: input.manifest,
    gap_report: input.gapReport,
    schema_version: input.schemaVersion ?? 1,
    created_by: 'pipeline',
  });

  // 3. The run row, which references the version.
  await saveCheckpoint(input.db, siteScope, {
    run_id: input.runId,
    stage: input.state.stage,
    status: input.state.status,
    state: input.state,
    cost_usd: input.state.cost_usd,
    iterations: input.state.events.length,
    seed: input.state.seed,
    version_id: input.versionId,
  });

  // 4. The append-only logs.
  const events = await appendEvents(
    input.db,
    siteScope,
    input.state.events.map((event) => ({
      // The run's own event id, namespaced by run. Derived rather than random so persisting the
      // same run twice is an upsert conflict rather than a duplicated log.
      event_id: `${input.runId}:${event.id}`,
      run_id: input.runId,
      parent_id: event.parentId === null ? null : `${input.runId}:${event.parentId}`,
      kind: event.kind,
      payload: { stage: event.stage, ts: event.ts, ...event.payload },
    })),
    // Re-persisting a run that already succeeded is legitimate: the pipeline is deterministic, so
    // the same seed produces the same events with the same derived ids. Without this, running
    // `pnpm e2e:fixture` twice against one database failed on the second.
    { ifExists: 'skip' },
  );

  const modelCalls = await recordModelCalls(
    input.db,
    siteScope,
    input.state.model_calls.map((call) => ({
      call_id: `${input.runId}:${call.call_id}`,
      run_id: input.runId,
      stage: call.stage,
      provider: call.provider,
      model: call.model,
      schema_hash: call.schema_hash,
      prompt_hash: call.prompt_hash,
      output_hash: call.output_hash,
      cost_usd: call.cost_usd,
      duration_ms: call.duration_ms,
      finish_reason: call.finish_reason,
      attempts: call.attempts,
      // Memo hits are recorded too: the audit answers "what did this run do", and a hit is a
      // decision taken without spending, which is worth being able to see.
      guardrail_codes: call.guardrail_codes,
    })),
    { ifExists: 'skip' },
  );

  // 5. The gate report, last, because it is the only part that can legitimately be absent.
  let gateReportId: string | null = null;
  if (input.gate !== undefined) {
    gateReportId = `${input.runId}:gate`;
    await saveGateReport(input.db, siteScope, {
      report_id: gateReportId,
      version_id: input.versionId,
      policy_ver: input.gate.policyVersion,
      checks: input.gate.checks,
      summary: input.gate.summary,
    });
  }

  return { versionId: input.versionId, events, modelCalls, gateReportId };
}
