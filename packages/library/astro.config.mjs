// @ts-check
import { defineConfig, passthroughImageService } from 'astro/config';

/**
 * The renderer (ARCHITECTURE §6): Astro, static output, islands only where a state machine is
 * genuinely required.
 *
 * `srcDir` is `./astro` so the generator's pages sit beside the TypeScript library rather than
 * inside it. `image.service` is the passthrough: art direction grades and reference renders are
 * produced at library build time, so Astro's optimiser would be a second, uncontrolled image
 * pipeline — and its `sharp` dependency carries an LGPL component the licence gate denies.
 */
export default defineConfig({
  srcDir: './astro',
  publicDir: './astro/public',
  outDir: './dist-site',
  site: process.env['ADA_SITE_ORIGIN'] ?? 'https://example.test',
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'always' },
  image: { service: passthroughImageService() },
  devToolbar: { enabled: false },
});
