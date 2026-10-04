/**
 * Turning fingerprints into ban candidates.
 *
 * The whole argument of this package is in one sentence, and it is tier 3's argument applied to
 * someone else's output instead of our own: **a pattern that appears in a large fraction of the
 * most-copied component repositories is a cliché by definition.** No taste, no model, nothing to
 * argue with — a number and a list of repository names.
 *
 * ## Document frequency, not hit count
 *
 * The weight of a pattern is **how many distinct repositories ship it**, never how many times it
 * appears. One repository with a `rounded-2xl shadow-2xl` card in forty files is one repository
 * with a house style. Forty repositories each using it once is the finding. Counting hits would
 * let a single large library mint bans on its own.
 *
 * ## Two thresholds, both required
 *
 * `minRepos` keeps a pattern from three repositories out of the list however large a share of a
 * small corpus it is. `minShare` keeps a pattern from fifty repositories out when the corpus is
 * five thousand. A pattern needs absolute support *and* relative prevalence.
 *
 * ## Output is a proposal, never a ban
 *
 * `/_proposed/harvested-bans.jsonl`, and there is no code path from that file to `BANNED_COPY`.
 * Same boundary as tier 2, same reason: ARCHITECTURE §11 puts "land anything from `/_proposed/`"
 * outside an agent's authority, and the mechanism honours it rather than relying on it being
 * remembered. Promotion is a human writing the rule in `tier1.ts` and bumping its version.
 */
import { patternId, type RepoFingerprint } from './fingerprint.js';

export type CandidateKind = 'class_set' | 'effect_name';

export interface BanCandidate {
  readonly id: string;
  readonly kind: CandidateKind;
  /** The co-occurring class tokens, sorted; or a single effect name. */
  readonly tokens: readonly string[];
  /** Distinct repositories shipping it. This is the evidence. */
  readonly repoCount: number;
  /** `repoCount / corpusSize`. */
  readonly share: number;
  /** Named repositories, capped — enough to audit without storing the whole corpus in a line. */
  readonly examples: readonly string[];
}

export interface CorpusOptions {
  /** Minimum distinct repositories. Default 5. */
  readonly minRepos?: number;
  /** Minimum fraction of the corpus. Default 0.15, matching tier 3's n-gram threshold. */
  readonly minShare?: number;
  /**
   * Itemset sizes to mine. Default 2 through 4.
   *
   * Four matters: the generated-marketing-page fingerprint is four tokens —
   * `rounded-2xl shadow-2xl backdrop-blur-sm bg-gradient-to-br` — and mining only pairs and
   * triples reported it as four separate triples that `dropImpliedSubsets` could not collapse,
   * because the set that implies them was never mined.
   */
  readonly setSizes?: readonly number[];
  /** Named repositories recorded per candidate. Default 5. */
  readonly maxExamples?: number;
  /** Patterns already banned, so the queue does not refill with them every run. */
  readonly known?: readonly string[];
}

/** Every k-subset of `tokens`, each sorted. Caller bounds k; combinatorics are not free. */
export function subsetsOfSize(tokens: readonly string[], size: number): string[][] {
  if (size <= 0 || size > tokens.length) return [];
  const sorted = [...new Set(tokens)].sort();
  const out: string[][] = [];

  const walk = (start: number, picked: string[]): void => {
    if (picked.length === size) {
      out.push([...picked]);
      return;
    }
    for (let index = start; index < sorted.length; index += 1) {
      picked.push(sorted[index] as string);
      walk(index + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * A class attribute with thirty tokens would generate 4060 triples on its own, and a corpus of
 * thousands of files would spend its time on sets nobody will read. Long attributes are also the
 * least informative: a kitchen-sink class list is not a pattern, it is a component.
 */
const MAX_TOKENS_PER_SET = 12;

export function harvestCorpus(
  fingerprints: readonly RepoFingerprint[],
  options: CorpusOptions = {},
): BanCandidate[] {
  const corpusSize = fingerprints.length;
  if (corpusSize === 0) return [];

  const minRepos = options.minRepos ?? 5;
  const minShare = options.minShare ?? 0.15;
  const setSizes = options.setSizes ?? [2, 3, 4];
  const maxExamples = options.maxExamples ?? 5;
  const known = new Set((options.known ?? []).map((entry) => entry.toLowerCase()));

  // pattern id -> { tokens, kind, repos }. A Set of repo names is what makes the count a document
  // frequency: the same repository adding a pattern twice does not move it.
  const seen = new Map<
    string,
    { tokens: readonly string[]; kind: CandidateKind; repos: Set<string> }
  >();

  const record = (tokens: readonly string[], kind: CandidateKind, repo: string): void => {
    const id = patternId(tokens);
    const entry = seen.get(id) ?? { tokens: [...tokens].sort(), kind, repos: new Set<string>() };
    entry.repos.add(repo);
    seen.set(id, entry);
  };

  for (const fingerprint of fingerprints) {
    // Deduplicated per repository before mining, so one repository's forty identical cards
    // contribute one observation rather than forty.
    const repoSets = new Set<string>();
    for (const classSet of fingerprint.classSets) {
      if (classSet.length > MAX_TOKENS_PER_SET) continue;
      for (const size of setSizes) {
        for (const subset of subsetsOfSize(classSet, size)) repoSets.add(subset.join(' '));
      }
    }
    for (const key of repoSets) record(key.split(' '), 'class_set', fingerprint.repo);
    for (const name of fingerprint.effectNames) record([name], 'effect_name', fingerprint.repo);
  }

  const candidates: BanCandidate[] = [];
  for (const [id, entry] of seen) {
    const repoCount = entry.repos.size;
    const share = repoCount / corpusSize;
    if (repoCount < minRepos || share < minShare) continue;
    if (entry.tokens.some((token) => known.has(token.toLowerCase()))) continue;

    candidates.push({
      id,
      kind: entry.kind,
      tokens: entry.tokens,
      repoCount,
      share,
      // Sorted so the same corpus produces the same examples: a proposal that changes its
      // evidence between runs is a proposal nobody trusts.
      examples: [...entry.repos].sort().slice(0, maxExamples),
    });
  }

  return candidates.sort(
    (a, b) => b.repoCount - a.repoCount || a.tokens.join(' ').localeCompare(b.tokens.join(' ')),
  );
}

/**
 * Drop a candidate whose every token is already covered by a larger, more prevalent set.
 *
 * Without this the list is unreadable: if `rounded-2xl shadow-2xl backdrop-blur` crosses the
 * threshold then so do all three of its pairs, and a reviewer reads the same finding four times.
 * The longest set that crossed is the specific claim; its subsets are implied by it.
 */
export function dropImpliedSubsets(candidates: readonly BanCandidate[]): BanCandidate[] {
  const byLength = [...candidates].sort((a, b) => b.tokens.length - a.tokens.length);
  const kept: BanCandidate[] = [];

  for (const candidate of byLength) {
    const implied = kept.some(
      (larger) =>
        larger.kind === candidate.kind &&
        larger.tokens.length > candidate.tokens.length &&
        candidate.tokens.every((token) => larger.tokens.includes(token)),
    );
    if (!implied) kept.push(candidate);
  }

  return kept.sort((a, b) => b.repoCount - a.repoCount);
}

export interface HarvestRecord extends BanCandidate {
  readonly corpus_size: number;
  readonly harvested_at: string;
  /** Always `proposal`. Stated in the row so a reader of the file cannot mistake it for a rule. */
  readonly status: 'proposal';
}

export function harvestRecords(
  candidates: readonly BanCandidate[],
  context: { corpusSize: number; now?: Date },
): HarvestRecord[] {
  const harvestedAt = (context.now ?? new Date()).toISOString();
  return candidates.map((candidate) => ({
    ...candidate,
    corpus_size: context.corpusSize,
    harvested_at: harvestedAt,
    status: 'proposal',
  }));
}

export function harvestLines(candidates: readonly BanCandidate[], corpusSize: number): string[] {
  if (candidates.length === 0) {
    return [`harvest found nothing above threshold across ${corpusSize} repo(s)`];
  }
  return [
    `harvest proposed ${candidates.length} pattern(s) from ${corpusSize} repo(s) ` +
      '(proposals only — promotion to tier 1 is a human editing tier1.ts):',
    ...candidates
      .slice(0, 20)
      .map(
        (candidate) =>
          `  ${(candidate.share * 100).toFixed(0)}% (${candidate.repoCount}/${corpusSize})  ` +
          `${candidate.kind}  ${candidate.tokens.join(' ')}`,
      ),
  ];
}
