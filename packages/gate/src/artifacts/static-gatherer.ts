/**
 * The static gatherer: built HTML -> `DomArtifact`.
 *
 * Two gatherers produce the same artifact shape. This one parses the build output with jsdom
 * and needs no browser; the Playwright gatherer adds what only a real browser knows (computed
 * styles, console, network, LCP, tab order). Splitting them this way is what makes ~40 of the
 * gate's rows runnable on every page in CI in seconds, with the expensive browser pass reserved
 * for the rows that genuinely need it — Unlighthouse's cheap-then-expensive ordering, applied
 * to checks rather than to routes.
 *
 * The artifact is JSON, not a live DOM, so a failing check can be reproduced from stored
 * artifacts instead of by re-running the site.
 */
import { JSDOM } from 'jsdom';
import type {
  DomArtifact,
  FormArtifact,
  HeadingArtifact,
  ImageArtifact,
  LinkArtifact,
  SectionArtifact,
} from '../types.js';

export interface StaticGatherInput {
  readonly route: string;
  readonly html: string;
  readonly origin: string;
  readonly statusCode?: number;
}

const HONEYPOT_NAMES = /honeypot|hp_field|bot_?trap|website_url|leave_blank/i;

function textOf(node: Element | null): string {
  return (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isInternal(href: string, origin: string): boolean {
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('?')) return true;
  if (href.startsWith(origin)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(href);
}

function measureDepth(root: Element): { nodeCount: number; maxDepth: number } {
  let nodeCount = 0;
  let maxDepth = 0;
  const walk = (element: Element, depth: number): void => {
    nodeCount += 1;
    if (depth > maxDepth) maxDepth = depth;
    for (const child of Array.from(element.children)) walk(child, depth + 1);
  };
  walk(root, 1);
  return { nodeCount, maxDepth };
}

export function gatherStatic(input: StaticGatherInput): DomArtifact {
  const dom = new JSDOM(input.html, { url: new URL(input.route, input.origin).href });
  const doc = dom.window.document;

  const meta = (selector: string, attribute = 'content'): string | null =>
    doc.querySelector(selector)?.getAttribute(attribute) ?? null;

  const og: Record<string, string> = {};
  for (const element of Array.from(doc.querySelectorAll('meta[property^="og:"]'))) {
    const property = element.getAttribute('property');
    const content = element.getAttribute('content');
    if (property && content) og[property.slice(3)] = content;
  }

  const twitter: Record<string, string> = {};
  for (const element of Array.from(doc.querySelectorAll('meta[name^="twitter:"]'))) {
    const name = element.getAttribute('name');
    const content = element.getAttribute('content');
    if (name && content) twitter[name.slice(8)] = content;
  }

  const jsonLd: unknown[] = [];
  for (const element of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      jsonLd.push(JSON.parse(element.textContent ?? ''));
    } catch {
      // A block that does not parse is itself the finding; record it so `schema.jsonld-valid`
      // can report it rather than silently seeing one fewer block.
      jsonLd.push({ __parse_error: true, raw: (element.textContent ?? '').slice(0, 200) });
    }
  }

  const headings: HeadingArtifact[] = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(
    (element) => ({
      level: Number(element.tagName.slice(1)),
      text: textOf(element),
    }),
  );

  const links: LinkArtifact[] = Array.from(doc.querySelectorAll('a')).map((element) => {
    const href = element.getAttribute('href');
    return {
      href: href ?? '',
      text: textOf(element) || element.getAttribute('aria-label') || '',
      ...(element.getAttribute('rel') === null
        ? {}
        : { rel: element.getAttribute('rel') as string }),
      ...(element.getAttribute('target') === null
        ? {}
        : { target: element.getAttribute('target') as string }),
      isInternal: href ? isInternal(href, input.origin) : false,
      hasHref: href !== null && href.trim() !== '',
    };
  });

  const images: ImageArtifact[] = Array.from(doc.querySelectorAll('img')).map((element) => {
    const width = element.getAttribute('width');
    const height = element.getAttribute('height');
    return {
      src: element.getAttribute('src') ?? '',
      alt: element.getAttribute('alt'),
      width: width === null ? null : Number(width),
      height: height === null ? null : Number(height),
      loading: element.getAttribute('loading'),
      fetchpriority: element.getAttribute('fetchpriority'),
      gradeId: element.getAttribute('data-grade'),
      sdPath: element.getAttribute('data-sd-path'),
      inPictureSource: element.parentElement?.tagName.toLowerCase() === 'picture',
    };
  });

  const forms: FormArtifact[] = Array.from(doc.querySelectorAll('form')).map((form) => {
    const fields = Array.from(form.querySelectorAll('input,select,textarea')).map((field) => {
      const id = field.getAttribute('id');
      const name = field.getAttribute('name') ?? '';
      const labelled =
        (id !== null && form.querySelector(`label[for="${CSS.escape(id)}"]`) !== null) ||
        field.closest('label') !== null ||
        field.getAttribute('aria-label') !== null ||
        field.getAttribute('aria-labelledby') !== null;
      return {
        name,
        type: field.getAttribute('type') ?? field.tagName.toLowerCase(),
        required: field.hasAttribute('required'),
        hasLabel: labelled,
        autocomplete: field.getAttribute('autocomplete'),
      };
    });
    return {
      action: form.getAttribute('action'),
      method: form.getAttribute('method'),
      fields,
      hasHoneypot: fields.some((field) => HONEYPOT_NAMES.test(field.name)),
    };
  });

  const sections: SectionArtifact[] = Array.from(doc.querySelectorAll('[data-sd-id]')).map(
    (element) => ({
      sdId: element.getAttribute('data-sd-id') ?? '',
      sdPath: element.getAttribute('data-sd-path') ?? '',
      variantId: element.getAttribute('data-sd-variant'),
      arrangementId: element.getAttribute('data-sd-arrangement'),
      textLength: textOf(element).length,
    }),
  );

  const landmarks = Array.from(doc.querySelectorAll('main,nav,header,footer,aside,[role]')).map(
    (element) => element.getAttribute('role') ?? element.tagName.toLowerCase(),
  );

  const emptyInteractiveText = Array.from(doc.querySelectorAll('a,button'))
    .filter(
      (element) =>
        textOf(element) === '' &&
        element.getAttribute('aria-label') === null &&
        element.querySelector('img[alt]:not([alt=""])') === null,
    )
    .map((element) => element.outerHTML.slice(0, 120));

  const autoplayMedia = Array.from(doc.querySelectorAll('video[autoplay],audio[autoplay]')).map(
    (element) => ({
      tag: element.tagName.toLowerCase(),
      muted: element.hasAttribute('muted'),
      hasPoster: element.hasAttribute('poster'),
    }),
  );

  const canvases = Array.from(doc.querySelectorAll('canvas'));
  const { nodeCount, maxDepth } = measureDepth(doc.documentElement);

  const attributeText = Array.from(
    doc.querySelectorAll('[alt],[title],[aria-label],[placeholder],meta[content]'),
  )
    .map((element) =>
      ['alt', 'title', 'aria-label', 'placeholder', 'content']
        .map((name) => element.getAttribute(name) ?? '')
        .join(' '),
    )
    .join(' ');

  const artifact: DomArtifact = {
    route: input.route,
    finalUrl: new URL(input.route, input.origin).href,
    statusCode: input.statusCode ?? 200,
    lang: doc.documentElement.getAttribute('lang'),
    title: textOf(doc.querySelector('title')) || null,
    metaDescription: meta('meta[name="description"]'),
    canonical: meta('link[rel="canonical"]', 'href'),
    robots: meta('meta[name="robots"]'),
    viewport: meta('meta[name="viewport"]'),
    og,
    twitter,
    icons: Array.from(doc.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')).map(
      (element) => element.getAttribute('href') ?? '',
    ),
    themeColor: meta('meta[name="theme-color"]'),
    jsonLd,
    headings,
    links,
    images,
    scripts: Array.from(doc.querySelectorAll('script')).map((element) => ({
      src: element.getAttribute('src'),
      inlineBytes: Buffer.byteLength(element.textContent ?? '', 'utf8'),
      type: element.getAttribute('type'),
    })),
    stylesheets: Array.from(doc.querySelectorAll('link[rel="stylesheet"]')).map(
      (element) => element.getAttribute('href') ?? '',
    ),
    inlineStyleText: Array.from(doc.querySelectorAll('style'))
      .map((element) => element.textContent ?? '')
      .join('\n'),
    forms,
    landmarks,
    sections,
    text: textOf(doc.body),
    attributeText,
    canvasCount: canvases.length,
    webglCanvasCount: canvases.filter((element) =>
      (element.getAttribute('data-renderer') ?? '').includes('webgl'),
    ).length,
    autoplayMedia,
    nodeCount,
    maxDepth,
    emptyInteractiveText,
    bytes: Buffer.byteLength(input.html, 'utf8'),
  };

  dom.window.close();
  return artifact;
}
