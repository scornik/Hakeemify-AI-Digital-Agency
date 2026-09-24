/**
 * Load a built site from disk into artifact bundles.
 *
 * This is the same path a real build takes: the gate reads the build output, not a live server.
 * `sitemap.xml` and `robots.txt` are read as files because that is how they ship, and the routes
 * come from the directory tree rather than from a crawl — the site's own pages are known, so
 * discovery is not a thing the gate has to do.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { ArtifactBundle, BuildArtifact } from '../types.js';
import { gatherStatic } from './static-gatherer.js';
import { readDeployConfig, type DeployTarget } from '../deploy.js';

export interface SiteLoadOptions {
  readonly root: string;
  readonly origin: string;
  readonly jsBytesByRoute?: Readonly<Record<string, number>>;
  readonly siteDefinitionHash: string;
  readonly allowedHosts?: readonly string[];
  readonly buildYear?: number;
  readonly project?: string;
  /**
   * When set, the target's config is read out of `root` and attached to every bundle. Absent,
   * the `deploy.*` checks are `notApplicable` — a build with no host chosen has not failed to
   * declare headers, there is simply nowhere to declare them yet.
   */
  readonly deployTarget?: DeployTarget;
}

function walkHtml(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.endsWith('.html')) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** `/index.html` -> `/`, `/privacy/index.html` -> `/privacy`. */
export function routeOf(root: string, file: string): string {
  const rel = relative(root, file).split(sep).join('/');
  const withoutIndex = rel.replace(/index\.html$/, '');
  const route = `/${withoutIndex}`.replace(/\/{2,}/g, '/');
  return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
}

function parseSitemap(xml: string): string[] {
  const routes: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    const loc = match[1];
    if (loc === undefined) continue;
    try {
      routes.push(new URL(loc).pathname);
    } catch {
      routes.push(loc);
    }
  }
  return routes;
}

export function loadSite(options: SiteLoadOptions): ArtifactBundle[] {
  const files = walkHtml(options.root).sort();
  const routes = files.map((file) => routeOf(options.root, file));

  const sitemapPath = join(options.root, 'sitemap.xml');
  const robotsPath = join(options.root, 'robots.txt');
  const llmsPath = join(options.root, 'llms.txt');

  const build: BuildArtifact = {
    siteDefinitionHash: options.siteDefinitionHash,
    jsBytesByRoute: options.jsBytesByRoute ?? Object.fromEntries(routes.map((route) => [route, 0])),
    routes,
    sitemapRoutes: existsSync(sitemapPath) ? parseSitemap(readFileSync(sitemapPath, 'utf8')) : [],
    robotsTxt: existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : null,
    llmsTxt: existsSync(llmsPath) ? readFileSync(llmsPath, 'utf8') : null,
    allowedHosts: options.allowedHosts ?? [],
    buildYear: options.buildYear ?? new Date().getFullYear(),
  };

  // Read once for the whole site: a deploy config is site-wide, not per page.
  const deploy =
    options.deployTarget === undefined
      ? null
      : readDeployConfig(options.root, options.deployTarget);

  return files.map((file, index) => ({
    project: options.project ?? 'static',
    build,
    dom: gatherStatic({
      route: routes[index] as string,
      html: readFileSync(file, 'utf8'),
      origin: options.origin,
    }),
    ...(deploy === null ? {} : { deploy }),
  }));
}
