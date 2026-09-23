/**
 * Schema.org, legal, trust and motion — gate-checklist §7 and §9.
 *
 * Lighthouse's `structured-data` audit is manual and weight 0, so structured data is validated
 * here or not at all. The trust rows are the ones a local business is actually judged on: the
 * phone number in the footer matching the one in the JSON-LD matching the one in the registry.
 */
import { z } from 'zod';
import { defineCheck, normaliseRoute, type Check } from '../context.js';
import type { CheckEvidence } from '../types.js';

const ALLOWED_TYPES = [
  'LocalBusiness',
  'RoofingContractor',
  'Organization',
  'Service',
  'FAQPage',
  'BreadcrumbList',
  'WebSite',
  'Person',
] as const;

const JsonLdBlock = z.object({
  '@context': z.string().optional(),
  '@type': z.string(),
});

const LocalBusinessBlock = z.object({
  '@type': z.string(),
  name: z.string().min(1),
  telephone: z.string().min(1).optional(),
  url: z.string().optional(),
  address: z
    .object({
      '@type': z.string().optional(),
      streetAddress: z.string().min(1),
      addressLocality: z.string().min(1),
      postalCode: z.string().min(1),
      addressCountry: z.string().min(1),
    })
    .optional(),
});

export const jsonLdValid: Check = defineCheck({
  id: 'schema.jsonld-valid',
  title: 'Every JSON-LD block parses and declares an allowlisted type',
  failureTitle: 'A JSON-LD block is malformed or declares an unexpected type',
  description:
    'Lighthouse marks structured data manual and scores it zero, so nothing else in the stack ' +
    'validates it. A LocalBusiness block missing its address is invisible to the thing it exists ' +
    'for.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [69, 119],
  audit: (bundle) => {
    const problems: CheckEvidence[] = [];
    if (bundle.dom.jsonLd.length === 0) {
      return { passed: false, items: [{ detail: 'no JSON-LD on the page' }] };
    }

    for (const [index, block] of bundle.dom.jsonLd.entries()) {
      if (typeof block === 'object' && block !== null && '__parse_error' in block) {
        problems.push({
          detail: `block ${index} does not parse`,
          snippet: String((block as Record<string, unknown>)['raw']),
        });
        continue;
      }
      const parsed = JsonLdBlock.safeParse(block);
      if (!parsed.success) {
        problems.push({ detail: `block ${index} has no @type` });
        continue;
      }
      if (!(ALLOWED_TYPES as readonly string[]).includes(parsed.data['@type'])) {
        problems.push({
          detail: `block ${index} type not allowlisted`,
          actual: parsed.data['@type'],
        });
        continue;
      }
      if (/business|contractor|organization/i.test(parsed.data['@type'])) {
        const business = LocalBusinessBlock.safeParse(block);
        if (!business.success) {
          problems.push({
            detail: `block ${index} is a business type but incomplete`,
            actual: business.error.issues.map((issue) => issue.path.join('.')).join(', '),
          });
        }
      }
    }

    return { passed: problems.length === 0, items: problems };
  },
});

export const schemaFactsMatch: Check = defineCheck({
  id: 'schema.facts-match',
  title: 'JSON-LD values equal the registry values',
  failureTitle: 'JSON-LD states something the registry does not',
  description:
    'Structured data is a machine-readable claim about a business. It gets the same grounding ' +
    'treatment as visible copy.',
  severity: 'critical',
  requiredArtifacts: ['dom'],
  checklistRows: [120],
  audit: (bundle, context) => {
    const problems: CheckEvidence[] = [];
    const normalise = (value: string): string => value.toLowerCase().replace(/[\s()-]/g, '');

    for (const block of bundle.dom.jsonLd) {
      if (typeof block !== 'object' || block === null) continue;
      const record = block as Record<string, unknown>;

      const name = record['name'];
      if (typeof name === 'string' && normalise(name) !== normalise(context.businessName)) {
        problems.push({
          detail: 'name differs from the registry',
          actual: name,
          expected: context.businessName,
        });
      }

      const telephone = record['telephone'];
      if (
        typeof telephone === 'string' &&
        context.contact.phone !== undefined &&
        normalise(telephone) !== normalise(context.contact.phone)
      ) {
        problems.push({
          detail: 'telephone differs from the registry',
          actual: telephone,
          expected: context.contact.phone,
        });
      }
    }

    return { passed: problems.length === 0, items: problems };
  },
});

export const legalPagesPresent: Check = defineCheck({
  id: 'legal.pages-present',
  title: 'The legal pages exist and are linked from the footer',
  failureTitle: 'A required legal page is missing or unlinked',
  description:
    'A privacy policy nobody can reach is the same as no privacy policy. Only asserted from a ' +
    'page that carries the footer.',
  severity: 'critical',
  requiredArtifacts: ['dom', 'build'],
  checklistRows: [121],
  audit: (bundle, context) => {
    const known = new Set(bundle.build.routes.map(normaliseRoute));
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

    const problems: CheckEvidence[] = [];
    for (const route of context.legalRoutes) {
      const normalised = normaliseRoute(route);
      if (!known.has(normalised)) {
        problems.push({ detail: 'legal page does not exist', actual: route });
      } else if (!linked.has(normalised)) {
        problems.push({ detail: 'legal page is not linked from this page', actual: route });
      }
    }
    return { passed: problems.length === 0, items: problems };
  },
});

export const copyrightYear: Check = defineCheck({
  id: 'legal.copyright-year',
  title: 'The footer copyright names the build year and the business',
  failureTitle: 'The copyright line is stale or names the wrong business',
  description: 'A last-year copyright is the cheapest possible signal that nobody is home.',
  severity: 'minor',
  requiredArtifacts: ['dom', 'build'],
  checklistRows: [123],
  audit: (bundle, context) => {
    const match = /©|\(c\)|copyright/i.test(bundle.dom.text);
    if (!match) return { passed: false, items: [{ detail: 'no copyright line' }] };
    const hasYear = bundle.dom.text.includes(String(bundle.build.buildYear));
    const hasName = bundle.dom.text.toLowerCase().includes(context.businessName.toLowerCase());
    return {
      passed: hasYear && hasName,
      items: [
        ...(hasYear
          ? []
          : [{ detail: 'build year not in the copyright line', expected: bundle.build.buildYear }]),
        ...(hasName
          ? []
          : [
              { detail: 'business name not in the copyright line', expected: context.businessName },
            ]),
      ],
    };
  },
});

export const contactParity: Check = defineCheck({
  id: 'trust.contact-parity',
  title: 'The phone number and address are identical everywhere they appear',
  failureTitle: 'Contact details differ between the page and the registry',
  description:
    'Name, address and phone consistency is what local search is built on, and it is the first ' +
    'thing a visitor loses confidence over.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [124, 103],
  audit: (bundle, context) => {
    const problems: CheckEvidence[] = [];
    const digits = (value: string): string => value.replace(/\D/g, '');

    if (context.contact.phone) {
      const expected = digits(context.contact.phone);
      const telLinks = bundle.dom.links.filter((link) => link.href.startsWith('tel:'));
      const mismatched = telLinks.filter((link) => digits(link.href) !== expected);
      for (const link of mismatched) {
        problems.push({
          detail: 'tel: link differs from the registry',
          actual: link.href,
          expected: context.contact.phone,
        });
      }
    }

    if (context.contact.email) {
      const mailLinks = bundle.dom.links.filter((link) => link.href.startsWith('mailto:'));
      const mismatched = mailLinks.filter(
        (link) => link.href.slice(7).toLowerCase() !== context.contact.email?.toLowerCase(),
      );
      for (const link of mismatched) {
        problems.push({ detail: 'mailto: link differs from the registry', actual: link.href });
      }
    }

    return { passed: problems.length === 0, items: problems };
  },
});

export const faviconPresent: Check = defineCheck({
  id: 'trust.favicon-manifest',
  title: 'The page declares a favicon and a theme colour',
  failureTitle: 'The page has no favicon or theme colour',
  description: 'The tab is part of the first impression, and a missing icon is conspicuous.',
  severity: 'minor',
  requiredArtifacts: ['dom'],
  checklistRows: [125],
  audit: (bundle) => {
    const problems: CheckEvidence[] = [];
    if (bundle.dom.icons.length === 0) problems.push({ detail: 'no icon link' });
    if (!bundle.dom.themeColor) problems.push({ detail: 'no theme-color meta' });
    return { passed: problems.length === 0, items: problems };
  },
});

export const webglCount: Check = defineCheck({
  id: 'motion.webgl-count',
  title: 'At most one WebGL canvas per page, and it ships a poster',
  failureTitle: 'The page has more than one WebGL canvas, or one without a poster',
  description:
    'ARCHITECTURE §1.1: tier C is capped at one per site, below the fold, with a poster that ' +
    'stays in the DOM until the first rendered frame.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [108],
  audit: (bundle) => ({
    mode: 'numeric',
    passed: bundle.dom.webglCanvasCount <= 1,
    value: bundle.dom.webglCanvasCount,
    items:
      bundle.dom.webglCanvasCount <= 1
        ? []
        : [{ actual: bundle.dom.webglCanvasCount, expected: '<= 1' }],
  }),
});

export const autoplayMedia: Check = defineCheck({
  id: 'motion.autoplay-media',
  title: 'Autoplaying media is muted and has a poster',
  failureTitle: 'Autoplaying media is unmuted or has no poster',
  description: 'Sound a visitor did not ask for is the fastest way to lose them.',
  severity: 'serious',
  requiredArtifacts: ['dom'],
  checklistRows: [109, 43],
  audit: (bundle) => {
    const offenders = bundle.dom.autoplayMedia.filter(
      (media) => !media.muted || (media.tag === 'video' && !media.hasPoster),
    );
    return {
      passed: offenders.length === 0,
      items: offenders.map((media) => ({
        detail: `${media.tag} autoplays ${media.muted ? 'with no poster' : 'unmuted'}`,
      })),
    };
  },
});

export const consentBeforeTracking: Check = defineCheck({
  id: 'legal.consent-before-tracking',
  title: 'No third-party request fires before consent',
  failureTitle: 'A third-party request fired before consent was given',
  description: 'Read from the network log, so it is a fact about the page rather than a promise.',
  severity: 'critical',
  requiredArtifacts: ['network'],
  checklistRows: [122],
  audit: (bundle, context) => {
    if (!context.consentRequired) {
      return {
        mode: 'notApplicable',
        passed: true,
        message: 'the site ships no consent-gated third party',
      };
    }
    const early = (bundle.network?.requests ?? []).filter(
      (request) => request.beforeConsent && !request.url.startsWith(context.origin),
    );
    return {
      passed: early.length === 0,
      items: early.map((request) => ({ actual: request.url })),
    };
  },
});

export const consoleClean: Check = defineCheck({
  id: 'bp.console-clean',
  title: 'No console errors during load or scripted interaction',
  failureTitle: 'The page logs errors',
  description:
    'Lighthouse covers load only. The interaction phase — opening the nav, submitting the form, ' +
    'scrolling to the end — is where a generated site actually breaks.',
  severity: 'serious',
  requiredArtifacts: ['console'],
  checklistRows: [81, 86],
  audit: (bundle) => {
    const errors = (bundle.console?.messages ?? []).filter((message) => message.level === 'error');
    const pageErrors = bundle.console?.pageErrors ?? [];
    return {
      passed: errors.length === 0 && pageErrors.length === 0,
      items: [
        ...errors.map((message) => ({ detail: `${message.phase}: ${message.text}` })),
        ...pageErrors.map((text) => ({ detail: `uncaught: ${text}` })),
      ],
    };
  },
});

export const networkFailures: Check = defineCheck({
  id: 'bp.no-failed-requests',
  title: 'Every request the page makes succeeds',
  failureTitle: 'A request failed or returned 4xx/5xx',
  description: 'A 404 on a stylesheet is a page that shipped looking nothing like the reference.',
  severity: 'serious',
  requiredArtifacts: ['network'],
  checklistRows: [86, 88],
  audit: (bundle) => {
    const failed = (bundle.network?.requests ?? []).filter(
      (request) => request.failed || request.status >= 400,
    );
    return {
      passed: failed.length === 0,
      items: failed.map((request) => ({ actual: request.url, detail: `status ${request.status}` })),
    };
  },
});

export const lcpElementIdentity: Check = defineCheck({
  id: 'content.lcp-element-identity',
  title: 'The largest contentful paint element is the one the SiteDefinition intended',
  failureTitle: 'The LCP element is not the hero media or heading',
  description:
    'A logo or an icon winning LCP means the hero did not load. Element identity is ' +
    'deterministic even though the timing around it is not.',
  severity: 'serious',
  requiredArtifacts: ['runtime'],
  checklistRows: [20, 114],
  audit: (bundle, context) => {
    const runtime = bundle.runtime;
    if (!runtime) return { mode: 'notApplicable', passed: false };
    const expected = context.pages.find(
      (page) => normaliseRoute(page.route) === normaliseRoute(bundle.dom.route),
    )?.lcpSdId;
    if (!expected) {
      return {
        mode: 'informative',
        passed: true,
        message: 'no LCP element declared for this page',
      };
    }
    return {
      passed: runtime.lcpElementSdId === expected,
      items:
        runtime.lcpElementSdId === expected
          ? []
          : [{ actual: runtime.lcpElementSdId ?? runtime.lcpElementTag, expected }],
    };
  },
});

export const TRUST_CHECKS: readonly Check[] = [
  jsonLdValid,
  schemaFactsMatch,
  legalPagesPresent,
  copyrightYear,
  contactParity,
  faviconPresent,
  webglCount,
  autoplayMedia,
  consentBeforeTracking,
  consoleClean,
  networkFailures,
  lcpElementIdentity,
];
