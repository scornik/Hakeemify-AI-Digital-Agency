/**
 * Accessibility — gate-checklist §2.
 *
 * axe is adopted wholesale and run with the full tag set; the `a11y.axe-*` checks here simply
 * project its output into report rows, keeping its three-way outcome intact. axe's `incomplete`
 * becomes `needs_review` rather than a pass, because "the machine could not decide" is a fact
 * about the machine, not about the page.
 *
 * Everything with a non-axe id is a gap nothing in the toolchain covers: reduced motion, focus
 * visibility, reading order, tab-order sanity. The static half of each is asserted here; the
 * runtime half needs the browser artifact and is `notApplicable` without it.
 */
import { defineCheck, type Check } from '../context.js';
import type { AxeResult, CheckEvidence, Severity } from '../types.js';

const AXE_IMPACT_DEFAULT: Severity = 'serious';

function axeItems(results: readonly AxeResult[]): CheckEvidence[] {
  return results.flatMap((result) =>
    result.nodes.map((node) => ({
      target: node.target.join(' '),
      snippet: node.html.slice(0, 160),
      detail: `${result.id}${node.failureSummary ? `: ${node.failureSummary}` : ''}`,
    })),
  );
}

export const axeViolations: Check = defineCheck({
  id: 'a11y.axe-violations',
  title: 'axe reports no violations at WCAG A/AA plus best practice',
  failureTitle: 'axe reports accessibility violations',
  description:
    'Run through @axe-core/playwright with the full tag set, rather than Lighthouse’s subset. ' +
    'Lighthouse runs wcag2a/wcag2aa plus a hand-picked list and discards `incomplete` entirely.',
  severity: 'critical',
  requiredArtifacts: ['axe'],
  checklistRows: [27, 28, 30, 31, 32, 34, 35, 36, 38, 39, 40, 41, 42, 44],
  audit: (bundle) => {
    const violations = bundle.axe?.violations ?? [];
    return {
      passed: violations.length === 0,
      items: axeItems(violations),
      message:
        violations.length === 0
          ? undefined
          : `${violations.length} rule(s) violated: ${violations.map((v) => v.id).join(', ')}`,
    };
  },
});

export const axeIncomplete: Check = defineCheck({
  id: 'a11y.axe-incomplete',
  title: 'axe has nothing it could not decide',
  failureTitle: 'axe could not decide some elements; a reviewer must look',
  description:
    'axe returns `incomplete` with a reason code — bgImage, bgGradient, fgAlpha and so on. ' +
    'Each maps to a specific human check, so these are carried as `needs_review` and block ' +
    'shipping until signed off, never rounded to a pass.',
  severity: 'serious',
  requiredArtifacts: ['axe'],
  checklistRows: [32, 37, 43, 45, 55],
  audit: (bundle) => {
    const incomplete = bundle.axe?.incomplete ?? [];
    return {
      mode: incomplete.length === 0 ? 'binary' : 'needs_review',
      passed: incomplete.length === 0,
      items: axeItems(incomplete),
    };
  },
});

export const axeTagPolicy: Check = defineCheck({
  id: 'a11y.axe-tag-policy',
  title: 'axe ran with the tag set the gate policy requires',
  failureTitle: 'axe ran with a narrower rule set than the policy requires',
  description:
    'A gate that silently narrows its own rule set is worse than no gate, because the report ' +
    'still says green.',
  severity: 'critical',
  requiredArtifacts: ['axe'],
  checklistRows: [27],
  audit: (bundle) => {
    const required = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
    const ran = new Set(bundle.axe?.tags ?? []);
    const missing = required.filter((tag) => !ran.has(tag));
    return {
      passed: missing.length === 0,
      items: missing.map((tag) => ({ detail: `tag not run: ${tag}` })),
    };
  },
});

export const viewportZoomable: Check = defineCheck({
  id: 'a11y.viewport-zoomable',
  title: 'The viewport meta allows zooming',
  failureTitle: 'The viewport meta blocks zooming',
  description: 'maximum-scale=1 or user-scalable=no takes zoom away from people who need it.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [24, 42],
  audit: (bundle) => {
    const viewport = bundle.dom.viewport ?? '';
    if (viewport.trim() === '') {
      return { passed: false, items: [{ detail: 'no viewport meta' }] };
    }
    const blocked = /user-scalable\s*=\s*no|maximum-scale\s*=\s*(1(\.0+)?)\b/i.test(viewport);
    return { passed: !blocked, items: blocked ? [{ actual: viewport }] : [] };
  },
});

export const headingOrder: Check = defineCheck({
  id: 'a11y.heading-order',
  title: 'Heading levels increase by at most one at a time',
  failureTitle: 'A heading level is skipped',
  description: 'The outline is how a screen reader user navigates a long page.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [35],
  audit: (bundle) => {
    const skips: CheckEvidence[] = [];
    let previous = 0;
    for (const heading of bundle.dom.headings) {
      if (previous !== 0 && heading.level > previous + 1) {
        skips.push({
          snippet: heading.text,
          actual: `h${heading.level}`,
          expected: `h${previous + 1} or shallower`,
        });
      }
      previous = heading.level;
    }
    return { passed: skips.length === 0, items: skips };
  },
});

export const landmarkMain: Check = defineCheck({
  id: 'a11y.landmark-main',
  title: 'The page has exactly one main landmark',
  failureTitle: 'The page has no main landmark, or several',
  description: 'Without it, skipping to content means tabbing through the navigation every time.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [36, 53],
  audit: (bundle) => {
    const mains = bundle.dom.landmarks.filter((landmark) => landmark === 'main');
    return {
      passed: mains.length === 1,
      items: mains.length === 1 ? [] : [{ actual: mains.length, expected: 1 }],
    };
  },
});

export const imageAltPresent: Check = defineCheck({
  id: 'a11y.image-alt-present',
  title: 'Every image declares alt text, even if empty for decoration',
  failureTitle: 'An image has no alt attribute at all',
  description:
    'A missing attribute and an empty one mean different things. Whether the alt is *meaningful* ' +
    'is a reviewer question, reported separately.',
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [27],
  audit: (bundle) => {
    const missing = bundle.dom.images.filter((image) => image.alt === null);
    return {
      passed: missing.length === 0,
      items: missing.map((image) => ({ target: image.src, detail: 'no alt attribute' })),
    };
  },
});

export const meaningfulAlt: Check = defineCheck({
  id: 'a11y.meaningful-alt',
  title: 'Alt text describes the image',
  failureTitle: 'Alt text needs a human to confirm it describes the image',
  description:
    'No rule anywhere can decide this. The deterministic half — filename-as-alt, "image", ' +
    '"photo" — is enforced by the placeholder scan; the rest is a reviewer row by construction.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [54],
  audit: (bundle) => {
    const described = bundle.dom.images.filter((image) => (image.alt ?? '').trim().length > 0);
    return {
      mode: described.length === 0 ? 'notApplicable' : 'manual',
      passed: false,
      items: described.map((image) => ({ target: image.src, snippet: image.alt ?? '' })),
      message: `${described.length} image(s) need a reviewer to confirm the alt text describes them`,
    };
  },
});

export const reducedMotionCss: Check = defineCheck({
  id: 'a11y.reduced-motion-css',
  title: 'The stylesheet carries a reduced-motion kill switch independent of JavaScript',
  failureTitle: 'No prefers-reduced-motion rule ships in the CSS',
  description:
    'ARCHITECTURE §1.2: reduced motion is a gate assertion and a CSS rule, never a component ' +
    'contract. Nothing in the animation ecosystem honours it by default, so the static rule has ' +
    'to exist whether or not any script runs.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [56, 107],
  audit: (bundle) => {
    const inline = bundle.dom.inlineStyleText;
    const present = /@media[^{]*prefers-reduced-motion\s*:\s*reduce/i.test(inline);
    if (present) return { passed: true };
    // The rule may live in a linked stylesheet; that half is verified by the runtime artifact.
    return bundle.runtime
      ? {
          passed: bundle.runtime.runningAnimationsUnderReducedMotion === 0,
          items: [
            {
              detail: 'no inline kill switch; verified against the reduced-motion project instead',
              actual: bundle.runtime.runningAnimationsUnderReducedMotion,
            },
          ],
        }
      : {
          mode: 'needs_review',
          passed: false,
          message:
            'no inline reduced-motion rule, and no reduced-motion run to confirm the linked ' +
            'stylesheet carries one',
        };
  },
});

export const reducedMotionRuntime: Check = defineCheck({
  id: 'motion.reduced-motion-respected',
  title: 'Nothing animates when the visitor asks for reduced motion',
  failureTitle: 'Animations keep running under prefers-reduced-motion',
  description:
    'Asserted in a dedicated Playwright project with reducedMotion: "reduce". Any WebGL section ' +
    'must be showing its poster.',
  severity: 'serious',
  requiredArtifacts: ['runtime'],
  checklistRows: [56, 107],
  audit: (bundle) => {
    const runtime = bundle.runtime;
    if (!runtime) return { mode: 'notApplicable', passed: false };
    const animations = runtime.runningAnimationsUnderReducedMotion;
    const posterOk = bundle.dom.webglCanvasCount === 0 || runtime.posterVisibleUnderReducedMotion;
    return {
      passed: animations === 0 && posterOk,
      items: [
        ...(animations === 0
          ? []
          : [{ actual: animations, expected: 0, detail: 'running animations' }]),
        ...(posterOk ? [] : [{ detail: 'a WebGL section is not showing its poster' }]),
      ],
    };
  },
});

export const tabOrderSanity: Check = defineCheck({
  id: 'structure.tab-order-sanity',
  title: 'Tab order follows the page, with no positive tabindex',
  failureTitle: 'Tab order jumps, or a positive tabindex is in play',
  description:
    'A positive tabindex reorders the whole document. The sequence itself is checked against ' +
    'the rendered geometry: monotonic down the page, section by section.',
  severity: 'serious',
  requiredArtifacts: ['runtime'],
  checklistRows: [48, 97],
  audit: (bundle) => {
    const runtime = bundle.runtime;
    if (!runtime) return { mode: 'notApplicable', passed: false };

    const problems: CheckEvidence[] = [];
    if (runtime.positiveTabIndexCount > 0) {
      problems.push({ detail: 'positive tabindex present', actual: runtime.positiveTabIndexCount });
    }
    let previousY = Number.NEGATIVE_INFINITY;
    for (const stop of runtime.tabStops) {
      // Allow same-row movement; flag a jump back up the page.
      if (stop.y + 4 < previousY) {
        problems.push({
          target: stop.sdId ?? stop.tag,
          detail: 'tab order jumps back up the page',
          actual: stop.y,
        });
      }
      previousY = Math.max(previousY, stop.y);
    }
    return { passed: problems.length === 0, items: problems };
  },
});

export const focusVisible: Check = defineCheck({
  id: 'a11y.focus-visible',
  title: 'Every focusable control shows a visible focus state',
  failureTitle: 'A focusable control shows no visible focus state',
  description:
    'No axe rule covers this, and Lighthouse marks it manual. The runtime gatherer tabs the page ' +
    'and compares computed styles, which decides the mechanical half.',
  severity: 'serious',
  requiredArtifacts: ['runtime'],
  checklistRows: [47],
  audit: (bundle) => {
    const failures = bundle.runtime?.focusVisibleFailures ?? [];
    return {
      passed: failures.length === 0,
      items: failures.map((selector) => ({ target: selector })),
    };
  },
});

export const noHorizontalScroll: Check = defineCheck({
  id: 'structure.no-horizontal-scroll',
  title: 'No viewport width produces horizontal scrolling',
  failureTitle: 'The page scrolls sideways at some viewport width',
  description: 'Checked at 320, 412, 768 and 1350, which is where real devices sit.',
  severity: 'serious',
  requiredArtifacts: ['runtime'],
  checklistRows: [95, 60],
  audit: (bundle) => {
    const widths = bundle.runtime?.horizontalScrollWidths ?? {};
    const offenders = Object.entries(widths)
      .filter(([, value]) => value.scrollWidth > value.clientWidth + 1)
      .map(([width, value]) => ({
        detail: `overflows at ${width}px`,
        actual: value.scrollWidth,
        expected: value.clientWidth,
      }));
    return { passed: offenders.length === 0, items: offenders };
  },
});

export const A11Y_CHECKS: readonly Check[] = [
  axeViolations,
  axeIncomplete,
  axeTagPolicy,
  viewportZoomable,
  headingOrder,
  landmarkMain,
  imageAltPresent,
  meaningfulAlt,
  reducedMotionCss,
  reducedMotionRuntime,
  tabOrderSanity,
  focusVisible,
  noHorizontalScroll,
];

export const AXE_DEFAULT_IMPACT = AXE_IMPACT_DEFAULT;
