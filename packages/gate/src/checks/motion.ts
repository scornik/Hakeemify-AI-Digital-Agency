/**
 * Tier-C motion checks — gate-checklist rows 20, 114, and ARCHITECTURE §1.1.
 *
 * The owner approved tier C (live WebGL) for V1. Three of the four things that decision needs
 * were already in place or are enforced elsewhere:
 *
 * - the **15 kB gzip ceiling** is enforced at manifest load by
 *   `packages/library/src/motion/byte-ceiling.ts`, measured with zlib against the real source. A
 *   second copy here would be a second number to drift.
 * - the **poster under reduced motion** is already asserted by `posterVisibleUnderReducedMotion`.
 * - the **closed effect vocabulary** means a shader that is not in the registry cannot be
 *   selected at all.
 *
 * What was missing is the one that matters most, and it is the gap I flagged when the decision was
 * made: **`document.getAnimations()` does not see a `requestAnimationFrame` loop.** The
 * `reduced-motion-respected` check counts running animations and asserts zero, so a page whose
 * shader renders at 60fps under `prefers-reduced-motion: reduce` passed it. That is the check
 * whose entire purpose is protecting people who asked not to be moved, reporting green on the one
 * effect class capable of ignoring them.
 *
 * These checks read `bundle.runtime.motion`, which `motion-probe.ts` gathers by instrumenting
 * `requestAnimationFrame` and the GL draw methods before any page script runs.
 */
import { defineCheck, type Check } from '../context.js';
import type { CheckEvidence } from '../types.js';

/**
 * One WebGL island per site (ARCHITECTURE §1.1). Counted per page, which is the strictest
 * reading and the only one a per-page gate can enforce.
 */
export const TIER_C_MAX_CONTEXTS = 1;

export const noRenderLoopUnderReducedMotion: Check = defineCheck({
  id: 'motion.no-render-loop-under-reduced-motion',
  title: 'Nothing is being rendered frame by frame under prefers-reduced-motion',
  failureTitle: 'A render loop is still running under prefers-reduced-motion',
  description:
    'getAnimations() returns CSS, transitions and WAAPI — not a requestAnimationFrame loop. A ' +
    'tier-C shader is a rAF loop issuing draw calls, so without this the reduced-motion check ' +
    'passes a page animating at 60fps for someone who asked it not to.',
  severity: 'critical',
  requiredArtifacts: ['runtime'],
  checklistRows: [114],
  audit: (bundle) => {
    const runtime = bundle.runtime;
    if (!runtime) return { mode: 'notApplicable', passed: false };

    // Only meaningful on the project that emulates the preference. Elsewhere a loop is expected.
    if (bundle.project !== 'reduced-motion') return { mode: 'notApplicable', passed: false };

    const motion = runtime.motion;
    if (!motion.instrumented) {
      // Zero deltas from an uninstrumented page look exactly like a page that honours the
      // preference. Reporting that as a pass is the failure this check exists to prevent.
      return {
        mode: 'error',
        passed: false,
        message: 'the motion probe did not run, so this page was not measured',
      };
    }

    const problems: CheckEvidence[] = [];
    if (motion.rafDelta > 0) {
      problems.push({
        detail: 'requestAnimationFrame is still being called',
        actual: `${motion.rafDelta} call(s) during the sample window`,
        expected: '0',
      });
    }
    if (motion.drawDelta > 0) {
      problems.push({
        detail: 'WebGL draw calls are still being issued',
        actual: `${motion.drawDelta} draw(s) during the sample window`,
        expected: '0',
      });
    }

    return {
      passed: problems.length === 0,
      items: problems,
      message:
        problems.length === 0
          ? 'no frames rendered during the sample window'
          : 'the poster should be showing and nothing should be drawing',
    };
  },
});

export const tierCIslandBudget: Check = defineCheck({
  id: 'motion.tier-c-island-budget',
  title: 'At most one WebGL context on a page',
  failureTitle: 'More than one WebGL context was created',
  description:
    'ARCHITECTURE §1.1 allows one WebGL island per site. Two shaders on one page doubles the ' +
    'runtime the 15 kB ceiling was set against and is the shape a decorative effect takes when ' +
    'it stops being a deliberate focal moment.',
  severity: 'serious',
  requiredArtifacts: ['runtime'],
  checklistRows: [114],
  audit: (bundle) => {
    const motion = bundle.runtime?.motion;
    if (!motion) return { mode: 'notApplicable', passed: false };
    if (!motion.instrumented) {
      return { mode: 'error', passed: false, message: 'the motion probe did not run' };
    }
    // Zero contexts is the normal, correct case: every scaffold is tier_0.
    return {
      mode: 'numeric',
      passed: motion.glContexts <= TIER_C_MAX_CONTEXTS,
      value: motion.glContexts,
      items:
        motion.glContexts > TIER_C_MAX_CONTEXTS
          ? [
              {
                detail: 'WebGL contexts on this page',
                actual: String(motion.glContexts),
                expected: `<= ${TIER_C_MAX_CONTEXTS}`,
              },
            ]
          : [],
    };
  },
});

export const webglRendersSomething: Check = defineCheck({
  id: 'motion.webgl-renders-something',
  title: 'A WebGL context that exists has drawn at least one frame',
  failureTitle: 'A WebGL context was created but never drew anything',
  description:
    'The failure mode of a lazy-mounted shader is not a slow page — it is a blank rectangle ' +
    'where the focal moment should be. A context with zero draws means the poster never got ' +
    'replaced, which no byte budget or contrast check can see.',
  severity: 'serious',
  requiredArtifacts: ['runtime'],
  checklistRows: [20, 114],
  audit: (bundle) => {
    const motion = bundle.runtime?.motion;
    if (!motion) return { mode: 'notApplicable', passed: false };
    if (!motion.instrumented) {
      return { mode: 'error', passed: false, message: 'the motion probe did not run' };
    }
    // No context, nothing to assert. This is every page in the library today.
    if (motion.glContexts === 0) return { mode: 'notApplicable', passed: false };
    // Under reduced motion a context that never draws is correct, not broken.
    if (bundle.project === 'reduced-motion') return { mode: 'notApplicable', passed: false };

    return {
      passed: motion.drawTotal > 0,
      items:
        motion.drawTotal > 0
          ? []
          : [
              {
                detail: `${motion.glContexts} WebGL context(s) created, 0 draw calls issued`,
                snippet: 'the poster is still showing and will not be replaced',
              },
            ],
    };
  },
});

export const MOTION_CHECKS: readonly Check[] = [
  noRenderLoopUnderReducedMotion,
  tierCIslandBudget,
  webglRendersSomething,
];
