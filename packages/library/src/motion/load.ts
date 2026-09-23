/** Loading the motion registry, validated at boot like every other authored asset. */
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { MOTION_DIR } from '../paths.js';
import { readYamlFile } from '../tokens/load.js';
import { MotionRegistryFile, type MotionEffect } from './registry.js';

export const MOTION_REGISTRY_FILENAME = 'registry.yml';

export class MotionRegistryError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`the motion registry did not load:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'MotionRegistryError';
  }
}

export interface LoadedMotionRegistry {
  readonly file: MotionRegistryFile;
  readonly path: string;
  /** The directory `sources` are relative to. */
  readonly dir: string;
  readonly byId: ReadonlyMap<string, MotionEffect>;
}

export function loadMotionRegistry(
  path: string = join(MOTION_DIR, MOTION_REGISTRY_FILENAME),
): LoadedMotionRegistry {
  const parsed = MotionRegistryFile.safeParse(readYamlFile(path));
  if (!parsed.success) {
    throw new MotionRegistryError(
      z
        .prettifyError(parsed.error)
        .split('\n')
        .filter(Boolean)
        .map((line) => line.trim()),
    );
  }
  return {
    file: parsed.data,
    path,
    dir: dirname(path),
    byId: new Map(parsed.data.effects.map((effect) => [effect.id, effect])),
  };
}
