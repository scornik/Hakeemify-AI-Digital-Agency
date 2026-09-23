/**
 * The run orchestrator (ARCHITECTURE §5).
 *
 * Sixteen stages, each a pure `(state) => state` except the four model nodes. A checkpoint is
 * written after every stage, which is what makes three things work:
 *
 * - a failed gate resumes at `gate`, not at `ingest`;
 * - `WAITING_FOR_OWNER` is a real pause on the same run id, not a polling flag;
 * - the manifest can be re-derived from the recorded state without re-running anything.
 *
 * There is no agent framework underneath this (ARCHITECTURE §1.5). The useful part of the
 * frameworks — status enum, event log, dual budget, guardrail retry, interrupt/resume — is what
 * `state.ts` and `model/wrapper.ts` already are.
 */
import { evaluatePredicates } from '@ada/contract';
import {
  appendEvent,
  checkpoint,
  isTerminal,
  isWaiting,
  STAGES,
  type Checkpoint,
  type CheckpointStore,
  type PipelineState,
  type Stage,
} from './state.js';

export interface StageContext {
  /** Anything the stage implementations need; kept opaque to the runner. */
  readonly [key: string]: unknown;
}

export type StageFn = (
  state: PipelineState,
  context: StageContext,
) => Promise<PipelineState> | PipelineState;

export type StageMap = Partial<Record<Stage, StageFn>>;

export interface RunOptions {
  readonly store: CheckpointStore;
  readonly stages: StageMap;
  readonly context: StageContext;
  /** Stop after this stage, for tests and for the `plan` mode a reviewer might want. */
  readonly until?: Stage;
}

/** A stage that is not implemented yet is a no-op that records itself, not a crash. */
function defaultStage(stage: Stage): StageFn {
  return (state) => appendEvent(state, 'StageCompleted', stage, { implemented: false });
}

export function nextStage(stage: Stage): Stage | null {
  const index = STAGES.indexOf(stage);
  if (index < 0 || index >= STAGES.length - 1) return null;
  return STAGES[index + 1] as Stage;
}

/**
 * Run from the current stage until the run finishes, waits for a person, or hits a limit.
 *
 * The loop never retries a stage on its own. A stage that wants another attempt says so by
 * returning a state that is still at that stage with a non-terminal status, and the caller
 * decides — otherwise a bug becomes an infinite loop with a budget attached.
 */
export async function runFrom(initial: PipelineState, options: RunOptions): Promise<PipelineState> {
  let state: PipelineState = { ...initial, status: 'RUNNING' };

  for (;;) {
    const stage = state.stage;
    state = appendEvent(state, 'StageStarted', stage);

    const fn = options.stages[stage] ?? defaultStage(stage);
    try {
      state = await fn(state, options.context);
    } catch (error) {
      state = appendEvent(
        {
          ...state,
          status: 'ERROR',
          error: error instanceof Error ? error.message : String(error),
        },
        'RunFailed',
        stage,
        { message: error instanceof Error ? error.message : String(error) },
      );
      options.store.save(checkpoint(state));
      return state;
    }

    options.store.save(checkpoint(state));

    if (isTerminal(state.status)) return state;
    if (isWaiting(state.status)) return state;

    if (options.until === stage) return state;

    const next = nextStage(stage);
    if (next === null) {
      return { ...appendEvent(state, 'StageCompleted', stage), status: 'FINISHED' };
    }
    state = { ...state, stage: next };
  }
}

/**
 * Pause the run for a person. The question is recorded on the state so whoever picks it up knows
 * what is being asked, and the stage does not advance — resuming re-enters the same stage with
 * the answer in hand.
 */
export function interrupt(
  state: PipelineState,
  question: string,
  status: 'WAITING_FOR_OWNER' | 'WAITING_FOR_REVIEW' = 'WAITING_FOR_OWNER',
): PipelineState {
  return appendEvent({ ...state, status, question }, 'OwnerInterrupted', state.stage, { question });
}

export class ResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeError';
  }
}

/**
 * Resume a waiting run on the same run id, applying the answer. Refuses to resume a run that is
 * not waiting: a resume with no question is a lost answer, and silently ignoring it would be
 * worse than failing.
 */
export function resume(
  store: CheckpointStore,
  runId: string,
  apply: (state: PipelineState) => PipelineState,
): PipelineState {
  const latest = store.latest(runId);
  if (!latest) throw new ResumeError(`no checkpoint for run ${runId}`);
  if (!isWaiting(latest.status)) {
    throw new ResumeError(
      `run ${runId} is ${latest.status}, not waiting for anyone; there is nothing to resume`,
    );
  }

  const answered = apply(latest.state);
  const resumed = appendEvent(
    { ...answered, status: 'RUNNING', question: null },
    'OwnerResumed',
    latest.stage,
  );
  store.save(checkpoint(resumed));
  return resumed;
}

/** Rewind to a stage's checkpoint. Used by the repair loop to re-enter assembly after a swap. */
export function rewind(store: CheckpointStore, runId: string, stage: Stage): PipelineState {
  const found = store.at(runId, stage);
  if (!found) throw new ResumeError(`run ${runId} has no checkpoint at stage ${stage}`);
  return found.state;
}

// ---------------------------------------------------------------------------------------------
// Stage implementations that belong to the runner rather than to a domain module
// ---------------------------------------------------------------------------------------------

export interface PredicateStageInput {
  readonly predicates: readonly string[];
}

/** Stage 2. One evaluation pass; everything downstream reads the snapshot, never the registry. */
export function evaluatePredicatesStage(input: PredicateStageInput): StageFn {
  return (state) => {
    const snapshot = evaluatePredicates(input.predicates, state.registry);
    return appendEvent({ ...state, snapshot }, 'StageCompleted', 'evaluate_predicates', {
      evaluated: snapshot.length,
      satisfied: snapshot.filter((row) => row.result).length,
    });
  };
}

/**
 * Stage 4. Positioning is owner-declared and never inferred (v4 §6): a model guessing "premium"
 * for a budget operator misrepresents a business to its own customers, in its own voice. So the
 * run stops here rather than choosing.
 */
export function positioningStage(options: {
  supported: readonly string[];
  suggestion: string;
}): StageFn {
  return (state) => {
    if (state.positioning === null) {
      return interrupt(
        state,
        `Positioning must be declared by the owner. Supported for this niche: ${options.supported.join(', ')}. The playbook suggests ${options.suggestion}.`,
      );
    }
    if (!options.supported.includes(state.positioning)) {
      return appendEvent(
        {
          ...state,
          status: 'ERROR',
          error: `positioning "${state.positioning}" is not supported by this niche's playbook`,
        },
        'RunFailed',
        'positioning',
      );
    }
    return appendEvent(state, 'StageCompleted', 'positioning', { positioning: state.positioning });
  };
}

/** Record a budget stop as a first-class run outcome rather than an exception. */
export function budgetExceeded(state: PipelineState, reason: string): PipelineState {
  return appendEvent(
    { ...state, status: 'BUDGET_EXCEEDED', error: reason },
    'LimitReached',
    state.stage,
    { reason },
  );
}

export function stuck(state: PipelineState, reason: string): PipelineState {
  return appendEvent({ ...state, status: 'STUCK', error: reason }, 'LimitReached', state.stage, {
    reason,
  });
}

/** The history of a run, for the manifest and for anyone reading a failure afterwards. */
export function history(store: CheckpointStore, runId: string): readonly Checkpoint[] {
  return store.all(runId);
}
