/**
 * A static server for the built site, so the browser pass loads the real thing over HTTP.
 *
 * Loading the output from `file://` would be cheaper and would also be a different page: no
 * origin, so no meaningful network log, no `fetch`, and relative-versus-absolute URL bugs that
 * only appear over HTTP. The gate's job is to check what a visitor gets.
 *
 * Node's own `http` module, no dependency. It serves the directory and nothing else: a request
 * that escapes the root is a 403 rather than a file, because a test server that can read the
 * repository is a test server that will eventually be pointed at one.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff2': 'font/woff2',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

export interface StaticSite {
  readonly origin: string;
  close(): Promise<void>;
}

/** Resolve a request path to a file inside the root, or null when it escapes or is missing. */
export function resolveRequest(root: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname.split('?')[0] ?? '/');
  const withinRoot = normalize(join(root, decoded));
  if (withinRoot !== root && !withinRoot.startsWith(root + sep)) return null;

  if (existsSync(withinRoot) && statSync(withinRoot).isDirectory()) {
    const index = join(withinRoot, 'index.html');
    return existsSync(index) ? index : null;
  }
  if (existsSync(withinRoot) && statSync(withinRoot).isFile()) return withinRoot;

  // Astro's `format: 'directory'` means `/privacy` is `/privacy/index.html`.
  const asDirectory = join(withinRoot, 'index.html');
  if (existsSync(asDirectory)) return asDirectory;

  const asHtml = `${withinRoot}.html`;
  return existsSync(asHtml) ? asHtml : null;
}

export async function serveStatic(rootDir: string): Promise<StaticSite> {
  const root = resolve(rootDir);

  const server: Server = createServer((request, response) => {
    const file = resolveRequest(root, request.url ?? '/');
    if (file === null) {
      // A 404 here is a real finding: `links.internal-200` and `bp.no-failed-requests` both read
      // the network log, and inventing a page would hide the defect they exist to catch.
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      response.end(
        '<!doctype html><html lang="en"><head><title>Not found</title></head><body><h1>Not found</h1></body></html>',
      );
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });

  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => (error ? fail(error) : done()));
      }),
  };
}
