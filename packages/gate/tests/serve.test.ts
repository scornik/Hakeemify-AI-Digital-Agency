import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resolveRequest, serveStatic, type StaticSite } from '../src/artifacts/serve.js';

const root = fileURLToPath(new URL('../fixtures/site-clean', import.meta.url));

describe('resolveRequest', () => {
  it('serves index.html for a directory', () => {
    expect(resolveRequest(root, '/')).toMatch(/index\.html$/);
    expect(resolveRequest(root, '/privacy')).toMatch(/privacy[\\/]index\.html$/);
  });

  it('serves a file directly', () => {
    expect(resolveRequest(root, '/robots.txt')).toMatch(/robots\.txt$/);
  });

  it('returns null for a missing path rather than inventing a page', () => {
    // A 404 is a real finding: links.internal-200 and bp.no-failed-requests both read it.
    expect(resolveRequest(root, '/nope')).toBeNull();
  });

  it('refuses a path that escapes the root', () => {
    // A test server that can read the repository is a test server that will eventually be
    // pointed at one.
    expect(resolveRequest(root, '/../../package.json')).toBeNull();
    expect(resolveRequest(root, '/%2e%2e/%2e%2e/package.json')).toBeNull();
  });

  it('decodes percent-encoding before resolving', () => {
    expect(resolveRequest(root, '/robots%2Etxt')).toMatch(/robots\.txt$/);
  });
});

describe('serveStatic', () => {
  let site: StaticSite;

  beforeAll(async () => {
    site = await serveStatic(root);
  });

  afterAll(async () => {
    await site.close();
  });

  it('serves the built site over HTTP on a loopback port', async () => {
    expect(site.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const response = await fetch(`${site.origin}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toContain('Ridgeline Roofing');
  });

  it('answers 404 for a route the site does not have', async () => {
    expect((await fetch(`${site.origin}/nope`)).status).toBe(404);
  });

  it('sets a content type from the extension', async () => {
    const response = await fetch(`${site.origin}/sitemap.xml`);
    expect(response.headers.get('content-type')).toBe('application/xml; charset=utf-8');
  });
});
