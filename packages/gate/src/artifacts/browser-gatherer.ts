/**
 * The browser gatherer: what only a real browser knows.
 *
 * Kept deliberately thin. Everything decidable from the build output is already decided by the
 * static gatherer, so this collects the handful of artifacts that genuinely need a rendered page
 * — computed focus styles, the LCP element, tab order, console, network — and hands them to the
 * same pure checks.
 *
 * `page` is typed structurally rather than importing Playwright's `Page`, so the gate package's
 * unit tests need neither a browser nor a Playwright install to typecheck this file. The real
 * `Page` satisfies the interface.
 */
import type {
  ConsoleArtifact,
  NetworkArtifact,
  NetworkRequestArtifact,
  RuntimeArtifact,
} from '../types.js';

export interface EvaluatablePage {
  evaluate<T>(fn: (arg: unknown) => T, arg?: unknown): Promise<T>;
  keyboard: { press(key: string): Promise<void> };
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  on(event: string, handler: (payload: never) => void): void;
}

/** Runs in the page. Returns the focus state of every focusable control, in tab order. */
export const TAB_ORDER_SCRIPT = `(() => {
  const selector = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const nodes = Array.from(document.querySelectorAll(selector))
    .filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
  return {
    positiveTabIndexCount: nodes.filter((el) => Number(el.getAttribute('tabindex') ?? 0) > 0).length,
    stops: nodes.map((el) => {
      const rect = el.getBoundingClientRect();
      const section = el.closest('[data-sd-id]');
      return {
        sdId: section ? section.getAttribute('data-sd-id') : null,
        tag: el.tagName.toLowerCase(),
        x: Math.round(rect.left + window.scrollX),
        y: Math.round(rect.top + window.scrollY),
      };
    }),
  };
})()`;

/**
 * Runs in the page. A control has a visible focus state when focusing it changes outline,
 * box-shadow or border — comparing computed styles rather than trusting a stylesheet to contain
 * the right rule.
 */
export const FOCUS_VISIBLE_SCRIPT = `(() => {
  const selector = 'a[href], button, input, select, textarea';
  const failures = [];
  for (const el of Array.from(document.querySelectorAll(selector))) {
    const before = getComputedStyle(el);
    const baseline = [before.outlineStyle, before.outlineWidth, before.boxShadow, before.borderColor].join('|');
    el.focus();
    const after = getComputedStyle(el);
    const focused = [after.outlineStyle, after.outlineWidth, after.boxShadow, after.borderColor].join('|');
    if (baseline === focused) {
      failures.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''));
    }
    el.blur();
  }
  return failures;
})()`;

/**
 * Runs in the page under `reducedMotion: 'reduce'`. Counts animations that are still running and
 * checks that any WebGL section is showing its poster. Nothing in the animation ecosystem
 * honours the preference by default, so this is asserted rather than assumed.
 */
export const REDUCED_MOTION_SCRIPT = `(() => {
  const running = document.getAnimations().filter((a) => a.playState === 'running').length;
  const canvases = Array.from(document.querySelectorAll('canvas[data-renderer]'));
  const posterVisible = canvases.length === 0 || canvases.every((c) => {
    const poster = c.parentElement && c.parentElement.querySelector('[data-poster]');
    return poster !== null && getComputedStyle(poster).display !== 'none';
  });
  return { running, posterVisible };
})()`;

/** Runs in the page. The LCP element, resolved to the section that owns it. */
export const LCP_SCRIPT = `(() => new Promise((resolve) => {
  let last = null;
  try {
    new PerformanceObserver((list) => { last = list.getEntries().at(-1) ?? last; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { resolve({ sdId: null, tag: null }); return; }
  requestAnimationFrame(() => setTimeout(() => {
    const el = last && last.element;
    const section = el && el.closest ? el.closest('[data-sd-id]') : null;
    resolve({
      sdId: section ? section.getAttribute('data-sd-id') : null,
      tag: el ? el.tagName.toLowerCase() : null,
    });
  }, 0));
}))()`;

export const HORIZONTAL_SCROLL_SCRIPT = `(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
}))()`;

/** The widths real devices sit at. Checked for horizontal overflow at each. */
export const OVERFLOW_WIDTHS = [320, 412, 768, 1350] as const;

export interface ConsoleCollector {
  readonly artifact: ConsoleArtifact;
  setPhase(phase: 'load' | 'interaction'): void;
}

/** Attach console and page-error listeners. Lighthouse covers load; this covers interaction too. */
export function collectConsole(page: EvaluatablePage): ConsoleCollector {
  const messages: { level: string; text: string; phase: 'load' | 'interaction' }[] = [];
  const pageErrors: string[] = [];
  let phase: 'load' | 'interaction' = 'load';

  page.on('console', ((message: { type(): string; text(): string }) => {
    messages.push({ level: message.type(), text: message.text(), phase });
  }) as never);
  page.on('pageerror', ((error: Error) => {
    pageErrors.push(error.message);
  }) as never);

  return {
    artifact: { messages, pageErrors },
    setPhase(next) {
      phase = next;
    },
  };
}

export interface NetworkCollector {
  readonly artifact: NetworkArtifact;
  grantConsent(): void;
}

/**
 * Record every request, and whether it fired before consent. A promise that no third party loads
 * before consent is only worth as much as the network log that proves it.
 */
export function collectNetwork(page: EvaluatablePage): NetworkCollector {
  const requests: NetworkRequestArtifact[] = [];
  let consented = false;

  page.on('response', ((response: {
    url(): string;
    status(): number;
    request(): { resourceType(): string; failure(): unknown };
    headerValue(name: string): Promise<string | null>;
  }) => {
    requests.push({
      url: response.url(),
      status: response.status(),
      resourceType: response.request().resourceType(),
      bytes: 0,
      failed: false,
      beforeConsent: !consented,
    });
  }) as never);

  page.on('requestfailed', ((request: { url(): string; resourceType(): string }) => {
    requests.push({
      url: request.url(),
      status: 0,
      resourceType: request.resourceType(),
      bytes: 0,
      failed: true,
      beforeConsent: !consented,
    });
  }) as never);

  return {
    artifact: { requests },
    grantConsent() {
      consented = true;
    },
  };
}

export interface GatherRuntimeOptions {
  /** Set when this project emulates `prefers-reduced-motion: reduce`. */
  readonly reducedMotion: boolean;
  readonly viewport: { width: number; height: number };
}

export async function gatherRuntime(
  page: EvaluatablePage,
  options: GatherRuntimeOptions,
): Promise<RuntimeArtifact> {
  const lcp = await page.evaluate<{ sdId: string | null; tag: string | null }>(
    new Function(`return ${LCP_SCRIPT}`) as never,
  );
  const tab = await page.evaluate<{
    positiveTabIndexCount: number;
    stops: { sdId: string | null; tag: string; x: number; y: number }[];
  }>(new Function(`return ${TAB_ORDER_SCRIPT}`) as never);
  const focusVisibleFailures = await page.evaluate<string[]>(
    new Function(`return ${FOCUS_VISIBLE_SCRIPT}`) as never,
  );

  const motion = options.reducedMotion
    ? await page.evaluate<{ running: number; posterVisible: boolean }>(
        new Function(`return ${REDUCED_MOTION_SCRIPT}`) as never,
      )
    : { running: 0, posterVisible: true };

  const horizontalScrollWidths: Record<string, { scrollWidth: number; clientWidth: number }> = {};
  for (const width of OVERFLOW_WIDTHS) {
    await page.setViewportSize({ width, height: options.viewport.height });
    horizontalScrollWidths[String(width)] = await page.evaluate<{
      scrollWidth: number;
      clientWidth: number;
    }>(new Function(`return ${HORIZONTAL_SCROLL_SCRIPT}`) as never);
  }
  await page.setViewportSize(options.viewport);

  return {
    lcpElementSdId: lcp.sdId,
    lcpElementTag: lcp.tag,
    runningAnimationsUnderReducedMotion: motion.running,
    posterVisibleUnderReducedMotion: motion.posterVisible,
    tabStops: tab.stops,
    positiveTabIndexCount: tab.positiveTabIndexCount,
    focusVisibleFailures,
    horizontalScrollWidths,
  };
}
