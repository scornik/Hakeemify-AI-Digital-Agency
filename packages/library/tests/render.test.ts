import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

import { LIBRARY_ROOT } from '../src/paths.js';
import { loadManifests } from '../src/manifest/load.js';
import { eligibleVariants } from '../src/manifest/eligibility.js';

const DIST = join(LIBRARY_ROOT, 'dist-site');
const MANIFEST = join(DIST, '_ada', 'build-manifest.json');
const DEFINITION = join(LIBRARY_ROOT, 'fixtures', 'build', 'site-definition.json');

interface BuildManifest {
  routes: string[];
  js_bytes_by_route: Record<string, number>;
  scripts_by_route: Record<string, string[]>;
  pinned: Record<string, string>;
  seed: number;
}

interface SiteDefinition {
  pages: Record<
    string,
    {
      route: string;
      order: string[];
      sections: Record<
        string,
        { variant_id: string; arrangement_id: string; slots: Record<string, unknown> }
      >;
    }
  >;
}

let html = '';
let manifest: BuildManifest;
const definition = JSON.parse(readFileSync(DEFINITION, 'utf8')) as SiteDefinition;

beforeAll(() => {
  // The tests assert against a real build, not a mock of one. Building here rather than
  // requiring a human to remember means a stale `dist-site` can never quietly pass.
  if (!existsSync(MANIFEST)) {
    execFileSync(process.execPath, [join(LIBRARY_ROOT, 'scripts', 'build-site.mjs')], {
      cwd: LIBRARY_ROOT,
      stdio: 'inherit',
    });
  }
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as BuildManifest;
  html = readFileSync(join(DIST, 'index.html'), 'utf8');
}, 120_000);

/** Attributes of every element carrying `data-sd-id`, in document order. */
function sectionRoots(
  source: string,
): { sdId: string; sdPath: string; variant: string; arrangement: string }[] {
  const out: { sdId: string; sdPath: string; variant: string; arrangement: string }[] = [];
  const re = /<section\b([^>]*\bdata-sd-id="[^"]+"[^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const attrs = match[1] ?? '';
    const read = (name: string): string => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1] ?? '';
    out.push({
      sdId: read('data-sd-id'),
      sdPath: read('data-sd-path'),
      variant: read('data-sd-variant'),
      arrangement: read('data-sd-arrangement'),
    });
  }
  return out;
}

/** Resolve a `pages.home.sections.s_hero` pointer against the definition. */
function resolvePointer(pointer: string, root: unknown): unknown {
  let current: unknown = root;
  for (const segment of pointer.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

describe('the renderer', () => {
  it('emits one page per route the SiteDefinition declares, and no others', () => {
    const declared = Object.values(definition.pages)
      .map((page) => page.route)
      .sort();
    expect(manifest.routes).toEqual(declared);
  });

  it('stamps every section root with an id and a path that resolve against the definition', () => {
    const roots = sectionRoots(html);
    const home = definition.pages['home'];
    if (!home) throw new Error('the fixture has no home page');

    expect(roots.map((root) => root.sdId)).toEqual(home.order);

    for (const root of roots) {
      // The pointer is the contract between the renderer, the gate, the repair loop, telemetry
      // and the post-V1 editor. A section whose pointer does not resolve is invisible to all of
      // them, which is worse than a section that failed to render.
      const resolved = resolvePointer(root.sdPath, definition);
      expect(resolved, `${root.sdPath} did not resolve`).toBeDefined();
      expect((resolved as { variant_id: string }).variant_id).toBe(root.variant);
      expect((resolved as { arrangement_id: string }).arrangement_id).toBe(root.arrangement);
    }
  });

  it('stamps every editable field with the slot pointer it came from', () => {
    const fieldPaths = [...html.matchAll(/data-sd-path="([^"]*\.slots\.[^"]+)"/g)].map(
      (m) => m[1] ?? '',
    );
    expect(fieldPaths.length).toBeGreaterThan(0);

    for (const path of fieldPaths) {
      expect(resolvePointer(path, definition), `${path} did not resolve`).toBeDefined();
    }
  });

  it('renders every bound slot, so nothing was dropped between definition and page', () => {
    const home = definition.pages['home'];
    if (!home) throw new Error('the fixture has no home page');
    const stamped = new Set(
      [...html.matchAll(/data-sd-path="([^"]*\.slots\.[^"]+)"/g)].map((m) => m[1] ?? ''),
    );
    for (const [instanceId, section] of Object.entries(home.sections)) {
      for (const slot of Object.keys(section.slots)) {
        expect(stamped.has(`pages.home.sections.${instanceId}.slots.${slot}`)).toBe(true);
      }
    }
  });

  it('ships within the 180 kB JavaScript budget, measured from the build manifest', () => {
    for (const [route, bytes] of Object.entries(manifest.js_bytes_by_route)) {
      expect(bytes, `${route} ships ${bytes} bytes of JS`).toBeLessThanOrEqual(184_320);
    }
  });

  it('ships no JavaScript at all from the scaffolds, which is the point of the islands policy', () => {
    // Native `<details name>` is the FAQ accordion. The first tier of ARCHITECTURE §6 is not a
    // preference; it is what makes a zero-kilobyte page possible.
    expect(Object.values(manifest.js_bytes_by_route)).toEqual([0]);
    expect(manifest.scripts_by_route['/']).toEqual([]);
    expect(html).toContain('<details name=');
  });

  it('carries the reduced-motion kill switch in the document, independently of any script', () => {
    expect(html).toMatch(/@media[^{]*prefers-reduced-motion\s*:\s*reduce/);
  });

  it('pins the build, so a retired design system can never restyle it later', () => {
    expect(manifest.pinned['design_system']).toBe('reference_v1@1.0');
    expect(manifest.pinned['library']).toMatch(/^[0-9a-f]{7,40}$/);
    expect(manifest.seed).toBe(20260923);
  });

  it('emits a sitemap that agrees with the definition, and a robots.txt that points at it', () => {
    const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
    const robots = readFileSync(join(DIST, 'robots.txt'), 'utf8');
    expect(sitemap).toContain('<loc>https://ridgelineroofing.example/</loc>');
    expect(robots).toMatch(/^Sitemap: https:\/\/ridgelineroofing\.example\/sitemap\.xml$/m);
  });

  it('writes the head itself, so no section can change the page identity', () => {
    expect(html).toContain('<title>Ridgeline Roofing');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain('application/ld+json');
  });
});

describe('the scaffold sections', () => {
  const manifests = loadManifests();

  it('are all scaffolds, ungraded, with no signature move', () => {
    expect(manifests).toHaveLength(5);
    for (const { manifest: section } of manifests) {
      expect(section.status, section.name).toBe('scaffold');
      for (const arrangement of section.arrangements) {
        expect(arrangement.grade, `${section.name}/${arrangement.id}`).toBe('ungraded');
        expect(arrangement.signature_move).toBeUndefined();
      }
      expect(section.authoring).toBeUndefined();
    }
  });

  it('fill every beat of the service_clarity fallback archetype', () => {
    const beats = new Set(manifests.flatMap(({ manifest: section }) => section.serves_beats));
    expect([...beats].sort()).toEqual(['evidence', 'hook', 'mechanism', 'objection', 'offer']);
  });

  it('are excluded from a client build and admitted to a fixture build', () => {
    const snapshot = [{ predicate: 'count(proof.credentials) >= 1', actual: 2, result: true }];
    const sections = manifests.map(({ manifest: section }) => section);
    const client = eligibleVariants(sections, {
      build: 'client',
      snapshot,
      designSystemId: 'reference_v1',
    });
    const fixture = eligibleVariants(sections, {
      build: 'fixture',
      snapshot,
      designSystemId: 'reference_v1',
    });
    expect(client.eligible).toHaveLength(0);
    expect(fixture.eligible.length).toBeGreaterThan(0);
  });

  it('declare no JavaScript budget, because they ship none', () => {
    for (const { manifest: section } of manifests) {
      expect(section.budget.js_kb).toBe(0);
      expect(section.motion.tier).toBe('tier_0');
      expect(section.budget.requires_webgl).toBe(false);
    }
  });
});
