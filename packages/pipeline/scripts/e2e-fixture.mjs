#!/usr/bin/env node
/**
 * P6's definition of done: one committed business through all sixteen stages to a green gate.
 *
 * Exits non-zero when the gate is not green, so `pnpm e2e:fixture` is the acceptance test rather
 * than a report somebody has to read and interpret.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PIPELINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { runFixtureEndToEnd, reportLines } = await import(
  pathToFileURL(join(PIPELINE_ROOT, 'dist', 'src', 'e2e', 'run-fixture.js')).href
);

const artifacts = await runFixtureEndToEnd();
for (const line of reportLines(artifacts)) console.log(line);

if (!artifacts.gate.canShip) {
  console.error('\nthe gate is not green; the build does not ship');
  process.exit(1);
}
