import { describe, expect, it } from 'vitest';

import {
  MOTION_CHECKS,
  noRenderLoopUnderReducedMotion,
  tierCIslandBudget,
  webglRendersSomething,
} from '../src/checks/motion.js';
import { ALL_CHECKS, RUNTIME_CHECKS } from '../src/checks/index.js';
import {
  EMPTY_MOTION_SAMPLE,
  MOTION_COUNTER_KEY,
  MOTION_INIT_SCRIPT,
  motionSampleScript,
  type MotionSample,
} from '../src/artifacts/motion-probe.js';
import { cleanContext } from './fixtures/context.js';
import type { ArtifactBundle, MotionSample as ExportedSample } from '../src/types.js';

function bundle(project: string, motion: Partial<MotionSample>): ArtifactBundle {
  return {
    project,
    build: { routes: ['/'], jsBytesByRoute: { '/': 0 }, allowedHosts: [], buildYear: 2026 },
    dom: { route: '/' },
    runtime: {
      lcpElementSdId: 's_hook',
      lcpElementTag: 'h1',
      runningAnimationsUnderReducedMotion: 0,
      posterVisibleUnderReducedMotion: true,
      tabStops: [],
      positiveTabIndexCount: 0,
      focusVisibleFailures: [],
      horizontalScrollWidths: {},
      motion: { ...EMPTY_MOTION_SAMPLE, instrumented: true, ...motion },
    },
  } as unknown as ArtifactBundle;
}

describe('the gap these checks close', () => {
  it('catches a rAF loop under reduced motion, which getAnimations() cannot see', () => {
    // The whole reason this file exists. `runningAnimationsUnderReducedMotion` is 0 in this
    // bundle — a shader loop is not a CSS animation — and the page is still animating.
    const outcome = noRenderLoopUnderReducedMotion.audit(
      bundle('reduced-motion', { rafDelta: 36, drawDelta: 36, glContexts: 1 }),
      cleanContext,
    );
    expect(outcome.passed).toBe(false);
    expect(JSON.stringify(outcome.items)).toContain('requestAnimationFrame');
    expect(JSON.stringify(outcome.items)).toContain('draw');
  });

  it('passes a page where nothing drew during the window', () => {
    const outcome = noRenderLoopUnderReducedMotion.audit(
      bundle('reduced-motion', { glContexts: 1, drawTotal: 1 }),
      cleanContext,
    );
    expect(outcome.passed).toBe(true);
  });

  it('allows a single first frame, because one draw is not motion', () => {
    // Poster-until-first-frame means the poster is replaced once. A total of one with a delta of
    // zero is exactly correct behaviour, and failing it would forbid the intended design.
    const outcome = noRenderLoopUnderReducedMotion.audit(
      bundle('reduced-motion', { drawTotal: 1, drawDelta: 0, rafTotal: 1, rafDelta: 0 }),
      cleanContext,
    );
    expect(outcome.passed).toBe(true);
  });

  it('errors rather than passes when the probe did not run', () => {
    // Zero deltas from an uninstrumented page are indistinguishable from a page that honours the
    // preference. Calling that a pass is the bug.
    const outcome = noRenderLoopUnderReducedMotion.audit(
      bundle('reduced-motion', { instrumented: false }),
      cleanContext,
    );
    expect(outcome.mode).toBe('error');
    expect(outcome.passed).toBe(false);
  });

  it('is scoped to the project that emulates the preference', () => {
    // A loop on desktop-chrome is the effect working. Only the reduced-motion project can decide.
    expect(
      noRenderLoopUnderReducedMotion.audit(
        bundle('desktop-chrome', { rafDelta: 60, drawDelta: 60 }),
        cleanContext,
      ).mode,
    ).toBe('notApplicable');
  });
});

describe('the island budget', () => {
  it('allows one WebGL context', () => {
    expect(
      tierCIslandBudget.audit(bundle('desktop-chrome', { glContexts: 1 }), cleanContext),
    ).toMatchObject({ passed: true, value: 1 });
  });

  it('fails two', () => {
    const outcome = tierCIslandBudget.audit(
      bundle('desktop-chrome', { glContexts: 2 }),
      cleanContext,
    );
    expect(outcome.passed).toBe(false);
    expect(outcome.value).toBe(2);
  });

  it('passes zero, which is every page in the library today', () => {
    expect(
      tierCIslandBudget.audit(bundle('desktop-chrome', { glContexts: 0 }), cleanContext).passed,
    ).toBe(true);
  });
});

describe('a context that never draws', () => {
  it('fails, because the failure mode is a blank rectangle', () => {
    const outcome = webglRendersSomething.audit(
      bundle('desktop-chrome', { glContexts: 1, drawTotal: 0 }),
      cleanContext,
    );
    expect(outcome.passed).toBe(false);
    expect(JSON.stringify(outcome.items)).toContain('poster is still showing');
  });

  it('passes once a frame has been drawn', () => {
    expect(
      webglRendersSomething.audit(
        bundle('desktop-chrome', { glContexts: 1, drawTotal: 1 }),
        cleanContext,
      ).passed,
    ).toBe(true);
  });

  it('is notApplicable with no context at all', () => {
    expect(
      webglRendersSomething.audit(bundle('desktop-chrome', { glContexts: 0 }), cleanContext).mode,
    ).toBe('notApplicable');
  });

  it('does not demand a frame under reduced motion, where not drawing is correct', () => {
    // The two checks would otherwise contradict each other: one demanding a draw, the other
    // forbidding it.
    expect(
      webglRendersSomething.audit(
        bundle('reduced-motion', { glContexts: 1, drawTotal: 0 }),
        cleanContext,
      ).mode,
    ).toBe('notApplicable');
  });
});

describe('the probe scripts', () => {
  it('installs counters under a namespaced key', () => {
    expect(MOTION_INIT_SCRIPT).toContain(MOTION_COUNTER_KEY);
    // Non-writable and non-configurable: a page that overwrote the counters could hide a loop.
    expect(MOTION_INIT_SCRIPT).toContain('writable: false');
    expect(MOTION_INIT_SCRIPT).toContain('configurable: false');
  });

  it('wraps every draw entry point, not just drawArrays', () => {
    for (const method of [
      'drawArrays',
      'drawElements',
      'drawArraysInstanced',
      'drawElementsInstanced',
    ]) {
      expect(MOTION_INIT_SCRIPT, method).toContain(method);
    }
    // WebGL2 has its own prototype; wrapping only WebGLRenderingContext misses every modern
    // shader.
    expect(MOTION_INIT_SCRIPT).toContain('WebGL2RenderingContext');
  });

  it('samples a window rather than a total, so a first frame is not motion', () => {
    const script = motionSampleScript(250);
    expect(script).toContain('250');
    expect(script).toContain('rafDelta');
    expect(script).toContain('drawDelta');
  });

  it('reports instrumented: false when the init script never ran', () => {
    expect(motionSampleScript()).toContain('instrumented: false');
    expect(EMPTY_MOTION_SAMPLE.instrumented).toBe(false);
  });

  it('runs the counters in a real JS realm without throwing', () => {
    // The init script runs before every page's own scripts. If it throws, navigation fails and
    // the whole route is lost — so it must survive a realm with no WebGL at all.
    const globals = {
      requestAnimationFrame: (cb: () => void) => {
        void cb;
        return 1;
      },
      HTMLCanvasElement: undefined,
      WebGLRenderingContext: undefined,
      WebGL2RenderingContext: undefined,
    } as Record<string, unknown>;
    const sandbox = { window: globals, ...globals };
    (sandbox as { window: Record<string, unknown> }).window = sandbox as never;

    const run = new Function('window', `with (window) { return ${MOTION_INIT_SCRIPT}; }`);
    expect(() => run(sandbox)).not.toThrow();
    const state = (sandbox as Record<string, unknown>)[MOTION_COUNTER_KEY] as {
      rafCalls: number;
    };
    expect(state.rafCalls).toBe(0);

    // And the wrapper counts.
    const wrapped = (sandbox as unknown as Record<string, unknown>)['requestAnimationFrame'] as (
      cb: () => void,
    ) => number;
    wrapped(() => undefined);
    expect(state.rafCalls).toBe(1);
  });
});

describe('registration', () => {
  it('files the motion checks with the browser pass, since they need a rendered page', () => {
    for (const check of MOTION_CHECKS) {
      expect(ALL_CHECKS, check.id).toContain(check);
      expect(RUNTIME_CHECKS, check.id).toContain(check);
    }
  });

  it('exports the sample type from the gate’s public surface', () => {
    const sample: ExportedSample = EMPTY_MOTION_SAMPLE;
    expect(sample.glContexts).toBe(0);
  });
});
