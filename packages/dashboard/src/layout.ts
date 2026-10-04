/**
 * The shell and the status vocabulary.
 *
 * ## Status is never colour alone
 *
 * Every state on these pages — a run status, a gate verdict, a check result — ships as **icon plus
 * label plus colour**, in that order of reliability. Two reasons, and the second is the one that
 * decides it:
 *
 * 1. On a light surface, `warning` (#fab219) and `serious` (#ec835a) sit below 3:1. The icon and
 *    label are the mitigation, not a nicety.
 * 2. This project's own gate fails a build for conveying meaning by colour alone. A dashboard that
 *    did it while reporting on that gate would be absurd.
 *
 * The four status steps are reserved for state and never reused as decoration.
 *
 * ## Dark mode is declared, not flipped
 *
 * Both scopes, as the palette requires: the media query for the OS setting and `data-theme` for an
 * explicit choice, with the `:not()` guard so a light stamp beats OS dark. There is no toggle in
 * the UI yet; the scope exists so adding one is a button rather than a refactor.
 */
import { html, raw, type SafeHtml } from './html.js';

export type Status = 'good' | 'warning' | 'serious' | 'critical' | 'neutral';

/** Text marks rather than an icon font: a glyph that needs a network request is not a mitigation. */
const STATUS_GLYPH: Readonly<Record<Status, string>> = {
  good: '✓',
  warning: '!',
  serious: '▲',
  critical: '✕',
  neutral: '·',
};

export function badge(status: Status, label: string): SafeHtml {
  return html`<span class="badge badge--${raw(status)}"
    ><span class="badge__glyph" aria-hidden="true">${STATUS_GLYPH[status]}</span
    ><span class="badge__label">${label}</span></span
  >`;
}

/** Map a pipeline run status onto the four reserved steps. */
export function runStatusOf(status: string): Status {
  switch (status) {
    case 'FINISHED':
      return 'good';
    case 'RUNNING':
    case 'IDLE':
      return 'neutral';
    case 'WAITING_FOR_OWNER':
    case 'WAITING_FOR_REVIEW':
      return 'warning';
    case 'STUCK':
    case 'BUDGET_EXCEEDED':
      return 'serious';
    case 'ERROR':
      return 'critical';
    default:
      // An unknown status is not a healthy one. Same rule as the providers' finish reasons.
      return 'critical';
  }
}

/** Map a gate check's mode and outcome onto a step. */
export function checkStatusOf(mode: string, passed: boolean, severity: string): Status {
  if (mode === 'notApplicable') return 'neutral';
  if (mode === 'error') return 'critical';
  if (mode === 'manual' || mode === 'needs_review') return 'warning';
  if (passed) return 'good';
  return severity === 'critical' ? 'critical' : severity === 'serious' ? 'serious' : 'warning';
}

const STYLES = `
:root {
  --surface-0: #f6f6f4;
  --surface-1: #fcfcfb;
  --border: #dedcd6;
  --text-primary: #0b0b0b;
  --text-secondary: #52514e;
  --text-muted: #77756e;
  --good: #0ca30c;
  --warning: #fab219;
  --serious: #ec835a;
  --critical: #d03b3b;
  --neutral: #77756e;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --surface-0: #111110;
    --surface-1: #1a1a19;
    --border: #35342f;
    --text-primary: #ffffff;
    --text-secondary: #c3c2b7;
    --text-muted: #9a988d;
  }
}
:root[data-theme='dark'] {
  color-scheme: dark;
  --surface-0: #111110;
  --surface-1: #1a1a19;
  --border: #35342f;
  --text-primary: #ffffff;
  --text-secondary: #c3c2b7;
  --text-muted: #9a988d;
}

*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  overflow-x: hidden;
  background: var(--surface-0);
  color: var(--text-primary);
  font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
/* 24x24 minimum, because the gate fails a build for less (WCAG 2.2 AA 2.5.8). */
a, button { min-height: 24px; display: inline-block; padding: 2px 0; }

header.top { border-bottom: 1px solid var(--border); margin-bottom: 20px; }
header.top h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: -0.01em; }
header.top p { margin: 0 0 14px; color: var(--text-secondary); font-size: 13px; }
nav.crumbs { font-size: 13px; color: var(--text-secondary); margin-bottom: 10px; }

h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em;
     color: var(--text-secondary); margin: 28px 0 10px; font-weight: 600; }

.tiles { display: flex; flex-wrap: wrap; gap: 2px; margin: 0 0 4px; }
.tile { background: var(--surface-1); border: 1px solid var(--border);
        padding: 10px 14px; min-width: 150px; flex: 1 1 150px; }
.tile dt { font-size: 12px; color: var(--text-muted); margin: 0 0 2px; }
.tile dd { margin: 0; font-size: 22px; font-variant-numeric: tabular-nums;
           letter-spacing: -0.02em; }
.tile dd .unit { font-size: 13px; color: var(--text-secondary); }

/* The table scrolls; the page does not. Without this the run detail overflowed at 411px wide
   (scrollWidth 536) — which this project's own gate fails a build for, via
   structure.no-horizontal-scroll. A tabindex on the scroller so a keyboard can reach it. */
.scroller { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.scroller:focus-visible { outline: 2px solid var(--text-primary); outline-offset: 2px; }
table { width: 100%; border-collapse: collapse; background: var(--surface-1);
        border: 1px solid var(--border); font-size: 14px; }
th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--border);
         vertical-align: top; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;
     color: var(--text-muted); font-weight: 600; }
tr:last-child td { border-bottom: 0; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
code, .mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
/* Long run ids and check ids are the thing that was forcing the overflow. Let them break. */
td, th { overflow-wrap: anywhere; }

.badge { display: inline-flex; align-items: center; gap: 5px; font-size: 13px;
         white-space: nowrap; }
.badge__glyph { display: inline-grid; place-items: center; width: 16px; height: 16px;
                border-radius: 50%; font-size: 10px; line-height: 1; color: #fff;
                flex: 0 0 auto; }
.badge--good    .badge__glyph { background: var(--good); }
.badge--warning .badge__glyph { background: var(--warning); color: #0b0b0b; }
.badge--serious .badge__glyph { background: var(--serious); color: #0b0b0b; }
.badge--critical .badge__glyph { background: var(--critical); }
.badge--neutral .badge__glyph { background: var(--neutral); }

.detail { color: var(--text-secondary); font-size: 13px; }
.empty { background: var(--surface-1); border: 1px dashed var(--border);
         padding: 20px; color: var(--text-secondary); font-size: 14px; }
.note { border-left: 3px solid var(--warning); padding: 8px 12px; margin: 16px 0;
        background: var(--surface-1); font-size: 13px; color: var(--text-secondary); }
footer.bottom { margin-top: 40px; padding-top: 12px; border-top: 1px solid var(--border);
                color: var(--text-muted); font-size: 12px; }
@media (max-width: 640px) {
  .tile { min-width: 120px; }
  table { font-size: 13px; }
  th, td { padding: 6px 7px; }
}
`;

export interface PageOptions {
  readonly title: string;
  readonly subtitle?: string;
  readonly crumbs?: SafeHtml;
  readonly body: SafeHtml;
  /** Rendered in the footer so an operator knows which database they are looking at. */
  readonly source?: string;
}

export function page(options: PageOptions): string {
  return `<!doctype html>
${html`<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${options.title} — ADA runs</title>
    <meta name="robots" content="noindex,nofollow" />
    <style>
      ${raw(STYLES)}
    </style>
  </head>
  <body>
    <div class="wrap">
      <header class="top">
        ${options.crumbs === undefined ? '' : html`<nav class="crumbs">${options.crumbs}</nav>`}
        <h1>${options.title}</h1>
        ${options.subtitle === undefined ? '' : html`<p>${options.subtitle}</p>`}
      </header>
      ${options.body}
      <footer class="bottom">Read-only. ${options.source ?? ''}</footer>
    </div>
  </body>
</html>`}`;
}

/**
 * Wrap a table so it scrolls inside its own box.
 *
 * `role="region"` plus a label makes the scroller a landmark a screen reader can reach, which is
 * the accessibility half of the fix; `tabindex="0"` is the keyboard half, because a scrollable box
 * no one can focus is a box a keyboard user cannot scroll.
 */
export function scroller(label: string, table: SafeHtml): SafeHtml {
  return html`<div class="scroller" role="region" aria-label="${label}" tabindex="0">
    ${table}
  </div>`;
}

export interface Tile {
  readonly label: string;
  readonly value: string;
  readonly unit?: string;
}

export function tiles(items: readonly Tile[]): SafeHtml {
  return html`<dl class="tiles">
    ${items.map(
      (item) =>
        html`<div class="tile">
          <dt>${item.label}</dt>
          <dd>
            ${item.value}${
              item.unit === undefined ? '' : html`<span class="unit"> ${item.unit}</span>`
            }
          </dd>
        </div>`,
    )}
  </dl>`;
}
