#!/usr/bin/env node
/**
 * `pnpm library:grade` — record a human grade (ARCHITECTURE §10, v4 §11).
 *
 * ## Why the refusal is here and not in the TypeScript
 *
 * This file is plain `.mjs` and imports nothing until after it has decided to run. Two reasons:
 *
 * 1. The refusal is the security property. If it lived past an `import`, a broken build, a
 *    missing `dist/`, or a module that throws on load would turn "refuses to run" into
 *    "crashes", and a crash is not a refusal — it is an outcome somebody will work around.
 * 2. It makes the refusal testable without compiling anything, which is the difference between
 *    a check that is asserted on every run and one that is asserted when someone remembers.
 *
 * ## Why it refuses at all
 *
 * A grade is the one thing in this system no machine may produce. Tier 0 — `signature_move`,
 * the rubric, ELO within family — is, in the research's words, the whole game; everything
 * downstream can only remove failure, never add quality. A grading tool that runs unattended
 * in CI is a grading tool that will eventually be given a `--yes` flag, and at that point the
 * library grades itself.
 */

const EXIT_REFUSED = 2;

const reasons = [];
if (process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false') {
  reasons.push('CI is set in the environment');
}
if (!process.stdin.isTTY) reasons.push('stdin is not a terminal');
if (!process.stdout.isTTY) reasons.push('stdout is not a terminal');

if (reasons.length > 0) {
  console.error('library:grade refuses to run non-interactively.');
  console.error('');
  for (const reason of reasons) console.error(`  - ${reason}`);
  console.error('');
  console.error('A grade is a human judgement. ARCHITECTURE.md §10 reserves it for a person:');
  console.error('an agent may build this tool and may not use it. Run it from a real terminal,');
  console.error('as the reviewer whose name will be on the record.');
  process.exit(EXIT_REFUSED);
}

const { createInterface } = await import('node:readline/promises');
const { runGradingSession, GradingAborted } = await import('../dist/src/grades/index.js');

const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  await runGradingSession({
    io: {
      ask: (question) => rl.question(question),
      write: (line) => process.stdout.write(`${line}\n`),
    },
  });
} catch (error) {
  if (error instanceof GradingAborted) {
    console.error(`\nAborted: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
} finally {
  rl.close();
}
