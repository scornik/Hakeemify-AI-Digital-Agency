/**
 * Deploy-configuration checks — gate-checklist rows 77, 79, 80.
 *
 * **What these assert, precisely.** That the config the build emitted *declares* the header
 * policy. Not that an origin serves it. Lighthouse's `is-on-https`, `has-hsts` and `csp-xss`
 * answer the second question and need a deployed origin; they stay `notApplicable` on a local
 * build and these checks do not stand in for them. The ids say `-declared` for that reason: a
 * gate that reports "HSTS present" on a site that never sends it is worse than one that reports
 * nothing, because it is believed.
 *
 * What they do catch is the whole class of "somebody hand-edited `vercel.json`", "the renderer
 * dropped a header", and "the CSP no longer matches what the build ships" — all of which are
 * deterministic at build time and none of which any other check sees.
 */
import { defineCheck, type Check } from '../context.js';
import { buildContentSecurityPolicy, securityHeaders } from '../deploy.js';
import type { CheckEvidence } from '../types.js';

export const securityHeadersDeclared: Check = defineCheck({
  id: 'deploy.security-headers-declared',
  title: 'The host config declares every header in the security policy',
  failureTitle: 'The deploy config is missing or contradicts a required security header',
  description:
    'One policy, three hosts that spell it differently. The config is parsed back with a ' +
    'different code path from the one that wrote it, so a hand edit is caught.',
  severity: 'serious',
  requiredArtifacts: ['deploy', 'build'],
  checklistRows: [79, 80],
  audit: (bundle, context) => {
    const deploy = bundle.deploy;
    if (!deploy) return { mode: 'notApplicable', passed: false };

    const shipsJavaScript = Object.values(bundle.build.jsBytesByRoute).some((bytes) => bytes > 0);
    const expected = securityHeaders({
      allowedHosts: context.allowedHosts,
      shipsJavaScript,
    });

    const problems: CheckEvidence[] = [];
    for (const header of expected) {
      const actual = deploy.declaredHeaders[header.name.toLowerCase()];
      if (actual === undefined) {
        problems.push({ detail: `${header.name} is not declared`, snippet: header.reason });
      } else if (actual !== header.value) {
        problems.push({
          detail: `${header.name} does not match the policy`,
          actual,
          expected: header.value,
        });
      }
    }

    return {
      passed: problems.length === 0,
      items: problems,
      message: `${expected.length - problems.length}/${expected.length} declared on ${deploy.target}`,
    };
  },
});

export const cspMatchesBuild: Check = defineCheck({
  id: 'deploy.csp-matches-build',
  title: 'The Content-Security-Policy is the one this build can afford',
  failureTitle: 'The declared CSP is weaker than the build allows',
  description:
    'A site that ships zero JavaScript can say `script-src none`. Templated policies say ' +
    '`self` regardless, which throws away the strongest claim the build has earned.',
  severity: 'moderate',
  requiredArtifacts: ['deploy', 'build'],
  checklistRows: [80],
  audit: (bundle, context) => {
    const deploy = bundle.deploy;
    if (!deploy) return { mode: 'notApplicable', passed: false };

    const declared = deploy.declaredHeaders['content-security-policy'];
    if (declared === undefined) return { mode: 'notApplicable', passed: false };

    const shipsJavaScript = Object.values(bundle.build.jsBytesByRoute).some((bytes) => bytes > 0);
    const expected = buildContentSecurityPolicy({
      allowedHosts: context.allowedHosts,
      shipsJavaScript,
    });

    if (declared === expected) return { passed: true };

    return {
      passed: false,
      items: [
        {
          detail: shipsJavaScript
            ? 'the declared policy does not match the build'
            : 'this build ships no JavaScript, so the policy should forbid scripts outright',
          actual: declared,
          expected,
        },
      ],
    };
  },
});

export const noSpaFallback: Check = defineCheck({
  id: 'deploy.no-spa-fallback',
  title: 'An unknown path returns 404, not a soft 200',
  failureTitle: 'The deploy config rewrites every unknown path to index.html',
  description:
    'A catch-all rewrite to index.html turns every typo and every dead inbound link into a ' +
    '200 that search engines index as a duplicate of the home page. This is a static site; ' +
    'it has no client router to justify the rule.',
  severity: 'serious',
  requiredArtifacts: ['deploy'],
  checklistRows: [77],
  audit: (bundle) => {
    const deploy = bundle.deploy;
    if (!deploy) return { mode: 'notApplicable', passed: false };
    return {
      passed: !deploy.hasSpaFallback,
      items: deploy.hasSpaFallback
        ? [{ detail: `${deploy.target} config routes unknown paths to a 200` }]
        : [],
    };
  },
});

export const DEPLOY_CHECKS: readonly Check[] = [
  securityHeadersDeclared,
  cspMatchesBuild,
  noSpaFallback,
];
