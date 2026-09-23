/**
 * SEO checks — gate-checklist §3.
 *
 * Lighthouse covers the per-page basics. Everything here that carries a `seo.` id is a gap
 * Lighthouse does not close: it validates a canonical tag's syntax but never that it equals the
 * final URL or that it is unique across the site, and it has no concept of a sitemap agreeing
 * with the pages that actually exist.
 */
import { defineCheck, hostOf, normaliseRoute, pageFor, type Check } from '../context.js';
import type { CheckEvidence } from '../types.js';

const GENERIC_LINK_TEXT = /^(click here|here|read more|learn more|more|this|link|details)$/i;

export const titlePresent: Check = defineCheck({
  id: 'seo.title-present',
  title: 'The page has a non-empty title',
  failureTitle: 'The page has no title',
  description: 'A missing title is the one SEO defect a reader also sees, in their tab.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [62],
  audit: (bundle) => ({
    passed: (bundle.dom.title ?? '').trim().length > 0,
    items: bundle.dom.title ? [] : [{ detail: 'no <title>' }],
  }),
});

export const titleLength: Check = defineCheck({
  id: 'seo.title-length',
  title: 'The title is between 30 and 60 characters',
  failureTitle: 'The title is too short or too long for a result listing',
  description: 'Outside 30–60 characters a title is truncated or reads as thin.',
  severity: 'minor',
  requiredArtifacts: ['dom'],
  checklistRows: [71],
  audit: (bundle) => {
    const length = (bundle.dom.title ?? '').trim().length;
    return {
      mode: 'numeric',
      passed: length >= 30 && length <= 60,
      value: length,
      items: length >= 30 && length <= 60 ? [] : [{ actual: length, expected: '30–60' }],
    };
  },
});

export const descriptionPresent: Check = defineCheck({
  id: 'seo.description-present',
  title: 'The page has a meta description',
  failureTitle: 'The page has no meta description',
  description: 'Without one the search result is assembled from whatever text is nearest.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [62],
  audit: (bundle) => ({ passed: (bundle.dom.metaDescription ?? '').trim().length > 0 }),
});

export const descriptionLength: Check = defineCheck({
  id: 'seo.description-length',
  title: 'The meta description is between 70 and 160 characters',
  failureTitle: 'The meta description is too short or too long',
  description: 'Outside 70–160 characters a description is padded or truncated.',
  severity: 'minor',
  requiredArtifacts: ['dom'],
  checklistRows: [71],
  audit: (bundle) => {
    const length = (bundle.dom.metaDescription ?? '').trim().length;
    return {
      mode: 'numeric',
      passed: length >= 70 && length <= 160,
      value: length,
      items: length >= 70 && length <= 160 ? [] : [{ actual: length, expected: '70–160' }],
    };
  },
});

export const titleUnique: Check = defineCheck({
  id: 'seo.title-unique',
  title: 'The title is unique across the site',
  failureTitle: 'Another page ships the same title',
  description:
    'Duplicate titles are what a template looks like from outside. Compared against the ' +
    'SiteDefinition rather than by crawling, so the check runs before anything is deployed.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [70],
  audit: (bundle, context) => {
    const title = (bundle.dom.title ?? '').trim();
    const clashes = context.pages.filter(
      (page) =>
        page.title.trim() === title &&
        normaliseRoute(page.route) !== normaliseRoute(bundle.dom.route),
    );
    return {
      passed: clashes.length === 0,
      items: clashes.map((page) => ({ detail: `also used by ${page.route}`, actual: title })),
    };
  },
});

export const descriptionUnique: Check = defineCheck({
  id: 'seo.description-unique',
  title: 'The meta description is unique across the site',
  failureTitle: 'Another page ships the same meta description',
  description: 'Same reasoning as the title.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [70],
  audit: (bundle, context) => {
    const description = (bundle.dom.metaDescription ?? '').trim();
    const clashes = context.pages.filter(
      (page) =>
        page.description.trim() === description &&
        normaliseRoute(page.route) !== normaliseRoute(bundle.dom.route),
    );
    return {
      passed: clashes.length === 0,
      items: clashes.map((page) => ({ detail: `also used by ${page.route}` })),
    };
  },
});

export const canonicalSelf: Check = defineCheck({
  id: 'seo.canonical-self',
  title: 'The canonical URL is present, absolute, and points at this page',
  failureTitle: 'The canonical URL is missing or points somewhere else',
  description:
    'Lighthouse validates canonical syntax but never that it equals the final URL. A canonical ' +
    'pointing at another page removes this one from the index.',
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [68, 72],
  audit: (bundle, context) => {
    const canonical = bundle.dom.canonical;
    if (!canonical) return { passed: false, items: [{ detail: 'no canonical link' }] };

    let parsed: URL;
    try {
      parsed = new URL(canonical);
    } catch {
      return { passed: false, items: [{ actual: canonical, detail: 'not an absolute URL' }] };
    }

    const expected = pageFor(context, normaliseRoute(bundle.dom.route))?.canonical;
    const matchesSelf =
      normaliseRoute(parsed.pathname) === normaliseRoute(bundle.dom.route) &&
      parsed.origin === context.origin;

    return {
      passed: matchesSelf,
      items: matchesSelf ? [] : [{ actual: canonical, expected: expected ?? context.origin }],
    };
  },
});

export const isCrawlable: Check = defineCheck({
  id: 'seo.is-crawlable',
  title: 'The page is indexable when the SiteDefinition says it should be',
  failureTitle: 'The page is blocked from indexing, or indexable when it should not be',
  description:
    'Checked in both directions: a marketing page silently carrying noindex is as bad as a ' +
    'thank-you page that is indexable.',
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [61],
  audit: (bundle, context) => {
    const robots = (bundle.dom.robots ?? '').toLowerCase();
    const noindex = robots.includes('noindex');
    const expected = pageFor(context, normaliseRoute(bundle.dom.route));
    if (!expected) {
      return {
        passed: false,
        message: 'the rendered route is not in the SiteDefinition',
        items: [{ actual: bundle.dom.route }],
      };
    }
    const shouldIndex = expected.indexable;
    return {
      passed: shouldIndex ? !noindex : noindex,
      items:
        shouldIndex === !noindex
          ? []
          : [{ actual: robots || '(none)', expected: shouldIndex ? 'indexable' : 'noindex' }],
    };
  },
});

export const h1Single: Check = defineCheck({
  id: 'seo.h1-single',
  title: 'The page has exactly one h1, and it is not a copy of the title tag',
  failureTitle: 'The page has zero or several h1 elements, or the h1 repeats the title',
  description:
    'axe checks presence; nothing checks count. An h1 that is a verbatim copy of the title is a ' +
    'template tell.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [76],
  audit: (bundle) => {
    const h1s = bundle.dom.headings.filter((heading) => heading.level === 1);
    if (h1s.length !== 1) {
      return { passed: false, items: [{ actual: h1s.length, expected: 1 }] };
    }
    const cloned = h1s[0]?.text.trim() === (bundle.dom.title ?? '').trim();
    return {
      passed: !cloned,
      items: cloned ? [{ detail: 'the h1 repeats the title verbatim', actual: h1s[0]?.text }] : [],
    };
  },
});

export const ogTwitter: Check = defineCheck({
  id: 'seo.og-twitter',
  title: 'Open Graph and Twitter card metadata are complete',
  failureTitle: 'Share metadata is missing fields',
  description: 'The first impression of a link that gets pasted anywhere.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [73],
  audit: (bundle) => {
    const missing: CheckEvidence[] = [];
    for (const key of ['title', 'description', 'image']) {
      if (!bundle.dom.og[key]) missing.push({ detail: `og:${key} missing` });
    }
    if (!bundle.dom.twitter['card']) missing.push({ detail: 'twitter:card missing' });
    return { passed: missing.length === 0, items: missing };
  },
});

export const crawlableAnchors: Check = defineCheck({
  id: 'seo.crawlable-anchors',
  title: 'Every link is a real anchor with an href',
  failureTitle: 'Some links have no href and cannot be followed',
  description: 'A click handler on a span is not a link to anything that crawls the site.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [65],
  audit: (bundle) => {
    const bad = bundle.dom.links.filter(
      (link) => !link.hasHref || link.href.startsWith('javascript:'),
    );
    return {
      passed: bad.length === 0,
      items: bad.map((link) => ({ snippet: link.text || '(no text)', actual: link.href })),
    };
  },
});

export const linkText: Check = defineCheck({
  id: 'seo.link-text',
  title: 'Link text describes its destination',
  failureTitle: 'Some links say "click here" or "learn more"',
  description:
    'Generic link text is both an SEO defect and an accessibility one: a screen reader user ' +
    'listing links hears nothing useful.',
  severity: 'moderate',
  requiredArtifacts: ['dom'],
  checklistRows: [64, 59],
  audit: (bundle) => {
    const generic = bundle.dom.links.filter((link) => GENERIC_LINK_TEXT.test(link.text.trim()));
    return {
      passed: generic.length === 0,
      items: generic.map((link) => ({ actual: link.text, target: link.href })),
    };
  },
});

export const sitemapConsistency: Check = defineCheck({
  id: 'seo.sitemap-consistency',
  title: 'The sitemap lists exactly the pages the SiteDefinition declares',
  failureTitle: 'The sitemap and the SiteDefinition disagree',
  description:
    'Routes come from the SiteDefinition, so this needs no crawl. Extra entries 404; missing ' +
    'entries are pages nobody will find.',
  severity: 'serious',
  requiredArtifacts: ['build'],
  checklistRows: [74],
  audit: (bundle, context) => {
    const declared = new Set(
      context.pages.filter((page) => page.indexable).map((page) => normaliseRoute(page.route)),
    );
    const inSitemap = new Set(bundle.build.sitemapRoutes.map(normaliseRoute));
    const missing = [...declared].filter((route) => !inSitemap.has(route));
    const extra = [...inSitemap].filter((route) => !declared.has(route));
    return {
      passed: missing.length === 0 && extra.length === 0,
      items: [
        ...missing.map((route) => ({ detail: 'declared but not in sitemap', actual: route })),
        ...extra.map((route) => ({ detail: 'in sitemap but not declared', actual: route })),
      ],
    };
  },
});

export const robotsSitemapRef: Check = defineCheck({
  id: 'seo.robots-sitemap-ref',
  title: 'robots.txt exists and points at the sitemap',
  failureTitle: 'robots.txt is missing or does not reference the sitemap',
  description: 'The one line that makes the sitemap discoverable without submitting it anywhere.',
  severity: 'moderate',
  requiredArtifacts: ['build'],
  checklistRows: [75],
  audit: (bundle) => {
    const robots = bundle.build.robotsTxt;
    if (robots === null) return { passed: false, items: [{ detail: 'no robots.txt' }] };
    const referenced = /^\s*sitemap:\s*https?:\/\/\S+/im.test(robots);
    return { passed: referenced, items: referenced ? [] : [{ detail: 'no Sitemap: line' }] };
  },
});

export const externalScriptAllowlist: Check = defineCheck({
  id: 'bp.no-external-script-unlisted',
  title: 'Every subresource comes from an allowlisted host',
  failureTitle: 'A script, stylesheet or image loads from a host that is not allowlisted',
  description:
    'One module defines what may be referenced, and both the build and this check read it. ' +
    'A hard failure, not a warning: an unlisted host is an uncontrolled dependency on a ' +
    "client's site.",
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [87, 80],
  audit: (bundle, context) => {
    const allowed = new Set(context.allowedHosts);
    const selfHost = hostOf(context.origin, context.origin);
    const offenders: CheckEvidence[] = [];

    const inspect = (url: string | null, kind: string): void => {
      if (!url || url.startsWith('data:')) return;
      const host = hostOf(url, context.origin);
      if (host === null || host === selfHost || allowed.has(host)) return;
      offenders.push({ detail: `${kind} from ${host}`, actual: url });
    };

    for (const script of bundle.dom.scripts) inspect(script.src, 'script');
    for (const href of bundle.dom.stylesheets) inspect(href, 'stylesheet');
    for (const image of bundle.dom.images) inspect(image.src, 'image');

    return { passed: offenders.length === 0, items: offenders };
  },
});

export const SEO_CHECKS: readonly Check[] = [
  titlePresent,
  titleLength,
  descriptionPresent,
  descriptionLength,
  titleUnique,
  descriptionUnique,
  canonicalSelf,
  isCrawlable,
  h1Single,
  ogTwitter,
  crawlableAnchors,
  linkText,
  sitemapConsistency,
  robotsSitemapRef,
  externalScriptAllowlist,
];
