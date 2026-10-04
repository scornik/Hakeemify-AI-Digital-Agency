import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { READABLE_LICENCES, classifyLicence } from '../src/licence.js';
import {
  baseToken,
  extractClassSets,
  extractEffectNames,
  fingerprintRepo,
  isComponentFile,
  isSignalToken,
  patternId,
  type RepoFingerprint,
} from '../src/fingerprint.js';
import {
  dropImpliedSubsets,
  harvestCorpus,
  harvestLines,
  harvestRecords,
  subsetsOfSize,
} from '../src/corpus.js';
import {
  DISCOVERY_QUERIES,
  GitHubHttpError,
  MissingGitHubTokenError,
  appendHarvest,
  discoverRepos,
  type FetchLike,
} from '../src/discover.js';

describe('the licence gate', () => {
  it('admits the permissive list', () => {
    for (const spdx of READABLE_LICENCES) {
      expect(classifyLicence(spdx), spdx).toMatchObject({ readable: true });
    }
  });

  it('refuses NOASSERTION rather than guessing', () => {
    // A repository whose LICENSE file GitHub cannot classify is exactly where guessing is most
    // likely to be wrong, and a corpus you cannot audit is a ban list you cannot defend.
    const verdict = classifyLicence('NOASSERTION');
    expect(verdict.readable).toBe(false);
    if (verdict.readable) throw new Error('unreachable');
    expect(verdict.reason).toContain('could not classify');
  });

  it('refuses a missing licence', () => {
    expect(classifyLicence(null).readable).toBe(false);
    expect(classifyLicence(undefined).readable).toBe(false);
    expect(classifyLicence('  ').readable).toBe(false);
  });

  it('refuses GPL, which the shipped-closure policy also denies', () => {
    for (const spdx of ['GPL-3.0', 'AGPL-3.0', 'LGPL-2.1']) {
      expect(classifyLicence(spdx).readable, spdx).toBe(false);
    }
  });

  it('matches exactly, so a prefix cannot smuggle a variant in', () => {
    // `MIT` must not admit `MIT-advertising`; `Apache-2.0` must not admit a dual-licence string
    // nobody has read.
    expect(classifyLicence('MIT-advertising').readable).toBe(false);
    expect(classifyLicence('Apache-2.0 OR LGPL-2.1').readable).toBe(false);
    // Case is not meaning.
    expect(classifyLicence('mit').readable).toBe(true);
  });
});

describe('extracting class sets', () => {
  it('reads className, class and template literals', () => {
    expect(extractClassSets('<div className="rounded-2xl shadow-2xl">')).toEqual([
      ['rounded-2xl', 'shadow-2xl'],
    ]);
    expect(extractClassSets("<div class='backdrop-blur-sm'>")).toEqual([['backdrop-blur-sm']]);
    expect(extractClassSets('<div className={`bg-gradient-to-br`}>')).toEqual([
      ['bg-gradient-to-br'],
    ]);
  });

  it('strips the variant prefix, so md:rounded-2xl is the same decision as rounded-2xl', () => {
    // The breakpoint is a responsive detail. The radius is the style.
    expect(baseToken('md:hover:rounded-2xl')).toBe('rounded-2xl');
    expect(extractClassSets('<div className="md:rounded-2xl">')).toEqual([['rounded-2xl']]);
  });

  it('drops structural tokens, which carry no stylistic signal', () => {
    // Otherwise the most frequent "pattern" in any corpus is that websites use flexbox.
    for (const token of ['flex', 'grid', 'w-full', 'mx-auto', 'items-center']) {
      expect(isSignalToken(token), token).toBe(false);
    }
    expect(extractClassSets('<div className="flex w-full rounded-2xl">')).toEqual([
      ['rounded-2xl'],
    ]);
  });

  it('drops arbitrary values and bare spacing numbers', () => {
    expect(isSignalToken('[mask-image:linear-gradient(...)]')).toBe(false);
    expect(isSignalToken('4')).toBe(false);
    expect(isSignalToken('p-4')).toBe(true);
  });

  it('drops interpolations rather than guessing their value', () => {
    const sets = extractClassSets('<div className={`rounded-2xl ${isOpen ? "a" : "b"}`}>');
    expect(sets).toEqual([['rounded-2xl']]);
  });

  it('deduplicates within one attribute', () => {
    expect(extractClassSets('<div className="rounded-2xl rounded-2xl shadow-2xl">')).toEqual([
      ['rounded-2xl', 'shadow-2xl'],
    ]);
  });
});

describe('extracting effect names', () => {
  it('reads specifiers imported from an animation library', () => {
    const source = `import { motion, AnimatePresence } from 'framer-motion';`;
    expect(extractEffectNames(source)).toEqual(['AnimatePresence', 'motion']);
  });

  it('ignores imports from libraries that are not about motion', () => {
    expect(extractEffectNames(`import { useState } from 'react';`)).toEqual([]);
  });

  it('catches a vendored copy, which an import list cannot', () => {
    // A repository that inlined `AnimatedGradientText` rather than importing it still ships the
    // cliché, and the import scan alone would miss it entirely.
    const source = '<AnimatedGradientText className="x" /><SpotlightCard />';
    expect(extractEffectNames(source)).toContain('AnimatedGradientText');
    expect(extractEffectNames(source)).toContain('SpotlightCard');
  });

  it('does not flag an ordinary component name', () => {
    expect(extractEffectNames('<ServiceList /><PriceTable />')).toEqual([]);
  });
});

describe('what counts as a component file', () => {
  it('reads markup extensions and skips build output', () => {
    expect(isComponentFile('src/Hero.tsx')).toBe(true);
    expect(isComponentFile('src/Hero.astro')).toBe(true);
    expect(isComponentFile('src/Hero.vue')).toBe(true);
    expect(isComponentFile('readme.md')).toBe(false);
    // Reading dist would count a bundled copy of every dependency as this repo's style.
    expect(isComponentFile('dist/Hero.tsx')).toBe(false);
    expect(isComponentFile('node_modules/pkg/Hero.tsx')).toBe(false);
  });
});

describe('storing no source', () => {
  it('keeps tokens and names only, never a snippet', () => {
    // A legal convenience and an architectural requirement in equal measure: a snippet would turn
    // the corpus into the component library this package exists not to build.
    const print = fingerprintRepo('o/r', 'MIT', [
      { path: 'Hero.tsx', content: '<div className="rounded-2xl">Our mission is to empower</div>' },
    ]);
    const serialised = JSON.stringify(print);
    expect(serialised).not.toContain('Our mission');
    expect(serialised).not.toContain('<div');
    expect(print.classSets).toEqual([['rounded-2xl']]);
  });
});

describe('subsets', () => {
  it('produces every k-subset, sorted', () => {
    expect(subsetsOfSize(['b', 'a', 'c'], 2)).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
  });

  it('returns nothing for an impossible size', () => {
    expect(subsetsOfSize(['a'], 2)).toEqual([]);
    expect(subsetsOfSize(['a'], 0)).toEqual([]);
  });
});

describe('the corpus', () => {
  /** A repo shipping the generated-marketing-page fingerprint. */
  const sloppy = (name: string): RepoFingerprint => ({
    repo: name,
    spdx: 'MIT',
    classSets: [['rounded-2xl', 'shadow-2xl', 'backdrop-blur-sm', 'bg-gradient-to-br']],
    effectNames: ['AnimatedGradientText'],
    filesScanned: 1,
  });

  const plain = (name: string): RepoFingerprint => ({
    repo: name,
    spdx: 'MIT',
    classSets: [['border-b', 'text-slate-700']],
    effectNames: [],
    filesScanned: 1,
  });

  it('finds the pattern this package exists to find', () => {
    const corpus = [...Array.from({ length: 8 }, (_, i) => sloppy(`o/sloppy${i}`)), plain('o/p')];
    const found = dropImpliedSubsets(harvestCorpus(corpus));

    const top = found[0];
    expect(top?.kind).toBe('class_set');
    expect(top?.tokens).toEqual([
      'backdrop-blur-sm',
      'bg-gradient-to-br',
      'rounded-2xl',
      'shadow-2xl',
    ]);
    expect(top?.repoCount).toBe(8);
    expect(top?.share).toBeCloseTo(8 / 9);
  });

  it('counts repositories, not hits', () => {
    // One repository with the same card in forty files is one house style. Counting hits would
    // let a single large library mint bans on its own.
    const spammy: RepoFingerprint = {
      repo: 'o/one',
      spdx: 'MIT',
      classSets: Array.from({ length: 40 }, () => ['rounded-2xl', 'shadow-2xl']),
      effectNames: [],
      filesScanned: 40,
    };
    const found = harvestCorpus([spammy, plain('o/a'), plain('o/b')], { minRepos: 2 });
    expect(found.find((c) => c.tokens.includes('rounded-2xl'))).toBeUndefined();
  });

  it('needs absolute support as well as prevalence', () => {
    // 100% of three repositories is not evidence about what people copy.
    const tiny = [sloppy('o/a'), sloppy('o/b'), sloppy('o/c')];
    expect(harvestCorpus(tiny, { minRepos: 5 })).toEqual([]);
    expect(harvestCorpus(tiny, { minRepos: 3 }).length).toBeGreaterThan(0);
  });

  it('needs prevalence as well as absolute support', () => {
    // 50 repositories out of 5000 is a niche, not a cliché.
    const corpus = [
      ...Array.from({ length: 6 }, (_, i) => sloppy(`o/s${i}`)),
      ...Array.from({ length: 94 }, (_, i) => plain(`o/p${i}`)),
    ];
    const strict = harvestCorpus(corpus, { minRepos: 5, minShare: 0.15 });
    expect(strict.some((c) => c.tokens.includes('rounded-2xl'))).toBe(false);
    // The other 94 repos genuinely do all share their pair, and 94% is a finding. Asserting the
    // whole result empty was the test being wrong about its own fixture.
    const loose = harvestCorpus(corpus, { minRepos: 5, minShare: 0.05 });
    expect(loose.some((c) => c.tokens.includes('rounded-2xl'))).toBe(true);
  });

  it('drops subsets implied by a larger set that also crossed', () => {
    // Without this a reviewer reads the same finding once per subset: the 4-token set plus its
    // six pairs and four triples.
    const corpus = Array.from({ length: 8 }, (_, i) => sloppy(`o/s${i}`));
    const raw = harvestCorpus(corpus);
    const kept = dropImpliedSubsets(raw);
    expect(raw.length).toBeGreaterThan(kept.length);
    expect(kept.filter((c) => c.kind === 'class_set')).toHaveLength(1);
  });

  it('reports effect names separately from class sets', () => {
    const corpus = Array.from({ length: 8 }, (_, i) => sloppy(`o/s${i}`));
    const effects = harvestCorpus(corpus).filter((c) => c.kind === 'effect_name');
    expect(effects.map((c) => c.tokens[0])).toContain('AnimatedGradientText');
  });

  it('skips a pattern already banned, so the queue does not refill', () => {
    const corpus = Array.from({ length: 8 }, (_, i) => sloppy(`o/s${i}`));
    const found = harvestCorpus(corpus, { known: ['rounded-2xl'] });
    expect(found.every((c) => !c.tokens.includes('rounded-2xl'))).toBe(true);
  });

  it('names its evidence, and names it the same way twice', () => {
    // A proposal whose supporting repositories change between runs is a proposal nobody trusts.
    const corpus = Array.from({ length: 8 }, (_, i) => sloppy(`o/s${i}`));
    const first = harvestCorpus(corpus)[0];
    const again = harvestCorpus([...corpus].reverse())[0];
    expect(first?.examples).toEqual(again?.examples);
    expect(first?.examples.length).toBe(5);
  });

  it('returns nothing for an empty corpus rather than dividing by zero', () => {
    expect(harvestCorpus([])).toEqual([]);
  });

  it('hashes a set order-independently', () => {
    expect(patternId(['b', 'a'])).toBe(patternId(['a', 'b']));
  });
});

describe('the proposal queue', () => {
  const records = () =>
    harvestRecords(
      harvestCorpus(
        Array.from({ length: 8 }, (_, i) => ({
          repo: `o/s${i}`,
          spdx: 'MIT',
          classSets: [['rounded-2xl', 'shadow-2xl']],
          effectNames: [],
          filesScanned: 1,
        })),
      ),
      { corpusSize: 8, now: new Date('2026-10-04T00:00:00Z') },
    );

  it('marks every row a proposal in the row itself', () => {
    // So a reader of the file cannot mistake it for a rule. There is no code path from here to
    // BANNED_COPY; promotion is a human editing tier1.ts.
    expect(records().every((record) => record.status === 'proposal')).toBe(true);
  });

  it('appends as JSONL and deduplicates against what is there', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ada-harvest-')), '_proposed', 'bans.jsonl');
    const written = appendHarvest(path, records());
    expect(written).toBeGreaterThan(0);
    // The same two hundred repositories will propose the same patterns next week.
    expect(appendHarvest(path, records())).toBe(0);
    expect(readFileSync(path, 'utf8').trim().split('\n')).toHaveLength(written);
  });

  it('survives a corrupt line, because the queue is an inbox', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ada-harvest-')), 'bans.jsonl');
    writeFileSync(path, 'not json\n', 'utf8');
    expect(appendHarvest(path, records())).toBeGreaterThan(0);
  });

  it('writes nothing for nothing', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'ada-harvest-')), 'bans.jsonl');
    expect(appendHarvest(path, [])).toBe(0);
  });

  it('says in the log that it never blocks', () => {
    const lines = harvestLines(harvestCorpus([]), 0);
    expect(lines.join(' ')).toContain('found nothing');
    const withFindings = harvestLines(
      [{ id: 'x', kind: 'class_set', tokens: ['a', 'b'], repoCount: 8, share: 0.8, examples: [] }],
      10,
    );
    expect(withFindings.join(' ')).toContain('promotion to tier 1 is a human');
  });
});

describe('discovery', () => {
  function fakeFetch(body: unknown, status = 200) {
    const calls: string[] = [];
    const fetchLike: FetchLike = async (url) => {
      calls.push(url);
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as Response;
    };
    return { calls, fetchLike };
  }

  const item = (name: string, spdx: string | null) => ({
    full_name: name,
    stargazers_count: 500,
    default_branch: 'main',
    pushed_at: '2026-09-01T00:00:00Z',
    license: spdx === null ? null : { spdx_id: spdx },
  });

  it('refuses to run without a token, and says why', async () => {
    await expect(discoverRepos({ token: '', queries: [] })).rejects.toThrow(
      MissingGitHubTokenError,
    );
    await expect(discoverRepos({ token: '  ' })).rejects.toThrow(/10 requests per minute/);
  });

  it('keeps permissive repos and names the ones it skipped', async () => {
    const { fetchLike } = fakeFetch({
      items: [item('o/mit', 'MIT'), item('o/none', null), item('o/gpl', 'GPL-3.0')],
    });
    const result = await discoverRepos({
      token: 't',
      fetch: fetchLike,
      queries: ['topic:shadcn-ui stars:>100'],
    });
    expect(result.repos.map((r) => r.repo)).toEqual(['o/mit']);
    // Skipped, not dropped: M in "N of M repositories" has to be explainable.
    expect(result.skipped.map((s) => s.repo).sort()).toEqual(['o/gpl', 'o/none']);
  });

  it('deduplicates a repo surfaced by two queries', async () => {
    const { fetchLike } = fakeFetch({ items: [item('o/mit', 'MIT')] });
    const result = await discoverRepos({
      token: 't',
      fetch: fetchLike,
      queries: ['topic:a', 'topic:b'],
    });
    expect(result.repos).toHaveLength(1);
  });

  it('throws on a non-2xx rather than returning an empty corpus', async () => {
    // An empty corpus would silently propose nothing and look like a clean result.
    const { fetchLike } = fakeFetch({ message: 'rate limited' }, 403);
    await expect(
      discoverRepos({ token: 't', fetch: fetchLike, queries: ['topic:a'] }),
    ).rejects.toThrow(GitHubHttpError);
  });

  it('caps the page size at GitHub’s limit', async () => {
    const { fetchLike, calls } = fakeFetch({ items: [] });
    await discoverRepos({ token: 't', fetch: fetchLike, queries: ['topic:a'], perQuery: 500 });
    expect(calls[0]).toContain('per_page=100');
  });

  it('floors the queries at 100 stars, because unstarred is not evidence', () => {
    // The argument is "the most-copied libraries ship this".
    for (const query of DISCOVERY_QUERIES) expect(query).toContain('stars:>100');
  });
});
