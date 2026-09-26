import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  TIER2_VERSION,
  appendProposals,
  judgePrompt,
  runTier2,
  tier2Blocks,
  tier2Lines,
  tier2Records,
  type Tier2Result,
} from '../src/antislop/tier2.js';
import { BANNED_COPY } from '../src/antislop/tier1.js';
import type { BudgetLedger, ModelProvider } from '../src/model/wrapper.js';

/** A provider that returns whatever body the test names. */
function judge(body: unknown, finish: 'stop' | 'length' = 'stop'): ModelProvider {
  return {
    name: 'judge',
    complete: () => ({
      text: typeof body === 'string' ? body : JSON.stringify(body),
      finish_reason: finish,
      cost_usd: 0.002,
      model: 'j',
      provider: 'judge',
    }),
  };
}

const COPY = {
  's_hook.headline': 'Elevate your business to the next level',
  's_cta.promise': 'We answer every enquiry within one working day',
};

describe('tier 2 cannot block', () => {
  it('returns false unconditionally', () => {
    // The tempting change is "promote tier 2 to blocking once it is accurate enough", which
    // reintroduces a non-reproducible verdict into a gate that promises reproducibility. A model
    // asked twice may answer differently; a gate that does is a coin flip that stops deploys.
    expect(tier2Blocks()).toBe(false);
  });
});

describe('running the judge', () => {
  it('collects proposals that quote the copy', async () => {
    const result = await runTier2({
      provider: judge({
        proposals: [
          {
            phrase: 'Elevate your business to the next level',
            slot: 's_hook.headline',
            reason: 'could appear on any business’s site in any sector',
            rewrite: 'Roofing for the three valleys, since 1998',
          },
        ],
      }),
      copy: COPY,
    });

    expect(result.judged).toBe(true);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.rewrite).toContain('1998');
    expect(result.cost_usd).toBeCloseTo(0.002);
  });

  it('drops a phrase the judge invented rather than read', async () => {
    // A proposal about text that is not in this build's copy is not evidence about this build.
    const result = await runTier2({
      provider: judge({
        proposals: [
          { phrase: 'Synergise your workflow', slot: 's_hook.headline', reason: 'x', rewrite: 'y' },
        ],
      }),
      copy: COPY,
    });
    expect(result.judged).toBe(true);
    expect(result.proposals).toEqual([]);
  });

  it('drops a flag with no rewrite, because that is a complaint not a proposal', async () => {
    const result = await runTier2({
      provider: judge({
        proposals: [
          {
            phrase: 'Elevate your business to the next level',
            slot: 's_hook.headline',
            reason: 'filler',
            rewrite: '   ',
          },
        ],
      }),
      copy: COPY,
    });
    expect(result.proposals).toEqual([]);
  });

  it('reports a truncated answer as not judged, rather than as clean', async () => {
    const result = await runTier2({ provider: judge({ proposals: [] }, 'length'), copy: COPY });
    expect(result.judged).toBe(false);
    expect(result.skipped).toContain('length');
  });

  it('reports unparseable output as not judged', async () => {
    const result = await runTier2({ provider: judge('not json'), copy: COPY });
    expect(result.judged).toBe(false);
  });

  it('never throws, because it is not allowed to fail a build it cannot block', async () => {
    const exploding: ModelProvider = {
      name: 'down',
      complete() {
        throw new Error('provider unreachable');
      },
    };
    const result = await runTier2({ provider: exploding, copy: COPY });
    expect(result.judged).toBe(false);
    expect(result.skipped).toContain('unreachable');
  });

  it('does not call the model when there is no copy to judge', async () => {
    let called = false;
    const spy: ModelProvider = {
      name: 'spy',
      complete: () => {
        called = true;
        return {
          text: '{}',
          finish_reason: 'stop' as const,
          cost_usd: 1,
          model: 'm',
          provider: 's',
        };
      },
    };
    const result = await runTier2({ provider: spy, copy: { 'a.b': '   ' } });
    expect(called).toBe(false);
    expect(result.cost_usd).toBe(0);
    expect(result.judged).toBe(false);
  });
});

describe('the prompt', () => {
  it('tells the judge what tier 1 already covers', () => {
    // Without this the queue fills with the same banned phrase every run and the signal drowns.
    const prompt = judgePrompt(BANNED_COPY.map((ban) => ban.id));
    expect(prompt).toContain('already banned deterministically');
    expect(prompt).toContain(BANNED_COPY[0]?.id as string);
  });

  it('says that a plain but checkable statement is not filler', () => {
    // The failure mode of a cliché judge is flagging specificity as dullness.
    expect(judgePrompt([])).toContain('not filler however plain they sound');
  });
});

describe('the proposal queue', () => {
  const result: Tier2Result = {
    judged: true,
    cost_usd: 0,
    proposals: [
      { phrase: 'Elevate your brand', slot: 's_hook.headline', reason: 'r', rewrite: 'w' },
    ],
  };

  it('stamps both tier versions, so a reviewer can date a proposal', () => {
    const [record] = tier2Records(result, { runId: 'b_1', niche: 'medical' });
    expect(record?.tier2_version).toBe(TIER2_VERSION);
    // Lets a reviewer tell whether a proposal predates a tier-1 bump that already covers it.
    expect(record?.tier1_version).toBeTruthy();
    expect(record?.run_id).toBe('b_1');
  });

  it('fingerprints on the normalised phrase, so case and padding do not duplicate', () => {
    const [a] = tier2Records(result, { runId: 'b_1', niche: 'x' });
    const [b] = tier2Records(
      { ...result, proposals: [{ ...result.proposals[0]!, phrase: '  ELEVATE YOUR BRAND ' }] },
      { runId: 'b_2', niche: 'y' },
    );
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it('appends as JSONL and de-duplicates against what is already there', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ada-tier2-')), '_proposed', 'bans.jsonl');
    const records = tier2Records(result, { runId: 'b_1', niche: 'x' });

    expect(appendProposals(path, records)).toBe(1);
    // The same filler appears across niches. A queue with one line forty times is not reviewed.
    expect(appendProposals(path, tier2Records(result, { runId: 'b_2', niche: 'y' }))).toBe(0);

    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({ phrase: 'Elevate your brand' });
  });

  it('survives a corrupt line, because the queue is an inbox', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ada-tier2-')), 'bans.jsonl');
    writeFileSync(path, 'not json\n', 'utf8');
    expect(appendProposals(path, tier2Records(result, { runId: 'b_1', niche: 'x' }))).toBe(1);
  });

  it('writes nothing when there is nothing to write', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ada-tier2-')), 'bans.jsonl');
    expect(appendProposals(path, [])).toBe(0);
  });
});

describe('the run log', () => {
  it('distinguishes "did not run" from "found nothing"', () => {
    // These look identical in a summary and mean opposite things. One is a clean result; the
    // other is the reason the ban list stopped growing six weeks ago.
    const failed = tier2Lines({ judged: false, proposals: [], skipped: 'no key', cost_usd: 0 });
    expect(failed.join(' ')).toContain('did not run');
    expect(failed.join(' ')).toContain('not a clean result');

    const clean = tier2Lines({ judged: true, proposals: [], cost_usd: 0 });
    expect(clean.join(' ')).toContain('proposed nothing');
  });

  it('says outright that it never blocks', () => {
    const lines = tier2Lines({
      judged: true,
      cost_usd: 0,
      proposals: [{ phrase: 'p', slot: 's', reason: 'r', rewrite: 'w' }],
    });
    expect(lines.join(' ')).toContain('never blocking');
  });
});

describe('the budget ledger', () => {
  const ledger = (over: Partial<BudgetLedger> = {}): BudgetLedger => ({
    calls: 0,
    cost_usd: 0,
    max_calls: 8,
    max_cost_usd: 1,
    started_at_ms: 0,
    max_wall_clock_ms: 60_000,
    now: () => 0,
    ...over,
  });

  it('counts its call and its cost, because it spends real money', async () => {
    // A call the ledger cannot see does not count against max_cost_usd — the same class of bug as
    // a provider retrying internally, arriving from the one tier not allowed to affect the result.
    const book = ledger();
    await runTier2({ provider: judge({ proposals: [] }), copy: COPY, ledger: book });
    expect(book.calls).toBe(1);
    expect(book.cost_usd).toBeCloseTo(0.002);
  });

  it('skips itself rather than exhausting a nearly spent budget', async () => {
    // Tier 2 is the lowest-value call in the run, so it is the one that should stand down — not
    // the one that spends the last of the ceiling and leaves the copy call with nothing.
    const book = ledger({ cost_usd: 1 });
    const result = await runTier2({ provider: judge({ proposals: [] }), copy: COPY, ledger: book });
    expect(result.judged).toBe(false);
    expect(result.skipped).toContain('ceiling');
    expect(book.calls).toBe(0);
  });

  it('stands down on the call ceiling too', async () => {
    const book = ledger({ calls: 8 });
    const result = await runTier2({ provider: judge({ proposals: [] }), copy: COPY, ledger: book });
    expect(result.judged).toBe(false);
    expect(result.skipped).toContain('model call');
  });

  it('does not charge the ledger when the provider throws', async () => {
    const book = ledger();
    const down: ModelProvider = {
      name: 'down',
      complete() {
        throw new Error('unreachable');
      },
    };
    await runTier2({ provider: down, copy: COPY, ledger: book });
    // The call is counted (it was attempted) but no cost is added, because none was incurred.
    expect(book.calls).toBe(1);
    expect(book.cost_usd).toBe(0);
  });
});
