/**
 * `@ada/library` — the authored assets and the infrastructure that loads, compiles, validates
 * and addresses them (ARCHITECTURE §2, P3).
 *
 * What lives here is the machinery. What does *not* live here, and will not until a human puts
 * it here, is the library itself: graded `.astro` section variants, `signature_move`,
 * `negative_example`, rubric booleans and ELO (ARCHITECTURE §10).
 */
export const PACKAGE_NAME = '@ada/library';

export * from './paths.js';
export * from './tokens/index.js';
export * from './manifest/index.js';
export * from './motion/index.js';
