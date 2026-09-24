/**
 * Deploy adapters: Vercel, Netlify, Northflank.
 *
 * The renderer emits a plain static directory and that does not change. What each host needs on
 * top of it is a config file declaring response headers, the 404 behaviour and the HTTPS
 * redirect — and each host spells those three things completely differently.
 *
 * **The distinction this file exists to keep honest.** Declaring `Strict-Transport-Security` in
 * `vercel.json` is not the same as an origin serving it. The first is deterministic at build
 * time and is what the `deploy.*` checks assert. The second needs a deployed origin and stays
 * `notApplicable` until there is one. Collapsing the two would produce a gate that reports a
 * security header is present on a site that never sends it, which is worse than reporting
 * nothing.
 *
 * No TOML or YAML parser is used anywhere here: every format emitted is either JSON or a
 * line-oriented text file, so the dependency closure shipped to a client stays where it is.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEPLOY_TARGETS = ['vercel', 'netlify', 'northflank'] as const;
export type DeployTarget = (typeof DEPLOY_TARGETS)[number];

export interface SecurityHeaderPolicy {
  readonly name: string;
  readonly value: string;
  readonly reason: string;
}

export interface HeaderPolicyInput {
  /** Hosts the page is allowed to load from — fonts and analytics only (ARCHITECTURE §7). */
  readonly allowedHosts: readonly string[];
  /** True when any route ships JavaScript. A zero-JS site can forbid scripts outright. */
  readonly shipsJavaScript: boolean;
}

/**
 * The Content-Security-Policy is **derived from the build**, not copied from a boilerplate. A
 * site that ships zero bytes of JavaScript can say `script-src 'none'`, which is a far stronger
 * claim than the `'self'` every template hands out — and the build manifest already knows which
 * it is, so there is no reason to guess.
 */
export function buildContentSecurityPolicy(input: HeaderPolicyInput): string {
  const hosts = [...input.allowedHosts].sort();
  const styleSrc = ["'self'", "'unsafe-inline'", ...hosts];
  const fontSrc = ["'self'", 'data:', ...hosts];

  const directives = [
    `default-src 'self'`,
    // `'none'` is the point of the zero-JS budget being enforced elsewhere: if nothing ships,
    // nothing may run, and an injected <script> is inert rather than merely unexpected.
    input.shipsJavaScript ? `script-src 'self'` : `script-src 'none'`,
    `style-src ${styleSrc.join(' ')}`,
    `img-src 'self' data:`,
    `font-src ${fontSrc.join(' ')}`,
    `connect-src 'self'${hosts.length > 0 ? ` ${hosts.join(' ')}` : ''}`,
    // Clickjacking: `frame-ancestors` is the modern spelling, X-Frame-Options the legacy one.
    // Both are sent, because they are read by different things.
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ];
  return directives.join('; ');
}

export function securityHeaders(input: HeaderPolicyInput): SecurityHeaderPolicy[] {
  return [
    {
      name: 'Strict-Transport-Security',
      value: 'max-age=63072000; includeSubDomains; preload',
      reason: 'checklist 79 — transport. Two years, the minimum the preload list accepts.',
    },
    {
      name: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(input),
      reason: 'checklist 80 — csp-xss, derived from the build rather than templated.',
    },
    {
      name: 'X-Content-Type-Options',
      value: 'nosniff',
      reason: 'checklist 80 — stops a mistyped asset being executed as script.',
    },
    {
      name: 'X-Frame-Options',
      value: 'DENY',
      reason: 'checklist 80 — clickjacking-mitigation, legacy spelling of frame-ancestors.',
    },
    {
      name: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
      reason: 'a client’s visitors should not leak full paths to third parties.',
    },
    {
      name: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=()',
      reason:
        'checklist 83 — geolocation-on-start and friends. A brochure site needs none of these, ' +
        'and denying them outright is stronger than not asking.',
    },
    {
      name: 'Cross-Origin-Opener-Policy',
      value: 'same-origin',
      reason: 'checklist 80 — origin-isolation.',
    },
  ];
}

export interface DeployConfigFile {
  /** Path relative to the build output root. */
  readonly path: string;
  readonly contents: string;
}

export interface DeployConfigInput extends HeaderPolicyInput {
  readonly target: DeployTarget;
}

export class UnknownDeployTargetError extends Error {
  constructor(target: string) {
    super(`${target} is not a deploy target; expected one of ${DEPLOY_TARGETS.join(', ')}`);
    this.name = 'UnknownDeployTargetError';
  }
}

export function renderDeployConfig(input: DeployConfigInput): DeployConfigFile[] {
  const headers = securityHeaders(input);
  switch (input.target) {
    case 'vercel':
      return renderVercel(headers);
    case 'netlify':
      return renderNetlify(headers);
    case 'northflank':
      return renderNorthflank(headers);
    default:
      throw new UnknownDeployTargetError(input.target);
  }
}

function renderVercel(headers: readonly SecurityHeaderPolicy[]): DeployConfigFile[] {
  return [
    {
      path: 'vercel.json',
      contents:
        JSON.stringify(
          {
            $schema: 'https://openapi.vercel.sh/vercel.json',
            cleanUrls: true,
            trailingSlash: false,
            headers: [
              {
                source: '/(.*)',
                headers: headers.map((header) => ({ key: header.name, value: header.value })),
              },
            ],
          },
          null,
          2,
        ) + '\n',
    },
  ];
}

function renderNetlify(headers: readonly SecurityHeaderPolicy[]): DeployConfigFile[] {
  // `_headers` and `_redirects` rather than netlify.toml: plain line-oriented text, no TOML
  // parser needed to read them back, and both are first-class on Netlify.
  const lines = ['/*', ...headers.map((header) => `  ${header.name}: ${header.value}`)];
  return [
    { path: '_headers', contents: lines.join('\n') + '\n' },
    {
      path: '_redirects',
      // 404, never a SPA fallback. A `/* /index.html 200` rule turns every typo into a
      // soft 200 and quietly breaks checklist 77.
      contents: '/* /404.html 404\n',
    },
  ];
}

function renderNorthflank(headers: readonly SecurityHeaderPolicy[]): DeployConfigFile[] {
  // Northflank runs containers, so there is no headers convention to use: the adapter ships the
  // server. nginx rather than a Node process because a static site needs no runtime, and one
  // fewer runtime is one fewer thing in the client's dependency closure.
  const addHeaders = headers
    .map((header) => `    add_header ${header.name} "${header.value}" always;`)
    .join('\n');

  return [
    {
      path: 'nginx.conf',
      contents: `server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # Clean URLs: /privacy resolves to /privacy/index.html, and an unknown path is a real 404
  # rather than a soft 200 on index.html.
  location / {
${addHeaders}
    try_files $uri $uri/index.html =404;
  }

  error_page 404 /404.html;
  location = /404.html {
    internal;
  }
}
`,
    },
    {
      path: 'Dockerfile',
      contents: `FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
EXPOSE 8080
`,
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Reading a config back
// ---------------------------------------------------------------------------------------------

export interface DeployArtifact {
  readonly target: DeployTarget;
  /** Header name (lower-cased) -> value, as the emitted config declares it. */
  readonly declaredHeaders: Readonly<Record<string, string>>;
  /** True when the config routes every unknown path to a 200, which breaks checklist 77. */
  readonly hasSpaFallback: boolean;
  readonly files: readonly string[];
}

/**
 * Parse the emitted config back into a header map. Deliberately a different code path from the
 * renderer — reading back what the renderer just wrote through the renderer's own structures
 * would assert nothing. This catches a hand-edited config and a renderer that dropped a header.
 */
export function parseDeployConfig(
  target: DeployTarget,
  files: Readonly<Record<string, string>>,
): DeployArtifact {
  const declared: Record<string, string> = {};
  let hasSpaFallback = false;

  if (target === 'vercel') {
    const raw = files['vercel.json'];
    if (raw !== undefined) {
      const parsed = JSON.parse(raw) as {
        headers?: { source: string; headers: { key: string; value: string }[] }[];
        rewrites?: { source: string; destination: string }[];
      };
      for (const rule of parsed.headers ?? []) {
        // Only a rule that matches every path counts: a header set on one route is not a
        // site-wide header, and reading it as one would overstate the policy.
        if (!isCatchAll(rule.source)) continue;
        for (const header of rule.headers) declared[header.key.toLowerCase()] = header.value;
      }
      hasSpaFallback = (parsed.rewrites ?? []).some(
        (rule) => isCatchAll(rule.source) && rule.destination.endsWith('index.html'),
      );
    }
  } else if (target === 'netlify') {
    const raw = files['_headers'];
    if (raw !== undefined) {
      let inCatchAll = false;
      for (const line of raw.split('\n')) {
        if (line.trim() === '') continue;
        if (!/^\s/.test(line)) {
          inCatchAll = isCatchAll(line.trim());
          continue;
        }
        if (!inCatchAll) continue;
        const separator = line.indexOf(':');
        if (separator === -1) continue;
        declared[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
      }
    }
    const redirects = files['_redirects'];
    hasSpaFallback = (redirects ?? '').split('\n').some((line) => /index\.html\s+200\b/.test(line));
  } else {
    const raw = files['nginx.conf'];
    for (const line of (raw ?? '').split('\n')) {
      const match = /^\s*add_header\s+([A-Za-z-]+)\s+"([^"]*)"/.exec(line);
      if (match) declared[(match[1] as string).toLowerCase()] = match[2] as string;
    }
    hasSpaFallback = /try_files[^;]*\/index\.html\s*;/.test(raw ?? '');
  }

  return { target, declaredHeaders: declared, hasSpaFallback, files: Object.keys(files).sort() };
}

function isCatchAll(source: string): boolean {
  return ['/*', '/(.*)', '/**'].includes(source.trim());
}

// ---------------------------------------------------------------------------------------------
// Writing and reading a config on disk
// ---------------------------------------------------------------------------------------------

/** The files each target owns. Used to read a config back without guessing at filenames. */
export const DEPLOY_CONFIG_FILES: Readonly<Record<DeployTarget, readonly string[]>> = {
  vercel: ['vercel.json'],
  netlify: ['_headers', '_redirects'],
  northflank: ['nginx.conf', 'Dockerfile'],
};

/** Write the target's config into a build output directory. Returns the paths written. */
export function writeDeployConfig(root: string, input: DeployConfigInput): string[] {
  const files = renderDeployConfig(input);
  for (const file of files) {
    const full = join(root, file.path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, file.contents, 'utf8');
  }
  return files.map((file) => file.path);
}

/**
 * Read a target's config back out of a build output directory. Returns `null` when none of the
 * target's files are present, which is how "no deploy target chosen" reaches the checks as
 * `notApplicable` rather than as a failure.
 */
export function readDeployConfig(root: string, target: DeployTarget): DeployArtifact | null {
  const files: Record<string, string> = {};
  for (const name of DEPLOY_CONFIG_FILES[target]) {
    const full = join(root, name);
    if (existsSync(full)) files[name] = readFileSync(full, 'utf8');
  }
  if (Object.keys(files).length === 0) return null;
  return parseDeployConfig(target, files);
}
