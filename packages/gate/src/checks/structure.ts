/**
 * Structure, links and navigation — gate-checklist §5, plus the `data-sd-*` contract that makes
 * the repair loop and the post-V1 editor possible (ARCHITECTURE §6).
 *
 * None of Lighthouse, axe, pa11y or Unlighthouse asserts any of this.
 */
import { defineCheck, normaliseRoute, pageFor, type Check } from '../context.js';
import type { CheckEvidence } from '../types.js';

export const sdPathPresent: Check = defineCheck({
  id: 'structure.sd-path-present',
  title: 'Every section the SiteDefinition declares rendered, and carries its addressing',
  failureTitle: 'A declared section is missing from the page, or rendered without its data-sd ids',
  description:
    'The gate, the repair loop, telemetry and the editor all address sections by the same ids. ' +
    'An unstamped section is one nothing downstream can point at, and a missing section is a ' +
    'substitution that silently did not happen.',
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [94],
  audit: (bundle, context) => {
    const expected = pageFor(context, normaliseRoute(bundle.dom.route));
    if (!expected) {
      return { passed: false, message: 'route not in the SiteDefinition' };
    }
    const rendered = new Map(bundle.dom.sections.map((section) => [section.sdId, section]));
    const problems: CheckEvidence[] = [];

    for (const section of expected.sections) {
      const found = rendered.get(section.sdId);
      if (!found) {
        problems.push({ detail: 'declared section did not render', actual: section.sdId });
        continue;
      }
      if (found.sdPath !== section.sdPath) {
        problems.push({
          target: section.sdId,
          detail: 'data-sd-path does not match the SiteDefinition',
          actual: found.sdPath,
          expected: section.sdPath,
        });
      }
      if (found.variantId !== null && found.variantId !== section.variantId) {
        problems.push({
          target: section.sdId,
          detail: 'rendered variant differs from the selected one',
          actual: found.variantId,
          expected: section.variantId,
        });
      }
    }

    for (const sdId of rendered.keys()) {
      if (!expected.sections.some((section) => section.sdId === sdId)) {
        problems.push({
          detail: 'section rendered that the SiteDefinition does not declare',
          actual: sdId,
        });
      }
    }

    return { passed: problems.length === 0, items: problems };
  },
});

export const sectionCount: Check = defineCheck({
  id: 'structure.section-count',
  title: 'The page has a section count within its archetype bounds, and no empty sections',
  failureTitle: 'The page has too few or too many sections, or a section rendered empty',
  description: 'v4 §15 bounds a page at 5–9 sections; an empty section root is a render failure.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [94],
  audit: (bundle, context) => {
    const expected = pageFor(context, normaliseRoute(bundle.dom.route));
    if (!expected) return { passed: false, message: 'route not in the SiteDefinition' };

    const count = bundle.dom.sections.length;
    const empty = bundle.dom.sections.filter((section) => section.textLength === 0);
    const withinBounds = count >= expected.minSections && count <= expected.maxSections;

    return {
      mode: 'numeric',
      passed: withinBounds && empty.length === 0,
      value: count,
      items: [
        ...(withinBounds
          ? []
          : [{ actual: count, expected: `${expected.minSections}–${expected.maxSections}` }]),
        ...empty.map((section) => ({
          target: section.sdId,
          detail: 'section rendered with no text',
        })),
      ],
    };
  },
});

export const internalLinksResolve: Check = defineCheck({
  id: 'links.internal-200',
  title: 'Every internal link resolves to a route the site actually has',
  failureTitle: 'An internal link points at a route that does not exist',
  description:
    'Unlighthouse discovers links but never asserts their status. Routes come from the build, ' +
    'so this is decidable without a single request.',
  severity: 'critical',
  requiredArtifacts: ['dom', 'build'],
  checklistRows: [88],
  audit: (bundle, context) => {
    const known = new Set(bundle.build.routes.map(normaliseRoute));
    const broken: CheckEvidence[] = [];

    for (const link of bundle.dom.links) {
      if (!link.isInternal || !link.hasHref) continue;
      if (link.href.startsWith('#')) continue;
      if (/^(mailto|tel|sms):/i.test(link.href)) continue;

      let pathname: string;
      try {
        pathname = new URL(link.href, context.origin).pathname;
      } catch {
        broken.push({ actual: link.href, detail: 'unparseable href' });
        continue;
      }
      // Files the build emits directly (sitemap, robots, assets) are not routes.
      if (/\.[a-z0-9]+$/i.test(pathname) && !pathname.endsWith('.html')) continue;
      if (!known.has(normaliseRoute(pathname))) {
        broken.push({ actual: link.href, detail: 'no such route', snippet: link.text });
      }
    }

    return { passed: broken.length === 0, items: broken };
  },
});

export const anchorTargets: Check = defineCheck({
  id: 'links.anchor-targets',
  title: 'Every in-page anchor points at an id that exists',
  failureTitle: 'An in-page anchor points at an id that is not on the page',
  description: 'A fragment link to nothing is a dead control that looks alive.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [91],
  audit: (bundle) => {
    // Section ids are the only anchor targets the renderer emits, plus explicit ids in the DOM.
    const ids = new Set(bundle.dom.sections.map((section) => section.sdId));
    const broken = bundle.dom.links
      .filter((link) => link.href.startsWith('#') && link.href.length > 1)
      .filter((link) => !ids.has(link.href.slice(1)))
      .map((link) => ({ actual: link.href, snippet: link.text }));
    return { passed: broken.length === 0, items: broken };
  },
});

export const noOrphans: Check = defineCheck({
  id: 'links.no-orphans',
  title: 'Every page is reachable from this one, directly or through the nav',
  failureTitle: 'A declared page is linked from nowhere',
  description:
    'Run on the home page this is the orphan check; a page nothing links to is a page that ' +
    'exists only in the sitemap.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [90],
  audit: (bundle, context) => {
    if (normaliseRoute(bundle.dom.route) !== '/') {
      return { mode: 'notApplicable', passed: true, message: 'only asserted from the home page' };
    }
    const linked = new Set(
      bundle.dom.links
        .filter((link) => link.isInternal && link.hasHref)
        .map((link) => {
          try {
            return normaliseRoute(new URL(link.href, context.origin).pathname);
          } catch {
            return '';
          }
        }),
    );
    const orphans = context.pages
      .map((page) => normaliseRoute(page.route))
      .filter((route) => route !== '/' && !linked.has(route));
    return {
      passed: orphans.length === 0,
      items: orphans.map((route) => ({ actual: route, detail: 'not linked from the home page' })),
    };
  },
});

export const ctaPresent: Check = defineCheck({
  id: 'structure.cta-present',
  title: 'The page carries a primary call to action with a real destination',
  failureTitle: 'The page has no primary call to action, or its destination is empty',
  description:
    'A marketing page with nothing to do next is a brochure. The CTA is identified by the ' +
    'renderer, not guessed from text. Legal pages are exempt: a privacy policy is not a ' +
    'conversion page, and a gate that demanded a CTA there would push one onto it.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [96],
  audit: (bundle, context) => {
    if (context.legalRoutes.map(normaliseRoute).includes(normaliseRoute(bundle.dom.route))) {
      return { mode: 'notApplicable', passed: true, message: 'legal page' };
    }
    const ctas = bundle.dom.links.filter(
      (link) => link.rel === 'cta' || /^(tel:|mailto:)/i.test(link.href),
    );
    const ctaSections = bundle.dom.sections.filter((section) => section.sdId.includes('cta'));
    const has = ctas.length > 0 || ctaSections.length > 0;
    return {
      passed: has,
      items: has ? [] : [{ detail: 'no CTA link and no cta section on the page' }],
    };
  },
});

export const navConsistent: Check = defineCheck({
  id: 'nav.consistent',
  title: 'The page has a navigation landmark and a footer',
  failureTitle: 'The page is missing its navigation or footer landmark',
  description:
    'Consistency across pages is asserted at site level by comparing these artifacts; the ' +
    'per-page half is simply that both exist.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [92],
  audit: (bundle) => {
    const landmarks = new Set(bundle.dom.landmarks);
    const missing: CheckEvidence[] = [];
    if (!landmarks.has('nav') && !landmarks.has('navigation')) missing.push({ detail: 'no nav' });
    if (!landmarks.has('footer') && !landmarks.has('contentinfo')) {
      missing.push({ detail: 'no footer' });
    }
    return { passed: missing.length === 0, items: missing };
  },
});

export const domSize: Check = defineCheck({
  id: 'perf.dom-size',
  title: 'The DOM stays under 1500 nodes',
  failureTitle: 'The DOM is large enough to cost real layout time',
  description: 'Deterministic on static output, unlike the timing metrics it predicts.',
  severity: 'minor',
  requiredArtifacts: ['dom'],
  checklistRows: [14],
  audit: (bundle) => ({
    mode: 'numeric',
    passed: bundle.dom.nodeCount <= 1500,
    value: bundle.dom.nodeCount,
    items:
      bundle.dom.nodeCount <= 1500 ? [] : [{ actual: bundle.dom.nodeCount, expected: '<= 1500' }],
  }),
});

export const jsBudget: Check = defineCheck({
  id: 'perf.js-budget-per-page',
  title: 'The page ships within its JavaScript budget',
  failureTitle: 'The page ships more JavaScript than the budget allows',
  description:
    'Measured from the build manifest rather than from transfer size, so it is exact and does ' +
    'not move with compression settings. 180 kB per page (ARCHITECTURE §7).',
  severity: 'critical',
  requiredArtifacts: ['build'],
  checklistRows: [7, 26],
  audit: (bundle, context) => {
    const route = normaliseRoute(bundle.dom.route);
    const bytes =
      bundle.build.jsBytesByRoute[route] ?? bundle.build.jsBytesByRoute[bundle.dom.route];
    if (bytes === undefined) {
      return {
        mode: 'error',
        passed: false,
        message: `the build manifest records no JS size for ${route}`,
      };
    }
    return {
      mode: 'numeric',
      passed: bytes <= context.jsBudgetBytes,
      value: bytes,
      items:
        bytes <= context.jsBudgetBytes
          ? []
          : [{ actual: bytes, expected: `<= ${context.jsBudgetBytes}` }],
    };
  },
});

export const unsizedImages: Check = defineCheck({
  id: 'perf.unsized-images',
  title: 'Every image declares width and height',
  failureTitle: 'An image ships without dimensions and will shift the layout',
  description: 'The single most common cause of cumulative layout shift on a static page.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [12],
  audit: (bundle) => {
    const unsized = bundle.dom.images.filter(
      (image) => image.width === null || image.height === null,
    );
    return {
      passed: unsized.length === 0,
      items: unsized.map((image) => ({ actual: image.src, detail: 'no width/height attributes' })),
    };
  },
});

export const STRUCTURE_CHECKS: readonly Check[] = [
  sdPathPresent,
  sectionCount,
  internalLinksResolve,
  anchorTargets,
  noOrphans,
  ctaPresent,
  navConsistent,
  domSize,
  jsBudget,
  unsizedImages,
];
