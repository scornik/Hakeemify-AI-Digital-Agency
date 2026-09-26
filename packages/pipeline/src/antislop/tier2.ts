/**
 * Anti-slop tier 2 — the semantic cliché judge (v4 §14, ARCHITECTURE §8).
 *
 * ```yaml
 * tier_2:
 *   input: generated copy only, no screenshots
 *   severity: warning_only            # never blocks — not reproducible run to run
 *   output: /_proposed/anti-slop-bans.jsonl
 *   promotion: human review → tier 1 regex, versioned like any other asset
 * ```
 *
 * ## Why this one cannot block, and why that is the whole design
 *
 * Tiers 1 and 3 are deterministic: a regex either matches or it does not, an n-gram either
 * crosses 15% of the last hundred builds or it does not. Re-run either and you get the same
 * answer. Tier 2 asks a model whether a sentence *reads* as filler, and that judgement is not
 * reproducible run to run. A gate whose verdict changes when nothing changed is not a gate — it
 * is a coin flip that occasionally stops a deploy.
 *
 * So the judge's output is a **proposal**, and `tier2Blocks()` returns false unconditionally.
 * Its actual job is to grow the deterministic list from real output, so tier 1 stays current
 * without anyone maintaining it by hand. A phrase this judge flags becomes a *ban* only after a
 * human reads it and writes the regex.
 *
 * ## The proposal queue is write-only from here
 *
 * `/_proposed/anti-slop-bans.jsonl` is append-only, and nothing in this repository reads it back
 * into a rule pack. ARCHITECTURE §11 names "land anything from `/_proposed/`" as outside an
 * agent's authority, and the mechanism honours that rather than relying on it being remembered:
 * there is no code path from the queue to `BANNED_COPY`. Promotion is a human editing
 * `tier1.ts` and bumping its version.
 *
 * ## Failure is not a finding
 *
 * If the judge cannot be reached, returns nonsense, or exhausts its budget, the result is
 * `judged: false` and zero proposals — never an empty verdict presented as a clean bill. A
 * warning-only tier that silently degrades to "nothing to report" is indistinguishable from a
 * tier that ran and found nothing, and the difference matters when someone later asks why the
 * ban list stopped growing.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { stableHash } from '@ada/contract';

import { TIER1_VERSION, BANNED_COPY } from './tier1.js';
import type { ModelProvider, ModelRequest } from '../model/wrapper.js';
import type { JsonSchemaObject } from '@ada/contract';

export const TIER2_VERSION = 'tier2@1';

/** One phrase the judge thinks reads as filler, with the rewrite it suggests. */
export interface Tier2Proposal {
  /** The offending phrase, verbatim from the copy. */
  readonly phrase: string;
  /** Where it appeared: `sectionInstanceId.slot`. */
  readonly slot: string;
  /** Why it reads as filler, in the judge's words. Advisory, never authoritative. */
  readonly reason: string;
  /** A concrete replacement. A flag without one is a complaint, not a proposal. */
  readonly rewrite: string;
}

export interface Tier2Record extends Tier2Proposal {
  readonly tier2_version: string;
  readonly tier1_version: string;
  readonly run_id: string;
  readonly niche: string;
  readonly proposed_at: string;
  /** Stable across runs for the same phrase, so the queue can be de-duplicated. */
  readonly fingerprint: string;
}

export interface Tier2Result {
  /** False when the judge did not run or could not be understood. Not the same as "clean". */
  readonly judged: boolean;
  readonly proposals: readonly Tier2Proposal[];
  /** Why the judge did not run, when it did not. */
  readonly skipped?: string;
  readonly cost_usd: number;
}

/**
 * Tier 2 never blocks. Exported as a function rather than left implicit so a test can assert it,
 * because the tempting bug is to "promote tier 2 to blocking once it's accurate enough" — which
 * reintroduces a non-reproducible verdict into a gate that promises reproducibility.
 */
export function tier2Blocks(): false {
  return false;
}

const JUDGE_SCHEMA: JsonSchemaObject = {
  type: 'object',
  properties: {
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phrase: { type: 'string' },
          slot: { type: 'string' },
          reason: { type: 'string' },
          rewrite: { type: 'string' },
        },
        required: ['phrase', 'slot', 'reason', 'rewrite'],
        additionalProperties: false,
      },
    },
  },
  required: ['proposals'],
  additionalProperties: false,
};

/**
 * The judge is told what tier 1 already covers, so it stops proposing bans that exist. Without
 * this the queue fills with "Elevate your brand" on every run and the signal drowns.
 */
export function judgePrompt(knownBans: readonly string[]): string {
  return [
    'You are reviewing website copy for phrasing that reads as generic marketing filler:',
    'sentences that could appear on any business’s site in any sector, and say nothing a reader',
    'could not have assumed.',
    '',
    'Report only phrases that are genuinely interchangeable. Specific, checkable statements are',
    'not filler however plain they sound — "We answer every enquiry within one working day" is',
    'good copy, not a cliché.',
    '',
    'For each phrase give the verbatim text, the slot it came from, why it is interchangeable,',
    'and a concrete rewrite that keeps the same meaning.',
    '',
    'These patterns are already banned deterministically. Do not propose them again:',
    ...knownBans.map((source) => `  - ${source}`),
  ].join('\n');
}

export interface Tier2Options {
  readonly provider: ModelProvider;
  /** Generated copy only, keyed `sectionInstanceId.slot`. Facts are never judged. */
  readonly copy: Readonly<Record<string, string>>;
  readonly maxCostUsd?: number;
}

/**
 * Run the judge. Never throws: every failure path returns `judged: false` with a reason, because
 * a warning-only tier that throws would take down a build it is not allowed to block.
 */
export async function runTier2(options: Tier2Options): Promise<Tier2Result> {
  const entries = Object.entries(options.copy).filter(([, text]) => text.trim() !== '');
  if (entries.length === 0) {
    return {
      judged: false,
      proposals: [],
      skipped: 'there was no generated copy to judge',
      cost_usd: 0,
    };
  }

  const request: ModelRequest = {
    schema: JUDGE_SCHEMA,
    system: judgePrompt(BANNED_COPY.map((ban) => ban.id)),
    user: entries.map(([slot, text]) => `${slot}: ${text}`).join('\n'),
    // Seeded like every other call, so a provider that honours it gives the same reading twice.
    // That does not make the judgement reproducible in general, which is why it still cannot gate.
    seed: 0,
  };

  let cost = 0;
  try {
    const response = await options.provider.complete(request);
    cost = response.cost_usd;

    if (response.finish_reason !== 'stop') {
      return {
        judged: false,
        proposals: [],
        skipped: `the judge did not finish (${response.finish_reason})`,
        cost_usd: cost,
      };
    }

    const parsed = JSON.parse(response.text) as { proposals?: unknown };
    if (!Array.isArray(parsed.proposals)) {
      return {
        judged: false,
        proposals: [],
        skipped: 'the judge returned no proposals array',
        cost_usd: cost,
      };
    }

    const proposals: Tier2Proposal[] = [];
    for (const raw of parsed.proposals) {
      const candidate = raw as Partial<Tier2Proposal>;
      if (
        typeof candidate.phrase !== 'string' ||
        typeof candidate.slot !== 'string' ||
        typeof candidate.reason !== 'string' ||
        typeof candidate.rewrite !== 'string' ||
        candidate.phrase.trim() === '' ||
        candidate.rewrite.trim() === ''
      ) {
        // Dropped rather than repaired. A proposal missing its rewrite is a complaint, and the
        // queue exists for things a human can act on.
        continue;
      }
      // A phrase the judge invented rather than read is not evidence about this build's copy.
      if (!entries.some(([, text]) => text.includes(candidate.phrase as string))) continue;

      proposals.push({
        phrase: candidate.phrase,
        slot: candidate.slot,
        reason: candidate.reason,
        rewrite: candidate.rewrite,
      });
    }

    return { judged: true, proposals, cost_usd: cost };
  } catch (error) {
    return {
      judged: false,
      proposals: [],
      skipped: error instanceof Error ? error.message : String(error),
      cost_usd: cost,
    };
  }
}

export function tier2Records(
  result: Tier2Result,
  context: { runId: string; niche: string; now?: Date },
): Tier2Record[] {
  const proposedAt = (context.now ?? new Date()).toISOString();
  return result.proposals.map((proposal) => ({
    ...proposal,
    tier2_version: TIER2_VERSION,
    // Recorded so a reviewer can tell whether a proposal predates a tier-1 bump that already
    // covers it.
    tier1_version: TIER1_VERSION,
    run_id: context.runId,
    niche: context.niche,
    proposed_at: proposedAt,
    fingerprint: stableHash({ phrase: proposal.phrase.trim().toLowerCase() }).slice(0, 16),
  }));
}

/**
 * Append to the proposal queue, skipping phrases already in it.
 *
 * De-duplicated on read rather than trusting the judge not to repeat itself: the same filler
 * appears across niches, and a queue with the same line forty times does not get reviewed.
 */
export function appendProposals(path: string, records: readonly Tier2Record[]): number {
  if (records.length === 0) return 0;

  const seen = new Set<string>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const existing = JSON.parse(line) as { fingerprint?: string };
        if (typeof existing.fingerprint === 'string') seen.add(existing.fingerprint);
      } catch {
        // A corrupt line is not a reason to refuse to append. The queue is an inbox.
        continue;
      }
    }
  }

  const fresh = records.filter((record) => !seen.has(record.fingerprint));
  if (fresh.length === 0) return 0;

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, fresh.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  return fresh.length;
}

/** One line per proposal, for the run log. Tier 2 is advisory and reads as advice. */
export function tier2Lines(result: Tier2Result): string[] {
  if (!result.judged) {
    return [`tier 2 did not run — ${result.skipped ?? 'no reason recorded'} (not a clean result)`];
  }
  if (result.proposals.length === 0) return ['tier 2 judged the copy and proposed nothing'];
  return [
    `tier 2 proposed ${result.proposals.length} phrase(s) for review (warning only, never blocking):`,
    ...result.proposals.map((p) => `  ${p.slot}: "${p.phrase}" → "${p.rewrite}"`),
  ];
}
