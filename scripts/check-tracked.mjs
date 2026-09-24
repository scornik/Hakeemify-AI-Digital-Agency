#!/usr/bin/env node
/**
 * Fail the build when a source file exists locally but is excluded from the repository.
 *
 * This exists because the failure it catches happened twice in one afternoon, and both times it
 * was invisible locally and fatal in CI:
 *
 * - `.gitignore` carried a bare `artifacts/`, meant for the root output directory. A bare
 *   pattern matches a directory of that name at **any** depth, so it also matched
 *   `packages/gate/src/artifacts/`, and `serve.ts` — which both the browser pass and the
 *   Lighthouse pass import — was never committed.
 * - `packages/library/.gitignore` carried a bare `build/`, meant for compiled tokens, which
 *   also swallowed `packages/library/fixtures/build/` — the renderer's committed input
 *   fixtures.
 *
 * In both cases `git add -A` skipped the file without a word, every local run stayed green
 * because the file was on disk, and CI failed on a missing module. That asymmetry is what makes
 * it worth a check of its own: the machine that would notice is the one that cannot see it.
 *
 * The check is deliberately about *outcomes* rather than pattern syntax. Policing `.gitignore`
 * for unanchored patterns would be a lint rule with exceptions; asking "is any source file
 * ignored?" is the actual question.
 */
import { execFileSync } from 'node:child_process';

/** Directory names whose contents are generated and correctly ignored, at any depth. */
const OUTPUT_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-site',
  'dist-e2e',
  'coverage',
  '.astro',
  '.turbo',
  'test-results',
  'playwright-report',
  'blob-report',
  '.lighthouseci',
]);

/**
 * Extensions that are source until proven otherwise. Anything here, ignored and outside an
 * output directory, is the bug this script exists for.
 */
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.mjs',
  '.cjs',
  '.astro',
  '.json',
  '.yml',
  '.yaml',
  '.css',
  '.html',
  '.md',
  '.svg',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.woff2',
]);

/**
 * `packages/library/build/` holds the compiled tokens the library emits. It is a real output
 * directory that happens not to be called `dist`, so it is named here rather than by pattern —
 * an explicit list of one is better than a rule that would also re-admit `fixtures/build/`.
 */
const OUTPUT_PATHS = ['packages/library/build/'];

const roots = ['packages', 'scripts', 'docs', '.github'];

const ignored = [];
for (const root of roots) {
  let output;
  try {
    // `--directory` collapses a wholly-ignored directory into one entry instead of listing
    // every file under it. Without it this walks every node_modules tree and takes minutes.
    // It also makes the second failure mode visible: `fixtures/build/` had no tracked files, so
    // it appears as a directory, and a directory inside a source tree is itself the finding.
    output = execFileSync(
      'git',
      ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--', root],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    // A root that does not exist is not a failure; the repository may be checked out partially.
    continue;
  }
  for (const line of output.split('\n')) {
    if (line.trim() !== '') ignored.push(line.trim());
  }
}

const offenders = ignored.filter((path) => {
  if (OUTPUT_PATHS.some((prefix) => path.startsWith(prefix))) return false;
  if (path.split('/').some((segment) => segment !== '' && OUTPUT_DIRS.has(segment))) return false;

  // A whole directory ignored inside a source tree. This is the `fixtures/build/` case: no file
  // under it was ever tracked, so git reports the directory and nothing inside it.
  if (path.endsWith('/')) return true;

  const dot = path.lastIndexOf('.');
  return dot !== -1 && SOURCE_EXTENSIONS.has(path.slice(dot).toLowerCase());
});

if (offenders.length > 0) {
  console.error(
    `${offenders.length} source file(s) exist on disk but are excluded from the repository.\n` +
      'Local runs will pass and CI will fail on a missing file. Anchor the .gitignore pattern\n' +
      'to the directory it was meant for (a leading slash), then `git add` the file.\n',
  );
  for (const path of offenders) {
    let reason;
    try {
      // `check-ignore -v` names the ignore file and line, which is the whole fix.
      reason = execFileSync('git', ['check-ignore', '-v', '--', path], {
        encoding: 'utf8',
      }).trim();
    } catch {
      reason = path;
    }
    console.error(`  ${reason}`);
  }
  process.exit(1);
}

console.log(`tracked ok — no source file is excluded (${ignored.length} ignored path(s) checked)`);
