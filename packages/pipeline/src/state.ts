/**
 * Run state and the event log (ARCHITECTURE §5).
 *
 * No agent framework (§1.5). The pipeline is a linear DAG with four constrained model calls, so
 * what the frameworks contribute is a handful of primitives rather than a runtime: an explicit
 * status enum with a human-wait state, a persisted snapshot per stage, an append-only event log,
 * and bounded retries. That is what this file is.
 *
 * Every stage is `(state) => state`. The checkpoint after each one is what makes a failed gate
 * resumable from the gate rather than from ingest, and what makes `WAITING_FOR_OWNER` a real
 * pause rather than a polling flag.
 */
import type { PredicateSnapshot } from '@ada/contract';

export const RUN_STATUSES = [
  'IDLE',
  'RUNNING',
  /** The owner must declare positioning, or close a blocking gap. The run stops here. */
  'WAITING_FOR_OWNER',
  /** A reviewer must sign off `needs_review` gate rows. */
  'WAITING_FOR_REVIEW',
  'FINISHED',
  'ERROR',
  /** The same rejected choice was proposed twice, or a repair repeated. */
  'STUCK',
  'BUDGET_EXCEEDED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export function isTerminal(status: RunStatus): boolean {
  return (
    status === 'FINISHED' ||
    status === 'ERROR' ||
    status === 'STUCK' ||
    status === 'BUDGET_EXCEEDED'
  );
}

/** A run is waiting on a person, not on a machine. Resumption needs an answer, not a retry. */
export function isWaiting(status: RunStatus): boolean {
  return status === 'WAITING_FOR_OWNER' || status === 'WAITING_FOR_REVIEW';
}

export const STAGES = [
  'ingest',
  'evaluate_predicates',
  'playbook',
  'positioning',
  'creative_direction',
  'compat_filter',
  'beat_selection',
  'arrangement',
  'assemble',
  'populate',
  'anti_slop',
  'render',
  'gate',
  'manifest',
  'gap_report',
  'publish',
] as const;
export type Stage = (typeof STAGES)[number];

export type RunEventKind =
  | 'StageStarted'
  | 'StageCompleted'
  | 'ModelCallRequested'
  | 'ModelCallReturned'
  | 'GuardrailFailed'
  | 'SubstitutionApplied'
  | 'GateRan'
  | 'OwnerInterrupted'
  | 'OwnerResumed'
  | 'LimitReached'
  | 'RunFailed';

export interface RunEvent {
  readonly id: number;
  /** The event this one followed from, so the log is a tree rather than a flat list. */
  readonly parentId: number | null;
  readonly kind: RunEventKind;
  readonly stage: Stage | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly ts: string;
}

export interface EligibleSets {
  readonly positions: readonly string[];
  readonly archetypes: readonly string[];
  readonly design_systems: readonly string[];
  readonly art_directions: readonly string[];
  readonly variants: readonly string[];
  /** variant id -> the arrangements of that variant the registry can satisfy. */
  readonly arrangements: Readonly<Record<string, readonly string[]>>;
}

export interface CreativeDirection {
  readonly design_system_id: string;
  readonly art_direction_id: string;
  readonly page_archetype: string;
}

export interface BeatChoice {
  readonly beat_id: string;
  readonly variant_id: string;
  readonly family: string;
  readonly rhythm_role: string;
}

export interface ArrangementChoice {
  readonly instance_id: string;
  readonly arrangement_id: string;
}

/** Recorded whenever assembly or the gate swaps one choice for another. */
export interface Substitution {
  readonly stage: Stage;
  readonly from: string;
  readonly to: string;
  /** A machine code, not prose: the manifest templates its sentence from this. */
  readonly reason: string;
}

export interface ModelCallRecord {
  readonly call_id: string;
  readonly stage: Stage;
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
  readonly memo_hit: boolean;
}

export interface Budgets {
  readonly max_model_calls: number;
  readonly max_cost_usd: number;
  /**
   * Wall clock for the whole run. A dollar ceiling alone stops guarding anything the moment a
   * local model answers a call: Ollama costs $0.00 and can take ninety seconds, so a run that
   * spends nothing can still hang forever. Cost and time are different resources and each needs
   * its own ceiling.
   */
  readonly max_wall_clock_ms: number;
}

export interface PipelineState {
  readonly run_id: string;
  readonly site_id: string;
  readonly tenant_id: string;
  readonly stage: Stage;
  readonly status: RunStatus;
  readonly seed: number;

  readonly registry: unknown;
  readonly snapshot: PredicateSnapshot;
  readonly eligible: EligibleSets;

  readonly niche: string;
  readonly playbook_id: string | null;
  /** Owner-declared. Never inferred: the run interrupts instead. */
  readonly positioning: string | null;

  readonly creative_direction: CreativeDirection | null;
  readonly beats: readonly BeatChoice[];
  readonly arrangements: readonly ArrangementChoice[];
  readonly site_definition: unknown;

  readonly substitutions: readonly Substitution[];
  readonly model_calls: readonly ModelCallRecord[];
  readonly events: readonly RunEvent[];

  readonly budgets: Budgets;
  readonly cost_usd: number;

  /** Set when the run is waiting on a person. */
  readonly question: string | null;
  readonly error: string | null;
}

export interface NewRunInput {
  readonly run_id: string;
  readonly site_id: string;
  readonly tenant_id: string;
  readonly seed: number;
  readonly niche: string;
  readonly registry: unknown;
  readonly positioning?: string | null;
  readonly budgets?: Budgets;
}

/**
 * Deliberately the smallest ceiling a fixture build fits under, not a costed figure. A default
 * is what runs when nobody thought about it, so it should be the number that makes a runaway
 * cheap — raise it per run, do not raise it here.
 *
 * A fixture build makes three calls and spends about $0.003, so 24 calls is eight times the
 * headroom it needs.
 */
export const DEFAULT_BUDGETS: Budgets = {
  max_model_calls: 24,
  max_cost_usd: 0.5,
  max_wall_clock_ms: 300_000,
};

export class BudgetConfigError extends Error {
  constructor(variable: string, value: string, expected: string) {
    super(`${variable}=${JSON.stringify(value)} is not ${expected}`);
    this.name = 'BudgetConfigError';
  }
}

const BUDGET_ENV = {
  max_model_calls: 'ADA_MAX_MODEL_CALLS',
  max_cost_usd: 'ADA_MAX_COST_USD',
  max_wall_clock_ms: 'ADA_MAX_WALL_CLOCK_MS',
} as const satisfies Record<keyof Budgets, string>;

/**
 * Resolve the ceilings for one run: an explicit override wins, then the environment, then the
 * default. Set `ADA_MAX_COST_USD=10` to raise the ceiling for a single run without editing code.
 *
 * A malformed value throws rather than falling back to the default. Silently ignoring
 * `ADA_MAX_COST_USD=ten` would run the build at a ceiling the operator did not choose and
 * believes they raised, which is the one outcome a spend guard must not have.
 */
export function resolveBudgets(
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: Partial<Budgets> = {},
): Budgets {
  const resolved = { ...DEFAULT_BUDGETS };

  for (const key of Object.keys(BUDGET_ENV) as (keyof Budgets)[]) {
    const override = overrides[key];
    if (override !== undefined) {
      if (!Number.isFinite(override) || override <= 0) {
        throw new BudgetConfigError(key, String(override), 'a positive, finite number');
      }
      resolved[key] = override;
      continue;
    }

    const raw = env[BUDGET_ENV[key]];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new BudgetConfigError(BUDGET_ENV[key], raw, 'a positive, finite number');
    }
    resolved[key] = parsed;
  }

  return resolved;
}

export function newRun(input: NewRunInput): PipelineState {
  return {
    run_id: input.run_id,
    site_id: input.site_id,
    tenant_id: input.tenant_id,
    stage: 'ingest',
    status: 'IDLE',
    seed: input.seed,
    registry: input.registry,
    snapshot: [],
    eligible: {
      positions: [],
      archetypes: [],
      design_systems: [],
      art_directions: [],
      variants: [],
      arrangements: {},
    },
    niche: input.niche,
    playbook_id: null,
    positioning: input.positioning ?? null,
    creative_direction: null,
    beats: [],
    arrangements: [],
    site_definition: null,
    substitutions: [],
    model_calls: [],
    events: [],
    budgets: input.budgets ?? DEFAULT_BUDGETS,
    cost_usd: 0,
    question: null,
    error: null,
  };
}

let clock = (): string => new Date().toISOString();

/** Test seam: event timestamps are the one non-deterministic thing in an otherwise pure run. */
export function setEventClock(fn: () => string): void {
  clock = fn;
}

export function appendEvent(
  state: PipelineState,
  kind: RunEventKind,
  stage: Stage | null,
  payload: Readonly<Record<string, unknown>> = {},
): PipelineState {
  const last = state.events.at(-1);
  const event: RunEvent = {
    id: (last?.id ?? 0) + 1,
    parentId: last?.id ?? null,
    kind,
    stage,
    payload,
    ts: clock(),
  };
  return { ...state, events: [...state.events, event] };
}

/**
 * The persisted checkpoint: everything needed to resume, and nothing that cannot be serialised.
 * One row per (run_id, stage).
 */
export interface Checkpoint {
  readonly run_id: string;
  readonly stage: Stage;
  readonly status: RunStatus;
  readonly state: PipelineState;
  readonly ts: string;
}

export function checkpoint(state: PipelineState): Checkpoint {
  return {
    run_id: state.run_id,
    stage: state.stage,
    status: state.status,
    state,
    ts: clock(),
  };
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): void;
  latest(runId: string): Checkpoint | undefined;
  at(runId: string, stage: Stage): Checkpoint | undefined;
  all(runId: string): readonly Checkpoint[];
}

/** In-memory store. The Postgres one has the same interface and the same semantics. */
export class MemoryCheckpointStore implements CheckpointStore {
  private readonly rows = new Map<string, Checkpoint[]>();

  save(cp: Checkpoint): void {
    const list = this.rows.get(cp.run_id) ?? [];
    // One row per (run_id, stage): re-running a stage replaces its checkpoint.
    const existing = list.findIndex((row) => row.stage === cp.stage);
    if (existing >= 0) list[existing] = cp;
    else list.push(cp);
    this.rows.set(cp.run_id, list);
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
}
