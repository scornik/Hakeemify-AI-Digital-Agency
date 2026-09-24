import { describe, expect, it } from 'vitest';

import {
  DEPLOY_TARGETS,
  buildContentSecurityPolicy,
  parseDeployConfig,
  renderDeployConfig,
  securityHeaders,
  type DeployTarget,
  type HeaderPolicyInput,
} from '../src/deploy.js';
import { cspMatchesBuild, noSpaFallback, securityHeadersDeclared } from '../src/checks/deploy.js';
import { STATIC_CHECKS } from '../src/checks/index.js';
import { cleanContext } from './fixtures/context.js';
import type { ArtifactBundle } from '../src/types.js';

const zeroJs: HeaderPolicyInput = { allowedHosts: [], shipsJavaScript: false };

/** Render for a target and read the result straight back, as the gate does. */
function roundTrip(target: DeployTarget, input: HeaderPolicyInput = zeroJs) {
  const files = Object.fromEntries(
    renderDeployConfig({ target, ...input }).map((file) => [file.path, file.contents]),
  );
  return { files, artifact: parseDeployConfig(target, files) };
}

describe('the Content-Security-Policy', () => {
  it('forbids scripts outright when the build ships none', () => {
    // The strongest claim a zero-JS build has earned, and the one a templated policy throws away.
    expect(buildContentSecurityPolicy(zeroJs)).toContain("script-src 'none'");
  });

  it('falls back to self only when the build actually ships JavaScript', () => {
    const policy = buildContentSecurityPolicy({ allowedHosts: [], shipsJavaScript: true });
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toContain("script-src 'none'");
  });

  it('admits the allowlisted hosts to style and font, and nothing else', () => {
    const policy = buildContentSecurityPolicy({
      allowedHosts: ['https://fonts.gstatic.com'],
      shipsJavaScript: false,
    });
    expect(policy).toContain('font-src');
    expect(policy).toContain('https://fonts.gstatic.com');
    // An allowlisted font host is not an allowlisted script host.
    expect(policy).toContain("script-src 'none'");
  });

  it('is stable for the same input, because the config it lands in is committed', () => {
    const hosts = ['https://b.example', 'https://a.example'];
    expect(buildContentSecurityPolicy({ allowedHosts: hosts, shipsJavaScript: false })).toBe(
      buildContentSecurityPolicy({
        allowedHosts: [...hosts].reverse(),
        shipsJavaScript: false,
      }),
    );
  });

  it('denies framing, which is the half of clickjacking CSP owns', () => {
    expect(buildContentSecurityPolicy(zeroJs)).toContain("frame-ancestors 'none'");
  });
});

describe.each(DEPLOY_TARGETS)('the %s adapter', (target) => {
  it('declares every header in the policy, read back by a different code path', () => {
    const { artifact } = roundTrip(target);
    for (const header of securityHeaders(zeroJs)) {
      expect(artifact.declaredHeaders[header.name.toLowerCase()], header.name).toBe(header.value);
    }
  });

  it('does not route unknown paths to a soft 200', () => {
    // Checklist 77. A catch-all rewrite to index.html indexes every typo as the home page.
    expect(roundTrip(target).artifact.hasSpaFallback).toBe(false);
  });

  it('emits at least one file, at a path relative to the build root', () => {
    const files = renderDeployConfig({ target, ...zeroJs });
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.path.startsWith('/'), file.path).toBe(false);
      expect(file.contents.endsWith('\n'), file.path).toBe(true);
    }
  });
});

describe('reading a config back', () => {
  it('ignores a header set on one route rather than site-wide', () => {
    // A header on /blog is not a site-wide header, and reading it as one overstates the policy.
    const artifact = parseDeployConfig('vercel', {
      'vercel.json': JSON.stringify({
        headers: [{ source: '/blog', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }],
      }),
    });
    expect(artifact.declaredHeaders['x-frame-options']).toBeUndefined();
  });

  it('spots a Vercel SPA rewrite', () => {
    const artifact = parseDeployConfig('vercel', {
      'vercel.json': JSON.stringify({
        rewrites: [{ source: '/(.*)', destination: '/index.html' }],
      }),
    });
    expect(artifact.hasSpaFallback).toBe(true);
  });

  it('spots a Netlify SPA redirect', () => {
    const artifact = parseDeployConfig('netlify', { _redirects: '/*  /index.html  200\n' });
    expect(artifact.hasSpaFallback).toBe(true);
  });

  it('spots an nginx try_files fallback to index.html', () => {
    const artifact = parseDeployConfig('northflank', {
      'nginx.conf': 'location / { try_files $uri /index.html; }',
    });
    expect(artifact.hasSpaFallback).toBe(true);
  });

  it('returns an empty policy rather than throwing when the config is absent', () => {
    // "No target chosen yet" must reach the checks as notApplicable, not as a crash.
    expect(parseDeployConfig('netlify', {}).declaredHeaders).toEqual({});
  });
});

describe('the deploy checks', () => {
  const bundle = (overrides: Partial<ArtifactBundle> = {}): ArtifactBundle =>
    ({
      project: 'static',
      build: { routes: ['/'], jsBytesByRoute: { '/': 0 }, allowedHosts: [], buildYear: 2026 },
      dom: { route: '/' },
      ...overrides,
    }) as unknown as ArtifactBundle;

  it('passes on a freshly rendered config', () => {
    // Rendered with the site's own allowlist. Rendering with `[]` here produced a CSP that did
    // not name the font hosts the site loads from, and the check failed — correctly.
    const { artifact } = roundTrip('vercel', {
      allowedHosts: cleanContext.allowedHosts,
      shipsJavaScript: false,
    });
    expect(securityHeadersDeclared.audit(bundle({ deploy: artifact }), cleanContext)).toMatchObject(
      { passed: true },
    );
    expect(cspMatchesBuild.audit(bundle({ deploy: artifact }), cleanContext)).toMatchObject({
      passed: true,
    });
    expect(noSpaFallback.audit(bundle({ deploy: artifact }), cleanContext)).toMatchObject({
      passed: true,
    });
  });

  it('fails when a header was edited out by hand', () => {
    const { files } = roundTrip('netlify');
    const stripped = {
      ...files,
      _headers: (files['_headers'] as string)
        .split('\n')
        .filter((line) => !line.includes('Strict-Transport-Security'))
        .join('\n'),
    };
    const outcome = securityHeadersDeclared.audit(
      bundle({ deploy: parseDeployConfig('netlify', stripped) }),
      cleanContext,
    );
    expect(outcome.passed).toBe(false);
    expect(JSON.stringify(outcome.items)).toContain('Strict-Transport-Security');
  });

  it('fails when a zero-JS build ships a policy that still allows scripts', () => {
    const { files } = roundTrip('netlify', { allowedHosts: [], shipsJavaScript: true });
    const outcome = cspMatchesBuild.audit(
      bundle({ deploy: parseDeployConfig('netlify', files) }),
      cleanContext,
    );
    expect(outcome.passed).toBe(false);
    expect(JSON.stringify(outcome.items)).toContain('ships no JavaScript');
  });

  it('is notApplicable without a deploy target, because that is not insecure', () => {
    // A build with no host chosen has not failed to declare headers; there is nowhere to
    // declare them yet. Reporting that as a failure would train people to ignore the row.
    for (const check of [securityHeadersDeclared, cspMatchesBuild, noSpaFallback]) {
      expect(check.audit(bundle(), cleanContext).mode, check.id).toBe('notApplicable');
    }
  });

  it('runs in the static pass, because a config file needs no browser', () => {
    const ids = STATIC_CHECKS.map((check) => check.id);
    expect(ids).toContain('deploy.security-headers-declared');
    expect(ids).toContain('deploy.no-spa-fallback');
  });

  it('does not claim to be the served-header check', () => {
    // The distinction the whole module rests on: declaring HSTS in vercel.json is not an origin
    // sending it. If these ids ever stop saying so, the prod-only rows look redundant and get
    // deleted.
    expect(securityHeadersDeclared.id).toContain('declared');
    expect(securityHeadersDeclared.title).toMatch(/declares/);
  });
});
