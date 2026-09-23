/**
 * The renderer's shared runtime.
 *
 * Exposed as the `@ada/library/render` subpath so a section imports it as a dependency rather
 * than reaching into the package by relative path. That is not tidiness: the manifest drift
 * check resolves a relative import to a *file* the manifest must declare, and declaring shared
 * infrastructure in five section manifests would say each section owns a copy of it.
 */
export * from './site.js';
export * from './slots.js';
