#!/usr/bin/env node
/**
 * Compile every authored design system to `build/design-systems/<id>/tokens.css`.
 *
 * Run from the site build rather than expected of a human: a stale `tokens.css` is the kind of
 * thing that produces a site that looks almost right, and the contrast gate only protects the
 * build it ran in.
 */
import { pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIBRARY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const { compileDesignSystems, writeTokensCss } = await import(
  pathToFileURL(join(LIBRARY_ROOT, 'dist', 'src', 'tokens', 'load.js')).href
);

const compiled = compileDesignSystems();
if (compiled.size === 0) {
  throw new Error('no design systems compiled; the renderer has no tokens to link');
}

for (const system of compiled.values()) {
  const path = writeTokensCss(system);
  console.log(`compiled ${system.id} -> ${path}`);
}
