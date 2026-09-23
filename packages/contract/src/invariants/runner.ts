/**
 * Invariant runner (ARCHITECTURE §3).
 *
 * Path-addressed checks over a `SiteDefinition`, accumulating **all** violations rather than
 * stopping at the first. Two reasons: the Gap Report wants the whole list in one pass, and a
 * first-fail runner trains whoever is fixing it to fix one thing at a time.
 *
 * These are the invariants the product is made of. None of them is advisory.
 */
import { requiresSatisfied, type PredicateSnapshot } from '../predicate/evaluate.js';
import { claimSupported, extractClaims, factText } from './claims.js';
import type { FlatFact } from '../facts/registry.js';

export const INVARIANT_CODES = [
  'ungrounded_claim',
  'unquotable_fact_cited',
  'missing_fact',
  'asset_rights_unknown',
  'portrait_without_consent',
  'ai_generated_person',
  'requires_not_satisfied',
  'multiple_art_directions',
  'cross_tenant_reference',
  'order_section_mismatch',
  'missing_asset',
  'empty_page',
] as const;
export type InvariantCode = (typeof INVARIANT_CODES)[number];

export interface InvariantViolation {
  readonly code: InvariantCode;
  /** JSON pointer-ish path into the SiteDefinition, so a fix has an address. */
  readonly path: string;
  readonly message: string;
  /** What was found, for the manifest and the gap report. */
  readonly actual?: unknown;
}

export interface InvariantContext {
  /** Flattened registry facts, keyed by fact id. */
  readonly facts: ReadonlyMap<string, FlatFact>;
  /** The predicate snapshot this build was decided from. */
  readonly snapshot: PredicateSnapshot;
  /** `variant_id` -> the `requires` predicates it declares. */
  readonly variantRequires: ReadonlyMap<string, readonly string[]>;
  /** The tenant that owns this site; every referenced id must belong to it. */
  readonly tenantId: string;
}

interface SectionLike {
  family: string;
  instance_id: string;
  variant_id: string;
  slots: Record<string, unknown>;
}

interface SiteLike {
  site?: { tenant_id?: unknown; id?: unknown };
  pinned?: { art_direction?: unknown };
  pages?: Record<string, { order?: unknown; sections?: Record<string, unknown> }>;
  assets?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Run every invariant. Accepts an unvalidated document on purpose: this runs after Zod on the
 * happy path, but also on repaired documents mid-loop, where shape may have drifted.
 */
export function runInvariants(
  definition: unknown,
  context: InvariantContext,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  if (!isRecord(definition)) {
    return [
      {
        code: 'order_section_mismatch',
        path: '',
        message: 'the site definition is not an object',
        actual: typeof definition,
      },
    ];
  }

  const site = definition as SiteLike;
  checkTenancy(site, context, violations);
  checkArtDirectionSingleton(site, violations);

  const assets = isRecord(site.assets) ? site.assets : {};
  checkAssets(assets, violations);

  const pages = isRecord(site.pages) ? site.pages : {};
  for (const [pageId, page] of Object.entries(pages)) {
    if (!isRecord(page)) continue;
    const basePath = `pages.${pageId}`;
    const sections = isRecord(page.sections) ? page.sections : {};
    const order = Array.isArray(page.order) ? page.order.map(String) : [];

    checkOrder(order, sections, basePath, violations);

    for (const [instanceId, raw] of Object.entries(sections)) {
      if (!isRecord(raw)) continue;
      const section = raw as unknown as SectionLike;
      const sectionPath = `${basePath}.sections.${instanceId}`;
      checkRequires(section, sectionPath, context, violations);
      checkSlots(section, sectionPath, assets, context, violations);
    }
  }

  return violations;
}

function checkTenancy(site: SiteLike, context: InvariantContext, out: InvariantViolation[]): void {
  const tenant = site.site?.tenant_id;
  if (tenant !== undefined && tenant !== context.tenantId) {
    out.push({
      code: 'cross_tenant_reference',
      path: 'site.tenant_id',
      message: `site belongs to tenant ${String(tenant)}, which is not ${context.tenantId}`,
      actual: tenant,
    });
  }
}

/** v4 §15: `single_art_direction_per_site`. */
function checkArtDirectionSingleton(site: SiteLike, out: InvariantViolation[]): void {
  const pinned = site.pinned?.art_direction;
  if (pinned === undefined) {
    out.push({
      code: 'multiple_art_directions',
      path: 'pinned.art_direction',
      message: 'no art direction is pinned; exactly one is required per site',
    });
    return;
  }
  if (Array.isArray(pinned)) {
    out.push({
      code: 'multiple_art_directions',
      path: 'pinned.art_direction',
      message: 'exactly one art direction is allowed per site',
      actual: pinned,
    });
  }
}

function checkAssets(assets: Record<string, unknown>, out: InvariantViolation[]): void {
  for (const [assetId, raw] of Object.entries(assets)) {
    if (!isRecord(raw)) continue;
    const path = `assets.${assetId}`;

    if (raw['rights'] === 'unknown' || raw['rights'] === undefined) {
      out.push({
        code: 'asset_rights_unknown',
        path: `${path}.rights`,
        message: `asset ${assetId} has unknown rights and is ineligible everywhere`,
        actual: raw['rights'] ?? null,
      });
    }

    const tags = Array.isArray(raw['tags']) ? raw['tags'].map(String) : [];
    const depictsPerson = tags.includes('person') || tags.includes('portrait');

    if (depictsPerson && raw['subject_consent'] !== true) {
      out.push({
        code: 'portrait_without_consent',
        path: `${path}.subject_consent`,
        message: `asset ${assetId} depicts a person without recorded consent`,
        actual: raw['subject_consent'] ?? null,
      });
    }

    // Non-overridable (v4 §4): `never: ai_generated_person`.
    if (depictsPerson && raw['ai_generated'] === true) {
      out.push({
        code: 'ai_generated_person',
        path: `${path}.ai_generated`,
        message: `asset ${assetId} is a generated image depicting a person, which is never allowed`,
        actual: true,
      });
    }
  }
}

function checkOrder(
  order: readonly string[],
  sections: Record<string, unknown>,
  basePath: string,
  out: InvariantViolation[],
): void {
  const sectionIds = new Set(Object.keys(sections));

  if (order.length === 0) {
    out.push({
      code: 'empty_page',
      path: `${basePath}.order`,
      message: 'a page must order at least one section',
    });
  }

  const seen = new Set<string>();
  order.forEach((id, index) => {
    if (!sectionIds.has(id)) {
      out.push({
        code: 'order_section_mismatch',
        path: `${basePath}.order[${index}]`,
        message: `order references "${id}", which is not in sections`,
        actual: id,
      });
    }
    if (seen.has(id)) {
      out.push({
        code: 'order_section_mismatch',
        path: `${basePath}.order[${index}]`,
        message: `order lists "${id}" more than once`,
        actual: id,
      });
    }
    seen.add(id);
  });

  for (const id of sectionIds) {
    if (!seen.has(id)) {
      out.push({
        code: 'order_section_mismatch',
        path: `${basePath}.sections.${id}`,
        message: `section "${id}" is never ordered and would not render`,
        actual: id,
      });
    }
  }
}

/** The invariant that carries the grounding guarantee: `requires` is never relaxed. */
function checkRequires(
  section: SectionLike,
  path: string,
  context: InvariantContext,
  out: InvariantViolation[],
): void {
  const requires = context.variantRequires.get(section.variant_id);
  if (requires === undefined || requires.length === 0) return;
  if (requiresSatisfied(context.snapshot, requires)) return;

  const unmet = requires.filter(
    (predicate) => context.snapshot.find((row) => row.predicate === predicate)?.result !== true,
  );
  out.push({
    code: 'requires_not_satisfied',
    path: `${path}.variant_id`,
    message: `variant ${section.variant_id} was placed but its requires are unmet: ${unmet.join('; ')}`,
    actual: unmet,
  });
}

function checkSlots(
  section: SectionLike,
  sectionPath: string,
  assets: Record<string, unknown>,
  context: InvariantContext,
  out: InvariantViolation[],
): void {
  const slots = isRecord(section.slots) ? section.slots : {};

  for (const [slotName, raw] of Object.entries(slots)) {
    if (!isRecord(raw)) continue;
    const path = `${sectionPath}.slots.${slotName}`;
    const kind = raw['kind'];

    if (kind === 'fact') {
      const factId = String(raw['fact_id'] ?? '');
      const found = context.facts.get(factId);
      if (!found) {
        out.push({
          code: 'missing_fact',
          path: `${path}.fact_id`,
          message: `slot cites fact "${factId}", which is not in the registry`,
          actual: factId,
        });
      }
      continue;
    }

    if (kind === 'asset') {
      const assetId = String(raw['asset_id'] ?? '');
      if (!(assetId in assets)) {
        out.push({
          code: 'missing_asset',
          path: `${path}.asset_id`,
          message: `slot cites asset "${assetId}", which is not in the definition`,
          actual: assetId,
        });
      }
      continue;
    }

    if (kind === 'generated') {
      checkGeneratedSlot(raw, path, context, out);
    }
  }
}

function checkGeneratedSlot(
  slot: Record<string, unknown>,
  path: string,
  context: InvariantContext,
  out: InvariantViolation[],
): void {
  const text = typeof slot['text'] === 'string' ? slot['text'] : '';
  const groundedIn = Array.isArray(slot['grounded_in']) ? slot['grounded_in'].map(String) : [];

  const supporting: string[] = [];
  for (const factId of groundedIn) {
    const found = context.facts.get(factId);
    if (!found) {
      out.push({
        code: 'missing_fact',
        path: `${path}.grounded_in`,
        message: `generated copy cites fact "${factId}", which is not in the registry`,
        actual: factId,
      });
      continue;
    }
    if (!found.quotable) {
      // A non-quotable fact may inform layout. It may never appear as a claim in copy.
      out.push({
        code: 'unquotable_fact_cited',
        path: `${path}.grounded_in`,
        message: `generated copy cites "${factId}", which is quotable: false`,
        actual: factId,
      });
      continue;
    }
    supporting.push(factText(found.value));
  }

  const supportingText = supporting.join('   ');
  for (const claim of extractClaims(text)) {
    if (claimSupported(claim, supportingText)) continue;
    out.push({
      code: 'ungrounded_claim',
      path,
      message: `generated copy asserts the ${claim.kind} "${claim.text}", which no cited quotable fact contains`,
      actual: claim.text,
    });
  }
}

/** Group violations by code, for a report that reads as a list of problems not a list of rows. */
export function groupViolations(
  violations: readonly InvariantViolation[],
): Record<string, InvariantViolation[]> {
  const out: Record<string, InvariantViolation[]> = {};
  for (const violation of violations) {
    (out[violation.code] ??= []).push(violation);
  }
  return out;
}
