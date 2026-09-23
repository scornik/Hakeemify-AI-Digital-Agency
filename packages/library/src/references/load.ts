/**
 * The one piece of the reference harness that touches a filesystem: reading the index.
 *
 * Kept apart from `harness.ts` so the addressing, the storage contract and the resolver stay
 * pure and testable with no fixtures on disk — which is what lets the gate package call them
 * in a worker that has no library checkout.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { REFERENCES_DIR } from '../paths.js';
import {
  REFERENCE_INDEX_FILENAME,
  ReferenceIndexFile,
  buildReferenceIndex,
  type ReferenceIndex,
} from './harness.js';

export class ReferenceIndexError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`the reference index did not load:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ReferenceIndexError';
  }
}

export const EMPTY_INDEX: ReferenceIndexFile = { schema_version: 1, entries: [] };

/**
 * Read `<root>/index.json`.
 *
 * An absent index is an **empty** index, not an error. Before P5 renders anything there is no
 * index, and a harness that threw would make "the library has no reference renders yet"
 * indistinguishable from "the index is corrupt".
 */
export function readReferenceIndex(root: string = REFERENCES_DIR): ReferenceIndex {
  const path = join(root, REFERENCE_INDEX_FILENAME);
  if (!existsSync(path)) return buildReferenceIndex(EMPTY_INDEX);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ReferenceIndexError([
      `${path} is not valid JSON: ${error instanceof Error ? error.message : 'unreadable'}`,
    ]);
  }

  const parsed = ReferenceIndexFile.safeParse(raw);
  if (!parsed.success) {
    throw new ReferenceIndexError(
      z
        .prettifyError(parsed.error)
        .split('\n')
        .filter(Boolean)
        .map((line) => `${path}: ${line.trim()}`),
    );
  }
  return buildReferenceIndex(parsed.data);
}

/** Write an index, validating it on the way out so a bad one is never persisted. */
export function writeReferenceIndex(
  file: ReferenceIndexFile,
  root: string = REFERENCES_DIR,
): string {
  const parsed = ReferenceIndexFile.safeParse(file);
  if (!parsed.success) {
    throw new ReferenceIndexError(
      z
        .prettifyError(parsed.error)
        .split('\n')
        .filter(Boolean)
        .map((line) => line.trim()),
    );
  }
  const path = join(root, REFERENCE_INDEX_FILENAME);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(parsed.data, null, 2)}\n`, 'utf8');
  return path;
}
