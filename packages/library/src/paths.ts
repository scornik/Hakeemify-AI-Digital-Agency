/**
 * Where the authored assets live.
 *
 * Resolved by walking up from this module until a `package.json` named `@ada/library` turns
 * up, rather than by counting `..` segments. The same code runs from `src/` under Vitest and
 * from `dist/src/` after `tsc --build`, and those are at different depths; a hard-coded
 * relative path works in exactly one of them and fails silently in the other by resolving to
 * a directory that does not exist.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findPackageRoot(from: string): string {
  let current = from;
  for (;;) {
    const manifest = join(current, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
        if (pkg.name === '@ada/library') return current;
      } catch {
        // An unreadable package.json is somebody else's problem; keep walking.
      }
    }
    const parent = dirname(current);
    /* c8 ignore next 4 -- only reachable if the package is not installed as a package */
    if (parent === current) {
      throw new Error('could not locate the @ada/library package root from ' + from);
    }
    current = parent;
  }
}

export const LIBRARY_ROOT: string = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

/** Authored assets: design systems, motion registry. Section variants land in P5/P7. */
export const ASSETS_DIR: string = join(LIBRARY_ROOT, 'assets');
export const DESIGN_SYSTEMS_DIR: string = join(ASSETS_DIR, 'design-systems');
export const MOTION_DIR: string = join(ASSETS_DIR, 'motion');
export const SECTIONS_DIR: string = join(ASSETS_DIR, 'sections');
export const GRADES_DIR: string = join(ASSETS_DIR, 'grades');

/** Reference renders. The gate reads this tree; P3 owns its addressing (ARCHITECTURE §7.4). */
export const REFERENCES_DIR: string = join(LIBRARY_ROOT, 'references');

/** Compiled output. Git-ignored: `tokens.css` is a build product, not an authored asset. */
export const BUILD_DIR: string = join(LIBRARY_ROOT, 'build');

export const fromLibraryRoot = (...segments: string[]): string =>
  resolve(LIBRARY_ROOT, ...segments);
