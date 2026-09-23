/**
 * The token compiler: DTCG YAML → static `tokens.css`.
 *
 *   seeds → algorithms → semantic roles → conditions table → CSS custom properties
 *
 * (SYNTHESIS §7.1, v4 §3.) Two properties matter more than the pipeline itself:
 *
 * - **Contrast is computed here, and a failure fails the build.** Not a lint, not a gate row
 *   you can waive — a design system whose own roles cannot be read is not shippable, and the
 *   cheapest place to find that out is the moment the file is compiled. Every declared pair is
 *   checked in the base scheme *and* in every condition that moves either side of it, because
 *   a dark scheme that quietly drops below 4.5:1 is the normal way this fails.
 * - **The reduced-motion kill switch is emitted unconditionally** (ARCHITECTURE §1.2). It does
 *   not depend on a design system declaring motion tokens, and it does not depend on JS.
 *
 * Failures accumulate. A file with four bad pairs reports four, for the same reason the
 * invariant runner never stops at the first violation.
 */
import { z } from 'zod';
import {
  generatePalette,
  radiusScale,
  spacingScale,
  typeScale,
  type ScaleStep,
} from './algorithms.js';
import { contrastRatio, meetsWcag, parseHexColour, wcagMinimum, type TextSize } from './colour.js';
import {
  CONDITIONS,
  CONDITION_NAMES,
  LAYER_ORDER,
  REDUCED_MOTION_KILL_SWITCH,
  type ConditionName,
} from './conditions.js';
import {
  DesignSystemFile,
  LiteralToken,
  RoleToken,
  SeedToken,
  versionedRef,
  type ContrastPair,
} from './design-system-file.js';

export class TokenCompileError extends Error {
  constructor(
    readonly designSystemId: string,
    readonly problems: readonly string[],
  ) {
    super(
      `design system ${designSystemId} does not compile:\n` +
        problems.map((p) => `  - ${p}`).join('\n'),
    );
    this.name = 'TokenCompileError';
  }
}

export class TokenContrastError extends TokenCompileError {
  constructor(
    designSystemId: string,
    readonly failures: readonly ContrastCheck[],
  ) {
    super(
      designSystemId,
      failures.map(
        (f) =>
          `contrast ${f.fg} on ${f.bg} under ${f.condition} is ${f.ratio.toFixed(2)}:1, ` +
          `below the ${f.required}:1 required for ${f.size} text ` +
          `(${f.fgValue} on ${f.bgValue})`,
      ),
    );
    this.name = 'TokenContrastError';
  }
}

export interface ContrastCheck {
  readonly fg: string;
  readonly bg: string;
  readonly fgValue: string;
  readonly bgValue: string;
  /** `base`, or the name of the condition under which the pair was evaluated. */
  readonly condition: 'base' | ConditionName;
  readonly size: TextSize;
  readonly ratio: number;
  readonly required: number;
  readonly passed: boolean;
}

export interface SkippedContrastCheck {
  readonly fg: string;
  readonly bg: string;
  readonly condition: 'base' | ConditionName;
  /** Always a system colour today: `Canvas`, `CanvasText`, `ButtonFace`, … */
  readonly reason: string;
}

export interface CompiledDesignSystem {
  readonly id: string;
  readonly version: string;
  /** `reference_v1@1` — the form a build manifest pins (v4 §12). */
  readonly ref: string;
  readonly status: DesignSystemFile['status'];
  readonly css: string;
  /** Base-scheme custom properties, in emission order. */
  readonly variables: ReadonlyMap<string, string>;
  /** Per-condition overrides, keyed by condition then custom property. */
  readonly conditionVariables: ReadonlyMap<ConditionName, ReadonlyMap<string, string>>;
  readonly palettes: Readonly<Record<string, readonly string[]>>;
  readonly contrastChecks: readonly ContrastCheck[];
  readonly contrastSkipped: readonly SkippedContrastCheck[];
}

/* -------------------------------------------------------------------------------------- */
/* DTCG walking                                                                             */
/* -------------------------------------------------------------------------------------- */

interface Leaf {
  readonly path: string[];
  readonly node: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * DTCG's own group/token rule: a node carrying `$type` is a token, anything else is a group.
 * Keys beginning with `$` are group metadata (`$description`) and are never tokens.
 */
function walkTokens(tree: Record<string, unknown>, path: string[] = []): Leaf[] {
  const leaves: Leaf[] = [];
  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith('$')) continue;
    if (!isRecord(value)) continue;
    const next = [...path, key];
    if ('$type' in value) leaves.push({ path: next, node: value });
    else leaves.push(...walkTokens(value, next));
  }
  return leaves;
}

/** `bg.base` → `--ds-bg-base`; `seed.type_base` → `--ds-seed-type-base`. */
export function customProperty(path: readonly string[]): string {
  return `--ds-${path.map((segment) => segment.replace(/_/g, '-')).join('-')}`;
}

const PX = /^(-?[0-9]+(?:\.[0-9]+)?)px$/;

function pixels(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const match = PX.exec(value.trim());
  return match ? Number(match[1]) : null;
}

const px = (value: number): string => `${value}px`;

/* -------------------------------------------------------------------------------------- */
/* Value formatting                                                                         */
/* -------------------------------------------------------------------------------------- */

const NEEDS_QUOTES = /[^A-Za-z0-9_-]/;

function formatLiteral(type: LiteralToken['$type'], value: unknown): string {
  switch (type) {
    case 'fontFamily': {
      const families = Array.isArray(value) ? value : [value];
      return families
        .map((family) => String(family))
        .map((family) => (NEEDS_QUOTES.test(family) ? `"${family}"` : family))
        .join(', ');
    }
    case 'cubicBezier': {
      const points = Array.isArray(value) ? value : [];
      return `cubic-bezier(${points.map((p) => String(p)).join(', ')})`;
    }
    default:
      return String(value);
  }
}

/* -------------------------------------------------------------------------------------- */
/* Compile                                                                                  */
/* -------------------------------------------------------------------------------------- */

/**
 * Compile one authored design system. Throws `TokenCompileError` (or its `TokenContrastError`
 * subclass) with every problem found, never just the first.
 */
export function compileDesignSystem(raw: unknown): CompiledDesignSystem {
  const parsed = DesignSystemFile.safeParse(raw);
  if (!parsed.success) {
    const id = isRecord(raw) && typeof raw['id'] === 'string' ? raw['id'] : '<unreadable>';
    throw new TokenCompileError(id, z.prettifyError(parsed.error).split('\n').filter(Boolean));
  }
  const file = parsed.data;
  const problems: string[] = [];

  /* --- seeds → algorithms ------------------------------------------------------------- */

  const variables = new Map<string, string>();
  const conditionVariables = new Map<ConditionName, Map<string, string>>();
  const palettes: Record<string, string[]> = {};

  const addCondition = (condition: ConditionName, name: string, value: string): void => {
    let bucket = conditionVariables.get(condition);
    if (bucket === undefined) {
      bucket = new Map<string, string>();
      conditionVariables.set(condition, bucket);
    }
    bucket.set(name, value);
  };

  const define = (path: readonly string[], value: string): void => {
    const name = customProperty(path);
    if (variables.has(name)) problems.push(`${name} is defined twice`);
    variables.set(name, value);
  };

  const emitScale = (group: string, steps: readonly ScaleStep[]): void => {
    for (const step of steps) define([group, step.name], px(step.px));
  };

  for (const [key, node] of Object.entries(file.seed)) {
    if (key.startsWith('$')) continue;
    const seed = SeedToken.safeParse(node);
    if (!seed.success) {
      problems.push(`seed.${key}: ${z.prettifyError(seed.error).replace(/\n+/g, '; ')}`);
      continue;
    }
    const { $value, $extensions } = seed.data;
    const algorithm = $extensions.agency;

    define(['seed', key], String($value));

    try {
      switch (algorithm.algorithm) {
        case 'palette': {
          const ramp = generatePalette(String($value));
          palettes[key] = ramp;
          ramp.forEach((hex, index) => define(['palette', key, String(index)], hex));
          break;
        }
        case 'type_scale': {
          const base = pixels($value);
          if (base === null) throw new Error(`seed.${key} must be a px dimension`);
          emitScale(
            'type-size',
            typeScale({ base, ratio: algorithm.ratio, steps: algorithm.steps }),
          );
          break;
        }
        case 'spacing_scale': {
          const unit = pixels($value);
          if (unit === null) throw new Error(`seed.${key} must be a px dimension`);
          emitScale('space', spacingScale({ unit, steps: algorithm.steps }));
          break;
        }
        case 'radius_scale': {
          const base = pixels($value);
          if (base === null) throw new Error(`seed.${key} must be a px dimension`);
          emitScale('radius', radiusScale({ base, steps: algorithm.steps }));
          break;
        }
      }
    } catch (error) {
      problems.push(error instanceof Error ? error.message : `seed.${key} failed to derive`);
    }
  }

  /* --- semantic roles ----------------------------------------------------------------- */

  interface ResolvedRole {
    readonly base: string;
    readonly conditions: Partial<Record<ConditionName, string>>;
  }
  const roles = new Map<string, ResolvedRole>();

  const rampValue = (ramp: string, index: number, where: string): string | null => {
    const steps = palettes[ramp];
    if (steps === undefined) {
      problems.push(`${where} names ramp "${ramp}", which no seed generates`);
      return null;
    }
    const value = steps[index];
    /* c8 ignore next 4 -- index is schema-clamped to the ramp length */
    if (value === undefined) {
      problems.push(`${where} names index ${index}, outside ramp "${ramp}"`);
      return null;
    }
    return value;
  };

  for (const leaf of walkTokens(file.roles)) {
    const dotted = leaf.path.join('.');
    const role = RoleToken.safeParse(leaf.node);
    if (!role.success) {
      problems.push(`roles.${dotted}: ${z.prettifyError(role.error).replace(/\n+/g, '; ')}`);
      continue;
    }
    const spec = role.data.$extensions.agency.role;
    const base = rampValue(spec.ramp, spec.index, `roles.${dotted}`);
    if (base === null) continue;

    const conditions: Partial<Record<ConditionName, string>> = {};
    for (const [condition, override] of Object.entries(spec.conditions ?? {})) {
      const name = condition as ConditionName;
      const value =
        typeof override === 'number'
          ? rampValue(spec.ramp, override, `roles.${dotted}.conditions.${condition}`)
          : override;
      if (value === null) continue;
      conditions[name] = value;
      addCondition(name, customProperty(leaf.path), value);
    }

    roles.set(dotted, { base, conditions });
    define(leaf.path, base);
  }

  /* --- literal tokens ----------------------------------------------------------------- */

  for (const leaf of walkTokens(file.literal)) {
    const dotted = leaf.path.join('.');
    const token = LiteralToken.safeParse(leaf.node);
    if (!token.success) {
      problems.push(`literal.${dotted}: ${z.prettifyError(token.error).replace(/\n+/g, '; ')}`);
      continue;
    }
    define(leaf.path, formatLiteral(token.data.$type, token.data.$value));
    for (const [condition, override] of Object.entries(
      token.data.$extensions?.agency?.conditions ?? {},
    )) {
      addCondition(
        condition as ConditionName,
        customProperty(leaf.path),
        formatLiteral(token.data.$type, override),
      );
    }
  }

  /* --- contrast ----------------------------------------------------------------------- */

  const contrastChecks: ContrastCheck[] = [];
  const contrastSkipped: SkippedContrastCheck[] = [];

  for (const pair of file.contrast.pairs) {
    const fg = roles.get(pair.fg);
    const bg = roles.get(pair.bg);
    if (fg === undefined || bg === undefined) {
      problems.push(
        `contrast pair ${pair.fg} on ${pair.bg} names ${fg === undefined ? pair.fg : pair.bg}, which is not a role`,
      );
      continue;
    }
    // The base scheme, plus every condition that moves either side. A dark scheme that drops
    // below 4.5:1 is the normal way a palette fails, and it is invisible to a base-only check.
    const scopes: ('base' | ConditionName)[] = ['base'];
    for (const condition of CONDITION_NAMES) {
      if (fg.conditions[condition] !== undefined || bg.conditions[condition] !== undefined) {
        scopes.push(condition);
      }
    }
    for (const scope of scopes) {
      const fgValue = scope === 'base' ? fg.base : (fg.conditions[scope] ?? fg.base);
      const bgValue = scope === 'base' ? bg.base : (bg.conditions[scope] ?? bg.base);
      const fgRgb = parseHexColour(fgValue);
      const bgRgb = parseHexColour(bgValue);
      if (fgRgb === null || bgRgb === null) {
        // A system colour is chosen by the OS and has no computable ratio. Forced-colors mode
        // is the user's own high-contrast palette; asserting over it would be theatre.
        contrastSkipped.push({
          fg: pair.fg,
          bg: pair.bg,
          condition: scope,
          reason: `not a computable colour (${fgRgb === null ? fgValue : bgValue})`,
        });
        continue;
      }
      const ratio = contrastRatio(fgRgb, bgRgb);
      contrastChecks.push({
        fg: pair.fg,
        bg: pair.bg,
        fgValue,
        bgValue,
        condition: scope,
        size: pair.size,
        ratio,
        required: wcagMinimum(pair.size),
        passed: meetsWcag(ratio, pair.size),
      });
    }
  }

  if (problems.length > 0) throw new TokenCompileError(file.id, problems);

  const failures = contrastChecks.filter((check) => !check.passed);
  if (failures.length > 0) throw new TokenContrastError(file.id, failures);

  const ref = versionedRef(file);
  return {
    id: file.id,
    version: file.version,
    ref,
    status: file.status,
    css: emitCss(file, ref, variables, conditionVariables),
    variables,
    conditionVariables,
    palettes,
    contrastChecks,
    contrastSkipped,
  };
}

/* -------------------------------------------------------------------------------------- */
/* Emit                                                                                     */
/* -------------------------------------------------------------------------------------- */

function declarations(vars: ReadonlyMap<string, string>, indent: string): string {
  return [...vars].map(([name, value]) => `${indent}${name}: ${value};`).join('\n');
}

function indentBlock(text: string, indent: string): string {
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? indent + line : line))
    .join('\n');
}

function emitCss(
  file: DesignSystemFile,
  ref: string,
  variables: ReadonlyMap<string, string>,
  conditionVariables: ReadonlyMap<ConditionName, ReadonlyMap<string, string>>,
): string {
  const out: string[] = [];
  out.push(`/* ${ref} — generated by @ada/library token compiler. Do not edit. */`);
  out.push(`/* seeds -> algorithms -> semantic roles -> conditions -> custom properties */`);
  out.push('');
  out.push(`@layer ${LAYER_ORDER.join(', ')};`);
  out.push('');

  out.push('@layer tokens {');
  out.push('  :root {');
  out.push(declarations(variables, '    '));
  out.push('  }');

  for (const condition of CONDITION_NAMES) {
    const overrides = conditionVariables.get(condition);
    if (overrides === undefined || overrides.size === 0) continue;
    const definition = CONDITIONS[condition];
    out.push('');
    out.push(`  /* condition: ${condition} — ${definition.description} */`);
    for (const rule of definition.rules) {
      if (rule.at === null) {
        out.push(`  ${rule.selector} {`);
        out.push(declarations(overrides, '    '));
        out.push('  }');
      } else {
        out.push(`  ${rule.at} {`);
        out.push(`    ${rule.selector} {`);
        out.push(declarations(overrides, '      '));
        out.push('    }');
        out.push('  }');
      }
    }
  }
  out.push('}');
  out.push('');

  // ARCHITECTURE §1.2. Emitted whether or not this system declares a single motion token,
  // and emitted in `base` so a section's own stylesheet cannot outrank it by layer order.
  out.push('@layer base {');
  out.push('  /* ARCHITECTURE §1.2 — reduced motion is a CSS rule, never a component contract. */');
  out.push(indentBlock(REDUCED_MOTION_KILL_SWITCH, '  '));
  out.push('}');
  out.push('');

  if (file.$description !== undefined) {
    out.push(`/* ${file.$description.trim().replace(/\s+/g, ' ')} */`);
  }
  return out.join('\n');
}

export type { ContrastPair };
