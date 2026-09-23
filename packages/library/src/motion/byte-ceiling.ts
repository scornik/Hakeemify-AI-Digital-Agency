/**
 * The byte ceiling, measured.
 *
 * ARCHITECTURE §8 tier 1: "per-effect byte ceiling — each pattern id's measured gz bytes ≤
 * declared". Measured with node's own `zlib`, because a size check that needs a dependency is
 * a size check somebody will eventually delete.
 *
 * Two deliberate choices:
 *
 * - **Level 9, fixed.** The number has to be reproducible across machines and CI, and zlib's
 *   default level is a compile-time property of whoever built node. It is also the closest
 *   cheap proxy for what a CDN will actually serve.
 * - **An effect's sources are concatenated and measured together**, because they ship together.
 *   Measuring them separately would understate the total by one gzip header per file and
 *   overstate the compression by denying the dictionary the whole payload.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { MotionEffect } from './registry.js';

/** Gzipped size of a buffer, at a fixed level so the number is reproducible. */
export function gzipBytes(content: Buffer | string): number {
  return gzipSync(typeof content === 'string' ? Buffer.from(content, 'utf8') : content, {
    level: 9,
  }).byteLength;
}

export interface ByteCeilingMeasurement {
  readonly id: string;
  readonly tier: MotionEffect['tier'];
  readonly declared: number;
  readonly measured: number;
  readonly sources: readonly string[];
  /** `planned` effects have no source; the measurement is reported as untested, not as a pass. */
  readonly state: 'pass' | 'fail' | 'not_measured';
  readonly missing: readonly string[];
}

export class MotionByteCeilingError extends Error {
  constructor(readonly failures: readonly ByteCeilingMeasurement[]) {
    super(
      'motion effects exceed their declared byte ceilings:\n' +
        failures
          .map(
            (f) =>
              `  - ${f.id} (${f.tier}): ${f.measured} gz bytes, declared ceiling ${f.declared}` +
              (f.missing.length > 0 ? `; missing source ${f.missing.join(', ')}` : ''),
          )
          .join('\n'),
    );
    this.name = 'MotionByteCeilingError';
  }
}

/** Measure one effect. `dir` is the directory its `sources` are relative to. */
export function measureEffect(effect: MotionEffect, dir: string): ByteCeilingMeasurement {
  const missing: string[] = [];
  const buffers: Buffer[] = [];
  for (const source of effect.sources) {
    const path = join(dir, source);
    if (!existsSync(path)) {
      missing.push(source);
      continue;
    }
    buffers.push(readFileSync(path));
  }

  const measured = buffers.length === 0 ? 0 : gzipBytes(Buffer.concat(buffers));
  const state: ByteCeilingMeasurement['state'] =
    missing.length > 0
      ? 'fail'
      : effect.sources.length === 0
        ? effect.status === 'planned'
          ? 'not_measured'
          : 'pass' // tier_0 ships nothing and declares 0; that is a real pass
        : measured <= effect.max_gz_bytes
          ? 'pass'
          : 'fail';

  return {
    id: effect.id,
    tier: effect.tier,
    declared: effect.max_gz_bytes,
    measured,
    sources: effect.sources,
    state,
    missing,
  };
}

export function measureEffects(
  effects: readonly MotionEffect[],
  dir: string,
): ByteCeilingMeasurement[] {
  return effects.map((effect) => measureEffect(effect, dir));
}

/** Throws `MotionByteCeilingError` when any effect is over its ceiling or missing its source. */
export function assertByteCeilings(
  effects: readonly MotionEffect[],
  dir: string,
): ByteCeilingMeasurement[] {
  const measurements = measureEffects(effects, dir);
  const failures = measurements.filter((m) => m.state === 'fail');
  if (failures.length > 0) throw new MotionByteCeilingError(failures);
  return measurements;
}

/* -------------------------------------------------------------------------------------- */
/* Compositor-only property audit                                                           */
/* -------------------------------------------------------------------------------------- */

export interface PropertyViolation {
  readonly id: string;
  readonly source: string;
  readonly property: string;
  readonly message: string;
}

const TRANSITION_PROPERTY = /transition-property\s*:\s*([^;}]+)/g;
const WILL_CHANGE = /will-change\s*:\s*([^;}]+)/g;
const KEYFRAMES = /@keyframes[^{]*\{([\s\S]*?)\n\s*\}/g;
const DECLARATION = /([a-z-]+)\s*:/g;

/** Property names that may appear inside a keyframe without being animated geometry. */
const KEYFRAME_IGNORE = new Set(['animation-timing-function', 'offset-distance']);

/**
 * Scan an effect's stylesheets for animated properties outside its declared set.
 *
 * This is a regex pass over CSS, not a parser, and it is deliberately narrow: it reads
 * `transition-property`, `will-change`, and the declarations inside `@keyframes`. Those are the
 * three places a non-composited animation actually gets introduced. It does not try to prove
 * the absence of one — the gate's `non-composited-animations = 0` audit does that in a real
 * browser. What it does is catch the mistake at library-build time, where it is cheap.
 */
export function auditEffectProperties(effect: MotionEffect, dir: string): PropertyViolation[] {
  const allowed = new Set<string>(effect.allowed_properties);
  const violations: PropertyViolation[] = [];

  const flag = (source: string, property: string, where: string): void => {
    if (allowed.has(property) || property === 'none' || property === 'all') return;
    violations.push({
      id: effect.id,
      source,
      property,
      message: `${where} names "${property}", which effect "${effect.id}" does not declare (allowed: ${[...allowed].join(', ') || 'none'})`,
    });
  };

  for (const source of effect.sources) {
    if (!source.endsWith('.css')) continue;
    const path = join(dir, source);
    if (!existsSync(path)) continue;
    const css = readFileSync(path, 'utf8');

    for (const match of css.matchAll(TRANSITION_PROPERTY)) {
      for (const property of (match[1] ?? '').split(',')) {
        flag(source, property.trim(), 'transition-property');
      }
    }
    for (const match of css.matchAll(WILL_CHANGE)) {
      for (const property of (match[1] ?? '').split(',')) {
        flag(source, property.trim(), 'will-change');
      }
    }
    for (const block of css.matchAll(KEYFRAMES)) {
      for (const declaration of (block[1] ?? '').matchAll(DECLARATION)) {
        const property = (declaration[1] ?? '').trim();
        if (KEYFRAME_IGNORE.has(property)) continue;
        flag(source, property, '@keyframes');
      }
    }
  }

  return violations;
}

export function auditEffectsProperties(
  effects: readonly MotionEffect[],
  dir: string,
): PropertyViolation[] {
  return effects.flatMap((effect) => auditEffectProperties(effect, dir));
}
