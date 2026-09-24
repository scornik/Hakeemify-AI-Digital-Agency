import { describe, expect, it } from 'vitest';

import {
  MemoryMemoStore,
  callRecord,
  coerceSelection,
  memoKey,
  select,
  validateSelection,
  type BudgetLedger,
  type SelectionRequest,
} from '../src/model/wrapper.js';
import {
  expensiveProvider,
  obedientProvider,
  scriptedProvider,
  stubbornProvider,
} from '../src/model/fake.js';
import {
  BudgetConfigError,
  DEFAULT_BUDGETS,
  MemoryCheckpointStore,
  newRun,
  resolveBudgets,
  setEventClock,
  type PipelineState,
} from '../src/state.js';
import {
  ResumeError,
  budgetExceeded,
  evaluatePredicatesStage,
  interrupt,
  nextStage,
  positioningStage,
  resume,
  runFrom,
  rewind,
  stuck,
} from '../src/run.js';

// Event timestamps are the one non-deterministic thing in an otherwise pure run.
let tick = 0;
setEventClock(() => new Date(Date.UTC(2026, 8, 23, 0, 0, tick++)).toISOString());

const ledger = (overrides: Partial<BudgetLedger> = {}): BudgetLedger => ({
  calls: 0,
  cost_usd: 0,
  max_calls: 8,
  max_cost_usd: 1,
  started_at_ms: 0,
  max_wall_clock_ms: 60_000,
  now: () => 0,
  ...overrides,
});

const request = (overrides: Partial<SelectionRequest> = {}): SelectionRequest => ({
  stage: 'creative_direction',
  fields: {
    design_system_id: ['reference_v1', 'grounded_v2'],
    page_archetype: ['service_clarity', 'authority'],
  },
  promptFragments: ['base', 'niche:roofing'],
  seed: 20260923,
  fallback: { design_system_id: 'reference_v1', page_archetype: 'service_clarity' },
  ...overrides,
});

describe('selection validation', () => {
  it('accepts a value from the eligible set', () => {
    const result = validateSelection({ a: 'x' }, { a: ['x', 'y'] });
    expect(result).toEqual({ ok: true, value: { a: 'x' } });
  });

  it('rejects a value outside the eligible set', () => {
    const result = validateSelection({ a: 'z' }, { a: ['x'] });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.failures[0]?.code).toBe('ineligible_value');
  });

  it('rejects a missing field and an unexpected one', () => {
    const missing = validateSelection({}, { a: ['x'] });
    expect(missing.ok === false && missing.failures[0]?.code).toBe('missing_field');
    const extra = validateSelection({ a: 'x', b: 'y' }, { a: ['x'] });
    expect(extra.ok === false && extra.failures[0]?.code).toBe('unknown_field');
  });

  it('rejects a non-object', () => {
    for (const value of [null, [], 'x', 3]) {
      const result = validateSelection(value, { a: ['x'] });
      expect(result.ok === false && result.failures[0]?.code).toBe('not_an_object');
    }
  });
});

describe('coercion', () => {
  it('repairs whitespace and case without asking again, and records what it did', () => {
    const { value, coercions } = coerceSelection(
      { a: ' x ', b: 'SERVICE_CLARITY' },
      { a: ['x'], b: ['service_clarity'] },
    );
    expect(value).toEqual({ a: 'x', b: 'service_clarity' });
    expect(coercions).toHaveLength(2);
    expect(coercions[0]).toMatch(/trimmed whitespace/);
  });

  it('leaves a genuinely wrong value alone rather than guessing', () => {
    const { value, coercions } = coerceSelection({ a: 'something_else' }, { a: ['x'] });
    expect(value).toEqual({ a: 'something_else' });
    expect(coercions).toEqual([]);
  });

  it('passes non-objects through untouched', () => {
    expect(coerceSelection('nope', { a: ['x'] })).toEqual({ value: 'nope', coercions: [] });
  });
});

describe('the memo key', () => {
  it('is stable under eligible-set ordering', () => {
    const a = memoKey(request({ fields: { x: ['b', 'a'] } }));
    const b = memoKey(request({ fields: { x: ['a', 'b'] } }));
    expect(a).toBe(b);
  });

  it('changes when the eligible set, the prompt or the seed changes', () => {
    const base = memoKey(request());
    expect(memoKey(request({ seed: 1 }))).not.toBe(base);
    expect(memoKey(request({ promptFragments: ['different'] }))).not.toBe(base);
    expect(memoKey(request({ fields: { design_system_id: ['reference_v1'] } }))).not.toBe(base);
  });

  it('excludes the model, so a provider change does not silently redecide', async () => {
    const memo = new MemoryMemoStore();
    const first = await select(request(), {
      provider: obedientProvider('provider-a'),
      memo,
      ledger: ledger(),
    });
    const second = await select(request(), {
      provider: obedientProvider('provider-b'),
      memo,
      ledger: ledger(),
    });
    expect(second.kind).toBe('selected');
    expect(second.kind === 'selected' && second.memo_hit).toBe(true);
    expect('value' in second && second.value).toEqual('value' in first ? first.value : null);
  });
});

describe('the model-call wrapper', () => {
  it('returns a valid selection and charges the ledger', async () => {
    const book = ledger();
    const outcome = await select(request(), {
      provider: obedientProvider(),
      memo: new MemoryMemoStore(),
      ledger: book,
    });
    expect(outcome.kind).toBe('selected');
    expect(book.calls).toBe(1);
    expect(book.cost_usd).toBeCloseTo(0.001);
  });

  it('is reproducible: the same seed always selects the same thing', async () => {
    const one = await select(request(), {
      provider: obedientProvider(),
      memo: new MemoryMemoStore(),
      ledger: ledger(),
    });
    const two = await select(request(), {
      provider: obedientProvider(),
      memo: new MemoryMemoStore(),
      ledger: ledger(),
    });
    expect('value' in one && one.value).toEqual('value' in two ? two.value : null);
  });

  it('re-asks after unparseable JSON, then succeeds', async () => {
    const outcome = await select(request(), {
      provider: scriptedProvider([{ text: 'not json at all' }]),
      memo: new MemoryMemoStore(),
      ledger: ledger(),
    });
    expect(outcome.kind).toBe('selected');
    expect(outcome.kind === 'selected' && outcome.attempts).toBe(2);
    expect(outcome.kind === 'selected' && outcome.guardrails[0]?.code).toBe('unparseable_json');
  });

  it('treats a truncated response as a hard failure, never a partial accept', async () => {
    const outcome = await select(request(), {
      provider: scriptedProvider([
        { text: '{"design_system_id":"refere', finish_reason: 'length' },
      ]),
      memo: new MemoryMemoStore(),
      ledger: ledger(),
    });
    expect(outcome.kind).toBe('fallback');
    expect(outcome.kind === 'fallback' && outcome.guardrails.map((g) => g.code)).toContain(
      'truncated_output',
    );
  });

  it('falls back deterministically after the re-ask budget', async () => {
    // A provider that names two different ineligible values, so stuck detection does not fire.
    const outcome = await select(request(), {
      provider: scriptedProvider([
        { text: '{"design_system_id":"a","page_archetype":"b"}' },
        { text: '{"design_system_id":"c","page_archetype":"d"}' },
        { text: '{"design_system_id":"e","page_archetype":"f"}' },
      ]),
      memo: new MemoryMemoStore(),
      ledger: ledger(),
    });
    expect(outcome.kind).toBe('fallback');
    expect(outcome.kind === 'fallback' && outcome.value).toEqual({
      design_system_id: 'reference_v1',
      page_archetype: 'service_clarity',
    });
  });

  it('terminates rather than retrying when the same rejected id comes back twice', async () => {
    const book = ledger();
    const outcome = await select(request(), {
      provider: stubbornProvider(),
      memo: new MemoryMemoStore(),
      ledger: book,
    });
    expect(outcome.kind).toBe('stuck');
    expect(outcome.kind === 'stuck' && outcome.reason).toMatch(/re-proposed the rejected value/);
    // It stopped on the second attempt instead of spending the whole re-ask budget.
    expect(book.calls).toBe(2);
  });

  it('stops at the call ceiling', async () => {
    const book = ledger({ calls: 8, max_calls: 8 });
    const outcome = await select(request(), {
      provider: obedientProvider(),
      memo: new MemoryMemoStore(),
      ledger: book,
    });
    expect(outcome.kind).toBe('budget_exceeded');
    expect(outcome.kind === 'budget_exceeded' && outcome.reason).toMatch(/8 model calls/);
  });

  it('stops at the USD ceiling', async () => {
    const book = ledger({ max_cost_usd: 0.5, max_calls: 100 });
    const outcome = await select(request(), {
      provider: expensiveProvider(0.75),
      memo: new MemoryMemoStore(),
      ledger: book,
    });
    // The first call is permitted and charges; the ceiling stops the run after it.
    expect(book.cost_usd).toBeGreaterThan(0.5);
    const second = await select(request({ seed: 7 }), {
      provider: expensiveProvider(0.75),
      memo: new MemoryMemoStore(),
      ledger: book,
    });
    expect(second.kind).toBe('budget_exceeded');
    expect(second.kind === 'budget_exceeded' && second.reason).toMatch(/\$0\.5/);
    expect(outcome.kind).toBe('selected');
  });

  it('refuses a fallback that is not itself eligible', async () => {
    await expect(
      select(
        request({ fallback: { design_system_id: 'nope', page_archetype: 'service_clarity' } }),
        {
          provider: obedientProvider(),
          memo: new MemoryMemoStore(),
          ledger: ledger(),
        },
      ),
    ).rejects.toThrow(/must never fall back to something it just decided was ineligible/);
  });

  it('records an audit row whatever the outcome', async () => {
    const outcome = await select(request(), {
      provider: obedientProvider(),
      memo: new MemoryMemoStore(),
      ledger: ledger(),
    });
    const row = callRecord({
      call_id: 'c1',
      stage: 'creative_direction',
      outcome,
      request: request(),
      duration_ms: 12,
    });
    expect(row).toMatchObject({ call_id: 'c1', stage: 'creative_direction', attempts: 1 });
    expect(row.schema_hash).toHaveLength(16);
    expect(row.output_hash).toHaveLength(16);
  });
});

describe('the run machine', () => {
  const baseRun = (overrides: Partial<PipelineState> = {}): PipelineState => ({
    ...newRun({
      run_id: 'r_1',
      site_id: 'ridgeline',
      tenant_id: 'ada_demo',
      seed: 20260923,
      niche: 'roofing',
      registry: {},
    }),
    ...overrides,
  });

  it('walks the sixteen stages in order', () => {
    expect(nextStage('ingest')).toBe('evaluate_predicates');
    expect(nextStage('gap_report')).toBe('publish');
    expect(nextStage('publish')).toBeNull();
  });

  it('checkpoints after every stage', async () => {
    const store = new MemoryCheckpointStore();
    await runFrom(baseRun(), { store, stages: {}, context: {} });
    expect(store.all('r_1').map((cp) => cp.stage)).toHaveLength(16);
  });

  it('records an event log as a parent-linked tree', async () => {
    const store = new MemoryCheckpointStore();
    const final = await runFrom(baseRun(), { store, stages: {}, context: {}, until: 'playbook' });
    expect(final.events[0]).toMatchObject({ id: 1, parentId: null, kind: 'StageStarted' });
    expect(final.events[1]?.parentId).toBe(1);
  });

  it('stops at `until`', async () => {
    const store = new MemoryCheckpointStore();
    const final = await runFrom(baseRun(), { store, stages: {}, context: {}, until: 'playbook' });
    expect(final.stage).toBe('playbook');
    expect(final.status).toBe('RUNNING');
  });

  it('turns a throwing stage into ERROR with the message, not a crash', async () => {
    const store = new MemoryCheckpointStore();
    const final = await runFrom(baseRun(), {
      store,
      stages: {
        ingest: () => {
          throw new Error('the upload was corrupt');
        },
      },
      context: {},
    });
    expect(final.status).toBe('ERROR');
    expect(final.error).toBe('the upload was corrupt');
    expect(store.latest('r_1')?.status).toBe('ERROR');
  });

  it('evaluates predicates once into a snapshot everything downstream reads', async () => {
    const store = new MemoryCheckpointStore();
    const state = baseRun({
      stage: 'evaluate_predicates',
      registry: { proof: { credentials: { value: [{}], provenance: { kind: 'intake' } } } },
    });
    const final = await runFrom(state, {
      store,
      stages: {
        evaluate_predicates: evaluatePredicatesStage({
          predicates: ['count(proof.credentials) >= 1', 'count(proof.projects) >= 4'],
        }),
      },
      context: {},
      until: 'evaluate_predicates',
    });
    expect(final.snapshot).toHaveLength(2);
    expect(final.snapshot[0]).toMatchObject({ result: true, actual: 1 });
    expect(final.snapshot[1]).toMatchObject({ result: false, actual: 0 });
  });
});

describe('interrupt and resume', () => {
  const positioningRun = () => ({
    ...newRun({
      run_id: 'r_pos',
      site_id: 'ridgeline',
      tenant_id: 'ada_demo',
      seed: 1,
      niche: 'roofing',
      registry: {},
    }),
    stage: 'positioning' as const,
  });

  const stages = {
    positioning: positioningStage({
      supported: ['local_trust', 'premium'],
      suggestion: 'local_trust',
    }),
  };

  it('pauses rather than guessing when positioning is undeclared', async () => {
    const store = new MemoryCheckpointStore();
    const final = await runFrom(positioningRun(), { store, stages, context: {} });
    expect(final.status).toBe('WAITING_FOR_OWNER');
    expect(final.stage).toBe('positioning');
    expect(final.question).toMatch(/must be declared by the owner/);
  });

  it('round-trips WAITING_FOR_OWNER on the same run id', async () => {
    const store = new MemoryCheckpointStore();
    const paused = await runFrom(positioningRun(), { store, stages, context: {} });
    expect(paused.status).toBe('WAITING_FOR_OWNER');

    const resumed = resume(store, 'r_pos', (state) => ({ ...state, positioning: 'premium' }));
    expect(resumed.run_id).toBe('r_pos');
    expect(resumed.status).toBe('RUNNING');
    expect(resumed.question).toBeNull();

    const finished = await runFrom(resumed, { store, stages, context: {} });
    expect(finished.run_id).toBe('r_pos');
    expect(finished.status).toBe('FINISHED');
    expect(finished.positioning).toBe('premium');
    expect(finished.events.some((event) => event.kind === 'OwnerInterrupted')).toBe(true);
    expect(finished.events.some((event) => event.kind === 'OwnerResumed')).toBe(true);
  });

  it('errors rather than accepting a positioning the playbook does not support', async () => {
    const store = new MemoryCheckpointStore();
    const final = await runFrom(
      { ...positioningRun(), positioning: 'luxury' },
      {
        store,
        stages,
        context: {},
      },
    );
    expect(final.status).toBe('ERROR');
    expect(final.error).toMatch(/not supported by this niche/);
  });

  it('refuses to resume a run that is not waiting for anyone', () => {
    const store = new MemoryCheckpointStore();
    expect(() => resume(store, 'nope', (s) => s)).toThrow(ResumeError);
  });

  it('refuses to resume a running run, so an answer cannot be silently lost', async () => {
    const store = new MemoryCheckpointStore();
    await runFrom(positioningRun(), {
      store,
      stages: { positioning: (state) => ({ ...state, positioning: 'premium' }) },
      context: {},
      until: 'positioning',
    });
    expect(() => resume(store, 'r_pos', (s) => s)).toThrow(/not waiting for anyone/);
  });

  it('rewinds to a stage checkpoint for the repair loop', async () => {
    const store = new MemoryCheckpointStore();
    await runFrom(
      {
        ...newRun({
          run_id: 'r_rw',
          site_id: 's',
          tenant_id: 't',
          seed: 1,
          niche: 'roofing',
          registry: {},
        }),
      },
      { store, stages: {}, context: {} },
    );
    expect(rewind(store, 'r_rw', 'assemble').stage).toBe('assemble');
    expect(() => rewind(store, 'r_rw', 'publish')).not.toThrow();
    expect(() => rewind(store, 'missing', 'assemble')).toThrow(ResumeError);
  });

  it('records a budget stop and a stuck stop as run outcomes, not exceptions', () => {
    const state = newRun({
      run_id: 'r_b',
      site_id: 's',
      tenant_id: 't',
      seed: 1,
      niche: 'roofing',
      registry: {},
    });
    expect(budgetExceeded(state, 'spent').status).toBe('BUDGET_EXCEEDED');
    expect(stuck(state, 'looping').status).toBe('STUCK');
    expect(interrupt(state, 'which positioning?').status).toBe('WAITING_FOR_OWNER');
  });
});

describe('budget resolution', () => {
  it('uses the defaults when nothing is set', () => {
    expect(resolveBudgets({})).toEqual(DEFAULT_BUDGETS);
  });

  it('reads a ceiling from the environment, so one run can be raised without an edit', () => {
    expect(resolveBudgets({ ADA_MAX_COST_USD: '10' })).toMatchObject({ max_cost_usd: 10 });
    expect(resolveBudgets({ ADA_MAX_MODEL_CALLS: '100' })).toMatchObject({
      max_model_calls: 100,
    });
    expect(resolveBudgets({ ADA_MAX_WALL_CLOCK_MS: '900000' })).toMatchObject({
      max_wall_clock_ms: 900_000,
    });
  });

  it('lets an explicit override win over the environment', () => {
    expect(resolveBudgets({ ADA_MAX_COST_USD: '10' }, { max_cost_usd: 3 })).toMatchObject({
      max_cost_usd: 3,
    });
  });

  it('throws on a malformed value rather than falling back to the default', () => {
    // The failure this prevents: an operator sets ADA_MAX_COST_USD=ten, believes the ceiling is
    // raised, and the run proceeds at a ceiling nobody chose.
    for (const value of ['ten', '-1', '0', 'NaN', 'Infinity']) {
      expect(() => resolveBudgets({ ADA_MAX_COST_USD: value }), value).toThrow(BudgetConfigError);
    }
  });

  it('ignores an empty variable, which is how a shell spells "unset"', () => {
    expect(resolveBudgets({ ADA_MAX_COST_USD: '' })).toEqual(DEFAULT_BUDGETS);
  });

  it('refuses a non-positive explicit override too', () => {
    expect(() => resolveBudgets({}, { max_model_calls: 0 })).toThrow(BudgetConfigError);
  });

  it('defaults to a ceiling that makes a runaway cheap', () => {
    // A default is what runs when nobody thought about it. A fixture build spends ~$0.003.
    expect(DEFAULT_BUDGETS.max_cost_usd).toBeLessThanOrEqual(1);
    expect(DEFAULT_BUDGETS.max_wall_clock_ms).toBeGreaterThan(0);
  });
});

describe('the wall-clock ceiling', () => {
  it('stops a run that spends no money and never finishes', async () => {
    // The local-model case: Ollama costs $0.00 per call, so the dollar ceiling never trips.
    const outcome = await select(request(), {
      provider: obedientProvider('ok'),
      memo: new MemoryMemoStore(),
      ledger: ledger({
        max_cost_usd: 1000,
        max_calls: 1000,
        started_at_ms: 0,
        max_wall_clock_ms: 5_000,
        now: () => 5_001,
      }),
    });
    expect(outcome.kind).toBe('budget_exceeded');
    if (outcome.kind !== 'budget_exceeded') throw new Error('expected budget_exceeded');
    expect(outcome.reason).toMatch(/5000 ms/);
  });

  it('does not trip inside the ceiling', async () => {
    const outcome = await select(request(), {
      provider: obedientProvider('ok'),
      memo: new MemoryMemoStore(),
      ledger: ledger({ started_at_ms: 0, max_wall_clock_ms: 5_000, now: () => 4_999 }),
    });
    expect(outcome.kind).toBe('selected');
  });
});
