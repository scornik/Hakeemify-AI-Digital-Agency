/**
 * `reveal_fade` — tier A (ARCHITECTURE §1.1).
 *
 * The JS does one thing: flip a `data-motion-state` attribute when an element first enters the
 * viewport. It never touches `style`, which is why the byte ceiling stays small and why the
 * animated properties are auditable — they are in the stylesheet beside this file, not in a
 * string built at runtime (ARCHITECTURE §6: state is `data-*`, never class names).
 *
 * Under reduced motion the elements are put straight into their final state and no observer is
 * created. The stylesheet already zeroes the durations; this is belt and braces, and it is the
 * "programmatic → instant" arm of the tri-mode reading.
 */
/*
 * This file ships to a browser, not to node. The root lint config declares node globals for
 * `.js` (it is a repo of tooling), so the two browser globals this effect uses are declared
 * here rather than by widening the shared config for one directory.
 */
/* global document, IntersectionObserver */

const SELECTOR = '[data-motion="reveal_fade"]';

export function revealFade(root = document) {
  const targets = root.querySelectorAll(SELECTOR);
  if (targets.length === 0) return () => {};

  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) {
    for (const target of targets) target.setAttribute('data-motion-state', 'in');
    return () => {};
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute('data-motion-state', 'in');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -10% 0px' },
  );

  for (const target of targets) {
    target.setAttribute('data-motion-state', 'out');
    observer.observe(target);
  }
  return () => observer.disconnect();
}
