#!/usr/bin/env node
/**
 * Build a site from a `SiteDefinition`, and emit the build manifest the gate reads.
 *
 * The manifest is not a convenience: `perf.js-budget-per-page` is measured from it rather than
 * from transfer size, so the number is exact and does not move with compression settings. It is
 * computed by walking each emitted page for the scripts it actually references, so a script that
 * exists in the output but is never loaded costs nothing, and a script loaded by two pages is
 * counted against both.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIBRARY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const definitionPath = resolve(arg('definition', 'fixtures/build/site-definition.json'));
const factsPath = resolve(arg('facts', 'fixtures/build/facts.json'));
const outDir = resolve(arg('out', 'dist-site'));
const tokensPath = resolve(arg('tokens', 'build/design-systems/reference_v1/tokens.css'));

if (!existsSync(definitionPath)) throw new Error(`no site definition at ${definitionPath}`);
if (!existsSync(factsPath)) throw new Error(`no facts at ${factsPath}`);

const definition = JSON.parse(readFileSync(definitionPath, 'utf8'));
const origin = new URL(Object.values(definition.pages)[0].seo.canonical).origin;

// The token compiler is part of the build, not a prerequisite a human is expected to remember.
if (!existsSync(tokensPath)) {
  execFileSync(process.execPath, [join(LIBRARY_ROOT, 'scripts', 'compile-tokens.mjs')], {
    cwd: LIBRARY_ROOT,
    stdio: 'inherit',
  });
}

const astroBin = join(LIBRARY_ROOT, 'node_modules', 'astro', 'bin', 'astro.mjs');

execFileSync(process.execPath, [astroBin, 'build', '--outDir', outDir], {
  cwd: LIBRARY_ROOT,
  stdio: 'inherit',
  env: {
    ...process.env,
    ADA_SITE_DEFINITION: definitionPath,
    ADA_FACTS: factsPath,
    ADA_TOKENS_CSS: tokensPath,
    ADA_SITE_ORIGIN: origin,
  },
});

/* ---------------------------------------------------------------------------------------- */
/* Build manifest                                                                            */
/* ---------------------------------------------------------------------------------------- */

function walk(dir, predicate) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function routeOf(file) {
  const rel = relative(outDir, file).split(sep).join('/');
  const route = `/${rel.replace(/index\.html$/, '')}`.replace(/\/{2,}/g, '/');
  return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
}

const pages = walk(outDir, (file) => file.endsWith('.html'));
const jsBytesByRoute = {};
const scriptsByRoute = {};

for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const route = routeOf(page);

  // Only scripts the page actually references count. An unreferenced chunk in the output is
  // dead weight on disk, not bytes a visitor pays for.
  const referenced = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((m) => m[1]);
  const inlineBytes = [...html.matchAll(/<script(?![^>]+src=)[^>]*>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/type=["']application\/ld\+json["']/.test(m[0]))
    .reduce((total, m) => total + Buffer.byteLength(m[1], 'utf8'), 0);

  let bytes = inlineBytes;
  const files = [];
  for (const src of referenced) {
    if (/^https?:/i.test(src)) continue; // an external script is a licence and allowlist matter
    const asset = join(outDir, src.replace(/^\//, ''));
    if (!existsSync(asset)) continue;
    bytes += statSync(asset).size;
    files.push(src);
  }

  jsBytesByRoute[route] = bytes;
  scriptsByRoute[route] = files;
}

const sitemapPath = join(outDir, 'sitemap.xml');
const robotsPath = join(outDir, 'robots.txt');

// The sitemap and robots.txt come from the SiteDefinition, not from a crawl: the routes are
// already known, and a generated sitemap that disagrees with the definition is a gate failure.
const indexableRoutes = Object.values(definition.pages)
  .filter((page) => page.seo.robots.index)
  .map((page) => page.route);

writeFileSync(
  sitemapPath,
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...indexableRoutes.map((route) => `  <url><loc>${new URL(route, origin).href}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n'),
  'utf8',
);

writeFileSync(
  robotsPath,
  `User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap.xml', origin).href}\n`,
  'utf8',
);

const manifest = {
  built_at: new Date().toISOString(),
  origin,
  site_definition_path: relative(LIBRARY_ROOT, definitionPath).split(sep).join('/'),
  routes: pages.map(routeOf).sort(),
  js_bytes_by_route: jsBytesByRoute,
  scripts_by_route: scriptsByRoute,
  pinned: definition.pinned,
  seed: definition.seed,
};

mkdirSync(join(outDir, '_ada'), { recursive: true });
writeFileSync(
  join(outDir, '_ada', 'build-manifest.json'),
  JSON.stringify(manifest, null, 2),
  'utf8',
);

const total = Object.values(jsBytesByRoute).reduce((a, b) => a + b, 0);
console.log(
  `built ${manifest.routes.length} route(s) into ${relative(LIBRARY_ROOT, outDir)} — ` +
    `${total} JS byte(s) across the site`,
);
