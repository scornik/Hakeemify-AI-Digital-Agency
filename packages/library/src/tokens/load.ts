/**
 * Reading design systems off disk.
 *
 * `js-yaml` is loaded with the default (safe) schema, so a YAML file cannot construct an
 * arbitrary object. Authored assets are trusted, but "trusted" and "may instantiate classes at
 * load time" are different claims.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { BUILD_DIR, DESIGN_SYSTEMS_DIR } from '../paths.js';
import { compileDesignSystem, type CompiledDesignSystem } from './compile.js';

export function readYamlFile(path: string): unknown {
  return parseYaml(readFileSync(path, 'utf8'), { filename: path });
}

/** Compile one authored file. Propagates `TokenCompileError` with the path attached. */
export function compileDesignSystemFile(path: string): CompiledDesignSystem {
  try {
    return compileDesignSystem(readYamlFile(path));
  } catch (error) {
    if (error instanceof Error) error.message = `${basename(path)}: ${error.message}`;
    throw error;
  }
}

export function designSystemFiles(dir: string = DESIGN_SYSTEMS_DIR): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => join(dir, name));
}

/** Compile every design system in a directory, keyed by id. */
export function compileDesignSystems(
  dir: string = DESIGN_SYSTEMS_DIR,
): Map<string, CompiledDesignSystem> {
  const out = new Map<string, CompiledDesignSystem>();
  for (const path of designSystemFiles(dir)) {
    const compiled = compileDesignSystemFile(path);
    const existing = out.get(compiled.id);
    if (existing !== undefined) {
      throw new Error(`two design systems claim the id ${compiled.id}`);
    }
    out.set(compiled.id, compiled);
  }
  return out;
}

/**
 * Write `<dir>/<id>/tokens.css`. One file per design system, named by id rather than by ref,
 * because a build pins the ref in its manifest and the renderer only ever links one.
 */
export function writeTokensCss(
  compiled: CompiledDesignSystem,
  dir: string = join(BUILD_DIR, 'design-systems'),
): string {
  const target = join(dir, compiled.id);
  mkdirSync(target, { recursive: true });
  const path = join(target, 'tokens.css');
  writeFileSync(path, `${compiled.css}\n`, 'utf8');
  return path;
}
