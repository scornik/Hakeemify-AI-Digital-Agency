/**
 * Finding repositories, and writing the proposal queue.
 *
 * Discovery is deliberately thin. The GitHub search queries below are the ones worth running, and
 * everything interesting happens afterwards in `fingerprint.ts` and `corpus.ts`. `fetch` is
 * injected so no test touches the network: a suite that depends on GitHub's uptime and a rate
 * limit is a suite that fails for reasons unrelated to the code.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { classifyLicence, type LicenceVerdict } from './licence.js';
import type { HarvestRecord } from './corpus.js';

/**
 * The searches that surface the corpus. Stars floor at 100 on purpose: the argument is "the
 * **most-copied** libraries ship this", and an unstarred repository is not evidence of what people
 * copy.
 */
export const DISCOVERY_QUERIES: readonly string[] = [
  'topic:shadcn-ui stars:>100',
  'topic:tailwind-components stars:>100',
  'topic:landing-page stars:>100',
  'topic:react-components stars:>100',
  'topic:ui-components stars:>100',
  'topic:framer-motion stars:>100',
  'topic:website-template stars:>100',
  'topic:nextjs-template stars:>100',
];

export interface DiscoveredRepo {
  readonly repo: string;
  readonly stars: number;
  readonly spdx: string;
  readonly defaultBranch: string;
  readonly pushedAt: string;
}

export interface SkippedRepo {
  readonly repo: string;
  readonly reason: string;
}

export interface DiscoveryResult {
  readonly repos: readonly DiscoveredRepo[];
  /** Named, not silently dropped: an unauditable corpus is the thing to avoid. */
  readonly skipped: readonly SkippedRepo[];
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class MissingGitHubTokenError extends Error {
  constructor() {
    super(
      'GITHUB_TOKEN is not set. Unauthenticated search is limited to 10 requests per minute, ' +
        'which makes a corpus of any size impossible. A read-only token with no scopes is enough.',
    );
    this.name = 'MissingGitHubTokenError';
  }
}

export class GitHubHttpError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`GitHub returned ${status}: ${body.slice(0, 300)}`);
    this.name = 'GitHubHttpError';
  }
}

interface SearchItem {
  full_name?: string;
  stargazers_count?: number;
  default_branch?: string;
  pushed_at?: string;
  license?: { spdx_id?: string | null } | null;
}

export interface DiscoverOptions {
  readonly token?: string;
  readonly fetch?: FetchLike;
  readonly queries?: readonly string[];
  /** Results per query. GitHub caps a page at 100. */
  readonly perQuery?: number;
}

/**
 * Run the searches and classify each result's licence.
 *
 * A repository skipped for its licence is **recorded with the reason**, never dropped. The corpus's
 * whole claim is "this pattern appears in N of M named repositories", and M has to be explainable —
 * including the part of it that was excluded.
 */
export async function discoverRepos(options: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const token = options.token ?? process.env['GITHUB_TOKEN'];
  if (token === undefined || token.trim() === '') throw new MissingGitHubTokenError();

  const doFetch = options.fetch ?? (globalThis.fetch as FetchLike);
  const queries = options.queries ?? DISCOVERY_QUERIES;
  const perQuery = Math.min(options.perQuery ?? 50, 100);

  const repos = new Map<string, DiscoveredRepo>();
  const skipped: SkippedRepo[] = [];

  for (const query of queries) {
    const url =
      'https://api.github.com/search/repositories' +
      `?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=${perQuery}`;

    const response = await doFetch(url, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok) throw new GitHubHttpError(response.status, await response.text());

    const body = (await response.json()) as { items?: SearchItem[] };
    for (const item of body.items ?? []) {
      const name = item.full_name;
      if (name === undefined || repos.has(name)) continue;

      const verdict: LicenceVerdict = classifyLicence(item.license?.spdx_id);
      if (!verdict.readable) {
        skipped.push({ repo: name, reason: verdict.reason });
        continue;
      }
      repos.set(name, {
        repo: name,
        stars: item.stargazers_count ?? 0,
        spdx: verdict.spdx,
        defaultBranch: item.default_branch ?? 'main',
        pushedAt: item.pushed_at ?? '',
      });
    }
  }

  return {
    repos: [...repos.values()].sort((a, b) => b.stars - a.stars),
    skipped,
  };
}

/** Default queue location. Under `_proposed/`, which nothing in this repository reads back. */
export const PROPOSAL_PATH = '_proposed/harvested-bans.jsonl';

/**
 * Append candidates, skipping ids already queued.
 *
 * Deduplicated on read because the corpus overlaps between runs: the same two hundred repositories
 * will propose the same patterns next week, and a queue with one line forty times does not get
 * reviewed.
 */
export function appendHarvest(path: string, records: readonly HarvestRecord[]): number {
  if (records.length === 0) return 0;

  const seen = new Set<string>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const existing = JSON.parse(line) as { id?: string };
        if (typeof existing.id === 'string') seen.add(existing.id);
      } catch {
        // A corrupt line is not a reason to refuse to append. The queue is an inbox.
        continue;
      }
    }
  }

  const fresh = records.filter((record) => !seen.has(record.id));
  if (fresh.length === 0) return 0;

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, fresh.map((record) => JSON.stringify(record)).join('\n') + '\n', 'utf8');
  return fresh.length;
}
