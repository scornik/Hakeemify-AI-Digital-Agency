/**
 * Motion instrumentation — seeing the animation that `getAnimations()` cannot.
 *
 * ## The gap this closes
 *
 * `document.getAnimations()` returns CSS animations, CSS transitions and Web Animations API
 * animations. It does **not** return a `requestAnimationFrame` loop, and a tier-C WebGL effect is
 * exactly that: a rAF callback issuing draw calls against a GL context. So the
 * `reduced-motion-respected` check, which counts running animations and asserts zero, reports a
 * clean pass on a page where a shader is animating at 60fps under
 * `prefers-reduced-motion: reduce`.
 *
 * That was tolerable while every scaffold was `tier_0` and nothing rendered. Tier C shipping in
 * V1 makes it a hole in the one check that exists to protect people who asked not to be moved.
 *
 * ## How it is measured
 *
 * Wrappers installed **before any page script runs** (`addInitScript`), because by the time a
 * probe could be evaluated the loop is already scheduled and its scheduling is unobservable:
 *
 * - `requestAnimationFrame` — counted on call. A single call is a one-shot measurement; a rising
 *   count is a loop.
 * - `WebGLRenderingContext.drawArrays` / `drawElements`, and the WebGL2 instanced variants —
 *   counted on call. This is the direct measure of a frame being rendered, and it is what
 *   distinguishes "a GL context exists" from "a GL context is animating".
 * - `HTMLCanvasElement.getContext` — records that a `webgl`/`webgl2` context was requested, so a
 *   tier-C island can be counted without relying on markup conventions.
 *
 * Counters are then **sampled twice over a window**. Deltas, not totals: one draw is a first
 * frame, which is permitted — the poster is replaced once and nothing moves. A delta across the
 * window is motion.
 *
 * ## Why wrapping is acceptable here and would not be in the site
 *
 * This is measurement infrastructure in a test browser, not shipped code. It changes observable
 * behaviour in exactly one way — the wrapped functions are not the native ones — and that is
 * visible to a page that checks. Nothing in this project's own output inspects them, and a client
 * site that did would be a finding in itself.
 */

/** Where the counters live. Namespaced so a page's own globals cannot collide with it. */
export const MOTION_COUNTER_KEY = '__adaMotionProbe';

/**
 * Installed with `addInitScript`, so it runs before the page's own scripts in every frame.
 *
 * Deliberately defensive: a browser without `WebGLRenderingContext` (or a future one that moves
 * these methods) must leave the page working and report zeroes, not throw during navigation and
 * fail the whole route.
 */
export const MOTION_INIT_SCRIPT = `(() => {
  const state = { rafCalls: 0, drawCalls: 0, glContexts: 0 };
  Object.defineProperty(window, '${MOTION_COUNTER_KEY}', {
    value: state,
    writable: false,
    enumerable: false,
    configurable: false,
  });

  const nativeRaf = window.requestAnimationFrame;
  if (typeof nativeRaf === 'function') {
    window.requestAnimationFrame = function (callback) {
      state.rafCalls += 1;
      return nativeRaf.call(window, callback);
    };
  }

  const canvasProto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
  if (canvasProto && typeof canvasProto.getContext === 'function') {
    const nativeGetContext = canvasProto.getContext;
    canvasProto.getContext = function (kind, ...rest) {
      if (typeof kind === 'string' && kind.indexOf('webgl') === 0) state.glContexts += 1;
      return nativeGetContext.call(this, kind, ...rest);
    };
  }

  const drawMethods = [
    'drawArrays',
    'drawElements',
    'drawArraysInstanced',
    'drawElementsInstanced',
  ];
  for (const ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!ctor || !ctor.prototype) continue;
    for (const method of drawMethods) {
      const native = ctor.prototype[method];
      if (typeof native !== 'function') continue;
      ctor.prototype[method] = function (...args) {
        state.drawCalls += 1;
        return native.apply(this, args);
      };
    }
  }
})()`;

/**
 * Sample the counters twice, `windowMs` apart, and return the deltas. Evaluated in the page.
 *
 * The totals are returned alongside the deltas because they answer different questions: a total
 * of one draw and a delta of zero is a correctly-behaved first frame, whereas a total of zero
 * means nothing ever rendered — which for a tier-C island is a blank rectangle, not a success.
 */
export function motionSampleScript(windowMs = 600): string {
  return `(() => {
  const state = window['${MOTION_COUNTER_KEY}'];
  if (!state) {
    return Promise.resolve({
      instrumented: false,
      rafDelta: 0, drawDelta: 0,
      rafTotal: 0, drawTotal: 0, glContexts: 0,
    });
  }
  const before = { raf: state.rafCalls, draw: state.drawCalls };
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        instrumented: true,
        rafDelta: state.rafCalls - before.raf,
        drawDelta: state.drawCalls - before.draw,
        rafTotal: state.rafCalls,
        drawTotal: state.drawCalls,
        glContexts: state.glContexts,
      });
    }, ${windowMs});
  });
})()`;
}

export interface MotionSample {
  /**
   * False when the init script did not run. Reported rather than defaulted, because zero deltas
   * from an uninstrumented page look exactly like a page that honours the preference.
   */
  readonly instrumented: boolean;
  /** rAF callbacks scheduled during the sample window. A rising count is a loop. */
  readonly rafDelta: number;
  /** GL draw calls issued during the sample window. */
  readonly drawDelta: number;
  readonly rafTotal: number;
  readonly drawTotal: number;
  /** How many `webgl`/`webgl2` contexts were requested. One island per site is the budget. */
  readonly glContexts: number;
}

export const EMPTY_MOTION_SAMPLE: MotionSample = {
  instrumented: false,
  rafDelta: 0,
  drawDelta: 0,
  rafTotal: 0,
  drawTotal: 0,
  glContexts: 0,
};
