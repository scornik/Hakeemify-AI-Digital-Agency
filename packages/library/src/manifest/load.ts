/**
 * Loading section manifests off disk, with every id validated at boot (ARCHITECTURE §2).
 *
 * Boot validation accumulates. A library with four bad manifests reports four, because the
 * alternative is four rounds of "fix it, run it, find the next one" — and because a loader
 * that stops at the first failure tempts whoever is in a hurry to comment out a manifest.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { SECTIONS_DIR } from '../paths.js';
import { readYamlFile } from '../tokens/load.js';
import { SectionManifest } from './schema.js';
import { checkManifestImports, type ImportProblem } from './import-scan.js';

export const MANIFEST_FILENAME = 'manifest.yml';

export interface LoadedManifest {
  readonly manifest: SectionManifest;
  /** Absolute path of the manifest file. */
  readonly path: string;
  /** Absolute path of the directory `files[].path` is relative to. */
  readonly dir: string;
}

export class LibraryLoadError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`the section library did not load:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'LibraryLoadError';
  }
}

/** Every `manifest.yml` under a root, depth-first, in a stable order. */
export function manifestPaths(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === MANIFEST_FILENAME) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Load and validate every manifest under a root. Throws `LibraryLoadError` listing every
 * problem across every file.
 */
export function loadManifests(root: string = SECTIONS_DIR): LoadedManifest[] {
  const loaded: LoadedManifest[] = [];
  const problems: string[] = [];
  const seen = new Map<string, string>();

  for (const path of manifestPaths(root)) {
    let raw: unknown;
    try {
      raw = readYamlFile(path);
    } catch (error) {
      problems.push(`${path}: ${error instanceof Error ? error.message : 'unreadable'}`);
      continue;
    }
    const parsed = SectionManifest.safeParse(raw);
    if (!parsed.success) {
      for (const line of z.prettifyError(parsed.error).split('\n').filter(Boolean)) {
        problems.push(`${path}: ${line.trim()}`);
      }
      continue;
    }
    const previous = seen.get(parsed.data.name);
    if (previous !== undefined) {
      problems.push(`${path}: id "${parsed.data.name}" is already claimed by ${previous}`);
      continue;
    }
    seen.set(parsed.data.name, path);
    loaded.push({ manifest: parsed.data, path, dir: dirname(path) });
  }

  if (problems.length > 0) throw new LibraryLoadError(problems);
  return loaded;
}

/** Run the drift check across a loaded library. An empty result means no manifest lies. */
export function checkLibraryImports(
  loaded: readonly LoadedManifest[],
  options: { readonly reportUnused?: boolean } = {},
): ImportProblem[] {
  return loaded.flatMap((entry) =>
    checkManifestImports(entry.manifest, {
      dir: entry.dir,
      ...(options.reportUnused === undefined ? {} : { reportUnused: options.reportUnused }),
    }),
  );
}
