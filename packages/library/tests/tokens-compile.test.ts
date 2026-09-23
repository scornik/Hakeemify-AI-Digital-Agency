import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONDITION_NAMES,
  DESIGN_SYSTEMS_DIR,
  TokenCompileError,
  TokenContrastError,
  compileDesignSystemFile,
  compileDesignSystems,
  customProperty,
  readYamlFile,
  compileDesignSystem,
  writeTokensCss,
} from '../src/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'design-systems');
const reference = () => compileDesignSystemFile(join(DESIGN_SYSTEMS_DIR, 'reference-v1.yml'));

describe('the reference design system compiles', () => {
  it('emits tokens.css from the authored DTCG file', () => {
    const compiled = reference();
    expect(compiled.id).toBe('reference_v1');
    expect(compiled.ref).toBe('reference_v1@1');
    expect(compiled.status).toBe('reference');
    expect(compiled.css.length).toBeGreaterThan(500);
  });

  it('carries the reduced-motion kill switch, independently of any JS', () => {
    // ARCHITECTURE §1.2. This is the assertion the whole motion policy rests on.
    const { css } = reference();
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/animation-iteration-count:\s*1\s*!important/);
    // It lives in `base`, which a section stylesheet in `recipes` cannot outrank. (The first
    // `prefers-reduced-motion` in the file is the token condition inside `@layer tokens`; the
    // kill switch is the `!important` block after `@layer base {`.)
    const baseLayerAt = css.indexOf('@layer base {');
    expect(baseLayerAt).toBeGreaterThan(-1);
    expect(css.indexOf('animation-duration: 0.01ms !important')).toBeGreaterThan(baseLayerAt);
  });

  it('declares the layer order', () => {
    expect(reference().css).toContain('@layer reset, base, tokens, recipes;');
  });

  it('runs the whole seed -> algorithm -> role pipeline into custom properties', () => {
    const { variables } = reference();
    // seed
    expect(variables.get('--ds-seed-accent')).toBe('#1f4e8c');
    expect(variables.get('--ds-seed-type-base')).toBe('17px');
    // algorithms
    expect(variables.get('--ds-palette-accent-0')).toMatch(/^#[0-9a-f]{6}$/);
    expect(variables.get('--ds-palette-neutral-9')).toMatch(/^#[0-9a-f]{6}$/);
    expect(variables.get('--ds-type-size-0')).toBe('17px');
    expect(variables.get('--ds-type-size-n1')).toBe('13.6px');
    expect(variables.get('--ds-space-0-5')).toBe('4px');
    expect(variables.get('--ds-space-13')).toBe('104px');
    expect(variables.get('--ds-radius-2')).toBe('4px');
    // semantic roles — v4 §3's seven
    for (const role of [
      '--ds-bg-base',
      '--ds-bg-raised',
      '--ds-fg-primary',
      '--ds-fg-muted',
      '--ds-accent-bg',
      '--ds-accent-fg',
      '--ds-border-hairline',
    ]) {
      expect(variables.get(role), role).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('resolves a role to its ramp step, which is what makes hue_adaptable free', () => {
    const { variables, palettes } = reference();
    expect(variables.get('--ds-bg-base')).toBe(palettes['neutral']![0]);
    expect(variables.get('--ds-accent-bg')).toBe(palettes['accent']![8]);
  });

  it('formats the non-scalar DTCG types', () => {
    const { variables } = reference();
    expect(variables.get('--ds-font-heading')).toBe('Georgia, "Times New Roman", serif');
    expect(variables.get('--ds-motion-easing-standard')).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });

  it('emits every condition in the table, dark included, as one file', () => {
    const { css, conditionVariables } = reference();
    // Dark is a condition, not a second stylesheet.
    expect(conditionVariables.get('dark')?.get('--ds-bg-base')).toMatch(/^#[0-9a-f]{6}$/);
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root[data-ds-scheme="dark"]');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('@media print');
    expect(css).toContain('@media (hover: none) and (pointer: coarse)');
    for (const condition of CONDITION_NAMES) {
      expect(conditionVariables.get(condition)?.size ?? 0, condition).toBeGreaterThan(0);
    }
  });

  it('kills motion durations under reduced motion as well as animations', () => {
    expect(
      reference().conditionVariables.get('reduced_motion')?.get('--ds-motion-duration-base'),
    ).toBe('0ms');
  });

  it('grows the tap target under a coarse pointer', () => {
    expect(reference().conditionVariables.get('touch')?.get('--ds-target-min-size')).toBe('48px');
  });

  it('checks contrast in dark as well as in the base scheme', () => {
    const { contrastChecks } = reference();
    const scopes = new Set(contrastChecks.map((c) => c.condition));
    expect(scopes.has('base')).toBe(true);
    expect(scopes.has('dark')).toBe(true);
    expect(contrastChecks.every((c) => c.passed)).toBe(true);
    expect(contrastChecks.filter((c) => c.condition === 'base').length).toBe(6);
  });

  it('skips forced-colors pairs rather than pretending to measure a system colour', () => {
    const skipped = reference().contrastSkipped;
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((s) => s.condition === 'forced_colors')).toBe(true);
    expect(skipped[0]!.reason).toMatch(/not a computable colour/);
  });

  it('writes tokens.css to disk, one file per design system', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-tokens-'));
    const path = writeTokensCss(reference(), dir);
    expect(path).toBe(join(dir, 'reference_v1', 'tokens.css'));
    const written = readFileSync(path, 'utf8');
    expect(written).toContain('@media (prefers-reduced-motion: reduce)');
    expect(written.endsWith('\n')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('is the only design system on disk, and it is not selectable', () => {
    const all = compileDesignSystems();
    expect([...all.keys()]).toEqual(['reference_v1']);
    expect(all.get('reference_v1')!.status).toBe('reference');
  });
});

describe('the contrast gate fails the build', () => {
  it('rejects a deliberately low-contrast pair', () => {
    const path = join(FIXTURES, 'low-contrast.yml');
    expect(() => compileDesignSystemFile(path)).toThrow(TokenContrastError);

    let thrown: TokenContrastError | undefined;
    try {
      compileDesignSystemFile(path);
    } catch (error) {
      thrown = error as TokenContrastError;
    }
    expect(thrown).toBeInstanceOf(TokenContrastError);
    expect(thrown!.failures).toHaveLength(1);
    const [failure] = thrown!.failures;
    expect(failure!.fg).toBe('fg.muted');
    expect(failure!.bg).toBe('bg.base');
    expect(failure!.required).toBe(4.5);
    expect(failure!.ratio).toBeLessThan(4.5);
    expect(thrown!.message).toMatch(/below the 4.5:1 required for normal text/);
    // The pair that does pass is not reported as a failure.
    expect(thrown!.failures.some((f) => f.fg === 'fg.primary')).toBe(false);
  });

  it('rejects a pair that only fails once the dark condition moves it', () => {
    let thrown: TokenContrastError | undefined;
    try {
      compileDesignSystemFile(join(FIXTURES, 'dark-only-failure.yml'));
    } catch (error) {
      thrown = error as TokenContrastError;
    }
    expect(thrown).toBeInstanceOf(TokenContrastError);
    expect(thrown!.failures.map((f) => f.condition)).toEqual(['dark']);
  });

  it('accepts a large-text pair at 3:1 that a normal-text pair would fail', () => {
    const base = readYamlFile(join(FIXTURES, 'low-contrast.yml')) as Record<string, unknown>;
    const near = structuredClone(base);
    // index 5 against index 0 sits between 3:1 and 4.5:1.
    (near as any).roles.fg.muted.$extensions.agency.role.index = 5;
    (near as any).contrast.pairs[1].size = 'large';
    const compiled = compileDesignSystem(near);
    const pair = compiled.contrastChecks.find(
      (c) => c.fg === 'fg.muted' && c.condition === 'base',
    )!;
    expect(pair.required).toBe(3);
    expect(pair.ratio).toBeGreaterThanOrEqual(3);
    expect(pair.ratio).toBeLessThan(4.5);

    (near as any).contrast.pairs[1].size = 'normal';
    expect(() => compileDesignSystem(near)).toThrow(TokenContrastError);
  });
});

describe('the compiler accumulates problems rather than stopping at the first', () => {
  it('reports every schema violation at once', () => {
    let thrown: TokenCompileError | undefined;
    try {
      compileDesignSystem({ id: 'Bad Id', version: 'x', status: 'nope' });
    } catch (error) {
      thrown = error as TokenCompileError;
    }
    expect(thrown).toBeInstanceOf(TokenCompileError);
    expect(thrown!.problems.length).toBeGreaterThan(2);
  });

  it('reports a role naming a ramp no seed generates', () => {
    expect(() =>
      compileDesignSystem({
        id: 'broken',
        version: 1,
        status: 'reference',
        visual_dna: {
          composition_family: 'minimalist',
          typography_voice: 'utilitarian',
          visual_energy: 1,
          motion_language: 'none',
        },
        seed: {},
        roles: {
          fg: {
            primary: {
              $type: 'color',
              $extensions: { agency: { role: { ramp: 'ghost', index: 0 } } },
            },
          },
        },
        contrast: { pairs: [{ fg: 'fg.primary', bg: 'fg.primary' }] },
      }),
    ).toThrow(/names ramp "ghost", which no seed generates/);
  });

  it('reports a contrast pair naming something that is not a role', () => {
    const file = readYamlFile(join(FIXTURES, 'low-contrast.yml')) as any;
    file.contrast.pairs = [{ fg: 'fg.primary', bg: 'bg.nonexistent' }];
    expect(() => compileDesignSystem(file)).toThrow(/which is not a role/);
  });
});

describe('custom property naming', () => {
  it('replaces underscores so a token name is greppable', () => {
    expect(customProperty(['seed', 'type_base'])).toBe('--ds-seed-type-base');
    expect(customProperty(['bg', 'base'])).toBe('--ds-bg-base');
  });
});
