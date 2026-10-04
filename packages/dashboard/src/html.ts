/**
 * HTML, by hand, with escaping that cannot be forgotten.
 *
 * ## Why there is no framework here
 *
 * This dashboard renders tables of run state. It needs no client router, no hydration and no build
 * step, and adding React would put a second toolchain in a repository whose whole argument is that
 * a page should ship nothing it does not need. Zero dependencies also keeps the licence gate
 * trivially where it is: `2 in the shipped closure`.
 *
 * The one thing hand-written HTML gets wrong is escaping, so escaping is not optional here. `html`
 * is a tagged template that escapes **every interpolated value**, and the only way to inject markup
 * is to wrap it in `raw()` — which is grep-able, and which a reviewer can check at a glance.
 *
 * That matters more than it would in a normal admin panel. The values on these pages are a
 * client's facts and a model's generated copy: untrusted text from a fact registry, rendered to an
 * operator who is logged into nothing. An unescaped headline is stored XSS with a straight face.
 */

/** Markup that is already safe. The only escape hatch, and deliberately ugly to type. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export function raw(value: string): SafeHtml {
  return new SafeHtml(value);
}

/**
 * Escapes the five characters that matter in both element and attribute context.
 *
 * `'` and `"` are included so a value is safe inside a single- or double-quoted attribute without
 * the caller having to know which they used. Everything here quotes attributes, so that is
 * sufficient; nothing is interpolated into an unquoted attribute, a `<script>` body, a style
 * block, or a `javascript:` URL, and none of those are made safe by this function.
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tagged template. Arrays are joined, `SafeHtml` passes through, everything else is escaped.
 *
 * `null` and `undefined` render as nothing rather than as the strings "null" and "undefined",
 * because a missing version id is blank in a table, not the word null.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    out += render(values[index]) + (strings[index + 1] ?? '');
  }
  return new SafeHtml(out);
}

function render(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(value);
}

/** A URL path segment, encoded for use in an href. */
export function pathSegment(value: string): string {
  return encodeURIComponent(value);
}
