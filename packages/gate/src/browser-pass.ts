/**
 * The browser pass: launch the project matrix, gather what only a real browser knows, and run
 * the full check set against it.
 *
 * Everything decidable from the build output was already decided by the static pass. This adds
 * axe with the full tag set, computed focus states, tab order, the LCP element, the network log
 * and — the reason the `reduced-motion` project exists at all — an actual count of animations
 * running when the visitor has asked for none.
 *
 * Playwright is imported lazily so the gate package still typechecks, unit-tests and installs in
 * an environment with no browser binaries. A run that cannot launch a browser **fails**; it does
 * not quietly fall back to the static subset, which is the whole reason the two passes are
 * separate entry points.
 */
import { readFileSync } from 'node:fs';

import { gatherStatic } from './artifacts/static-gatherer.js';
import { serveStatic } from './artifacts/serve.js';
import { MOTION_INIT_SCRIPT } from './artifacts/motion-probe.js';
import { collectConsole, collectNetwork, gatherRuntime } from './artifacts/browser-gatherer.js';
import { ALL_CHECKS } from './checks/index.js';
import { runGate } from './registry.js';
import { mergeReports, type GateReport } from './report.js';
import { AXE_TAGS, GATE_POLICY_VERSION, PROJECTS, type ProjectDefinition } from './policy.js';
import type { GateContext } from './context.js';
import type { ArtifactBundle, AxeArtifact, BuildArtifact } from './types.js';
import type { SiteGateResult } from './runner.js';

export class BrowserUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'the browser pass could not start a browser. This is a failure, not a reason to fall back ' +
        'to the static checks: run `npx playwright install chromium`. ' +
        `(${cause instanceof Error ? cause.message : String(cause)})`,
    );
    this.name = 'BrowserUnavailableError';
  }
}

export interface BrowserPassOptions {
  /** The built site on disk. */
  readonly root: string;
  /** The origin the SiteDefinition declares, which is what canonical URLs are checked against. */
  readonly origin: string;
  readonly context: GateContext;
  readonly build: Omit<BuildArtifact, 'routes'> & { routes?: readonly string[] };
  readonly routes: readonly string[];
  readonly projects?: readonly ProjectDefinition[];
  readonly policyVersion?: string;
}

/** Device presets by project. Kept here rather than in policy so policy stays dependency-free. */
const DEVICE_VIEWPORTS: Readonly<Record<string, { width: number; height: number }>> = {
  'iPhone 14': { width: 390, height: 664 },
  'iPad (gen 7)': { width: 810, height: 1080 },
};

function viewportFor(project: ProjectDefinition): { width: number; height: number } {
  if (project.viewport) return project.viewport;
  if (project.device && DEVICE_VIEWPORTS[project.device]) {
    return DEVICE_VIEWPORTS[project.device] as { width: number; height: number };
  }
  return { width: 1350, height: 940 };
}

/**
 * axe's own output, kept whole. `incomplete` is carried through rather than dropped — Lighthouse
 * drops it, which is how "the machine could not decide" quietly becomes "the page passed".
 */
async function runAxe(page: unknown): Promise<AxeArtifact> {
  const { AxeBuilder } = await import('@axe-core/playwright');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = await new AxeBuilder({ page: page as any }).withTags([...AXE_TAGS]).analyze();
  return {
    violations: results.violations as unknown as AxeArtifact['violations'],
    incomplete: results.incomplete as unknown as AxeArtifact['incomplete'],
    passes: results.passes as unknown as AxeArtifact['passes'],
    tags: [...AXE_TAGS],
  };
}

export async function runBrowserPass(options: BrowserPassOptions): Promise<SiteGateResult> {
  const projects = options.projects ?? PROJECTS;
  const site = await serveStatic(options.root);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let chromium: any;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch (error) {
    await site.close();
    throw new BrowserUnavailableError(error);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let browser: any;
  try {
    browser = await chromium.launch();
  } catch (error) {
    await site.close();
    throw new BrowserUnavailableError(error);
  }

  const reports: GateReport[] = [];

  try {
    for (const project of projects) {
      const viewport = viewportFor(project);
      const browserContext = await browser.newContext({
        viewport,
        colorScheme: project.colorScheme,
        reducedMotion: project.reducedMotion,
        ...(project.device?.startsWith('iPhone') ? { isMobile: true, hasTouch: true } : {}),
      });

      for (const route of options.routes) {
        const page = await browserContext.newPage();
        // Before any page script: a rAF loop already scheduled cannot be observed after the
        // fact, and a shader animating under reduced motion is invisible to getAnimations().
        await page.addInitScript(MOTION_INIT_SCRIPT);
        const consoleCollector = collectConsole(page);
        const networkCollector = collectNetwork(page);

        const response = await page.goto(`${site.origin}${route === '/' ? '/' : route}`, {
          waitUntil: 'load',
        });
        // Fonts change layout, and layout changes contrast, target size and overflow. Every
        // measurement below is taken after they have settled.
        await page.evaluate('document.fonts ? document.fonts.ready : Promise.resolve()');
        consoleCollector.setPhase('interaction');

        // The DOM artifact comes from the *rendered* HTML through the same gatherer the static
        // pass uses, so both passes produce one artifact shape and the checks cannot tell which
        // produced it.
        const dom = gatherStatic({
          route,
          html: await page.content(),
          origin: options.origin,
          statusCode: response?.status() ?? 0,
        });

        const bundle: ArtifactBundle = {
          project: project.name,
          build: { ...options.build, routes: options.routes },
          dom,
          ...(project.artifacts.includes('axe') ? { axe: await runAxe(page) } : {}),
          ...(project.artifacts.includes('console') ? { console: consoleCollector.artifact } : {}),
          ...(project.artifacts.includes('network') ? { network: networkCollector.artifact } : {}),
          ...(project.artifacts.includes('runtime')
            ? {
                runtime: await gatherRuntime(page, {
                  reducedMotion: project.reducedMotion === 'reduce',
                  viewport,
                }),
              }
            : {}),
          ...(project.artifacts.includes('screenshots') ? { screenshots: {} } : {}),
        };

        reports.push(
          runGate(ALL_CHECKS, bundle, {
            context: options.context,
            policyVersion: options.policyVersion ?? GATE_POLICY_VERSION,
            // The project's declared artifacts are a promise. Not producing one is a gatherer
            // failure, and a weighted error nulls the report.
            requireArtifacts: project.artifacts.filter((name) => name !== 'screenshots'),
          }),
        );

        await page.close();
      }

      await browserContext.close();
    }
  } finally {
    await browser.close();
    await site.close();
  }

  return { reports, ...mergeReports(reports) };
}

/** Read the routes and per-route JS bytes the renderer recorded. */
export function readBuildManifest(path: string): {
  routes: string[];
  jsBytesByRoute: Record<string, number>;
} {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
    routes: string[];
    js_bytes_by_route: Record<string, number>;
  };
  return { routes: manifest.routes, jsBytesByRoute: manifest.js_bytes_by_route };
}
