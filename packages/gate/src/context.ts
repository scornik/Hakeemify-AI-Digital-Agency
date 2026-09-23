/**
 * What the checks need to know about the site beyond the page in front of them.
 *
 * The gate never re-derives this from the rendered HTML. Its whole value is comparing what
 * shipped against what the `SiteDefinition` and the `FactRegistry` said should ship, so the
 * expected values come from the contract and the found values come from the artifact.
 */
import type { GateCheck } from './types.js';

export interface ExpectedSection {
  readonly sdId: string;
  readonly sdPath: string;
  readonly variantId: string;
  readonly arrangementId: string;
  readonly family: string;
}

export interface ExpectedPage {
  readonly route: string;
  readonly archetype: string;
  readonly title: string;
  readonly description: string;
  readonly canonical: string;
  readonly indexable: boolean;
  readonly sections: readonly ExpectedSection[];
  /** Beats the archetype requires; used for the section-count bounds. */
  readonly minSections: number;
  readonly maxSections: number;
  /** The section id whose media or heading should be the LCP element. */
  readonly lcpSdId: string | null;
}

export interface QuotableFact {
  readonly id: string;
  readonly path: string;
  readonly text: string;
}

export interface GateContext {
  readonly origin: string;
  readonly pages: readonly ExpectedPage[];
  /** Every quotable fact rendered to text, for `content.facts-provenance`. */
  readonly quotableFacts: readonly QuotableFact[];
  readonly businessName: string;
  readonly contact: {
    readonly phone?: string;
    readonly email?: string;
    readonly addressLines?: readonly string[];
  };
  /** The one art direction pinned for this site; every photographic asset must carry it. */
  readonly artDirectionGradeId: string;
  /** Per-page JS ceiling in bytes. 180 kB (ARCHITECTURE §7). */
  readonly jsBudgetBytes: number;
  /** Hosts any subresource may come from. Anything else is a hard failure. */
  readonly allowedHosts: readonly string[];
  /** Page ids that must exist and be linked in the footer. */
  readonly legalRoutes: readonly string[];
  readonly buildYear: number;
  /** Set when the site ships analytics or a third party behind consent. */
  readonly consentRequired: boolean;
}

export type Check = GateCheck<GateContext>;

/** Small helper so each check reads as its rule rather than as a literal object. */
export function defineCheck(check: Check): Check {
  return check;
}

export function pageFor(context: GateContext, route: string): ExpectedPage | undefined {
  return context.pages.find((page) => page.route === route);
}

/** Normalise a route for comparison: trailing slash and index.html are the same page. */
export function normaliseRoute(route: string): string {
  const withoutIndex = route.replace(/\/index\.html$/, '/');
  if (withoutIndex === '') return '/';
  return withoutIndex.length > 1 && withoutIndex.endsWith('/')
    ? withoutIndex.slice(0, -1)
    : withoutIndex;
}

export function hostOf(url: string, origin: string): string | null {
  try {
    return new URL(url, origin).host;
  } catch {
    return null;
  }
}
