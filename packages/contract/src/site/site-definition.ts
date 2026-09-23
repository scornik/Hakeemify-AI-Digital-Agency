/**
 * `SiteDefinition` (ARCHITECTURE §3) — the typed contract shared by the pipeline, the
 * renderer, the gate and (post-V1) the editor.
 *
 * Stored as validated JSONB. `pinned` is what makes retiring a design system safe: a built
 * site records the exact versions it was built from and never auto-migrates (v4 §12).
 */
import { z } from 'zod';
import { ArrangementId, AssetId, InstanceId, LibrarySha, VariantId, VersionedRef } from '../ids.js';
import { PositioningId, Rights } from '../facts/entities.js';
import { SectionInstance } from './section.js';

/** Bumped whenever the shape changes; every stored document carries the version it was written at. */
export const SITE_DEFINITION_SCHEMA_VERSION = 1;

export const PAGE_ARCHETYPES = [
  'transformation',
  'authority',
  'founder_story',
  'comparison',
  'proof_first',
  /** `requires: []` — the mandatory fallback (v4 §7). */
  'service_clarity',
] as const;
export type PageArchetype = (typeof PAGE_ARCHETYPES)[number];
export const PageArchetype = z.enum(PAGE_ARCHETYPES);

export const SchemaOrgBlock = z.object({
  type: z.enum([
    'LocalBusiness',
    'Organization',
    'Service',
    'FAQPage',
    'BreadcrumbList',
    'WebSite',
    'Person',
  ]),
  /** Rendered verbatim into a `<script type="application/ld+json">`. */
  data: z.record(z.string(), z.unknown()),
});
export type SchemaOrgBlock = z.infer<typeof SchemaOrgBlock>;

export const PageSeo = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  canonical: z.string().url(),
  og: z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    image: z.string().min(1).optional(),
    type: z.string().default('website'),
  }),
  robots: z.object({
    index: z.boolean().default(true),
    follow: z.boolean().default(true),
  }),
  schema_org: z.array(SchemaOrgBlock).default([]),
});
export type PageSeo = z.infer<typeof PageSeo>;

export const AssetRef = z.object({
  asset_id: AssetId,
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspect: z.number().positive(),
  alt: z.string().optional(),
  rights: Rights,
  subject_consent: z.boolean(),
  ai_generated: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  /** The art direction grade actually applied. `ungraded_asset` is a blocking tier-1 check. */
  grade_id: z.string().min(1).optional(),
  placeholder_data_uri: z.string().optional(),
});
export type AssetRef = z.infer<typeof AssetRef>;

export const Page = z.object({
  route: z.string().regex(/^\/[a-z0-9\-/]*$/, 'a route must be a lower-kebab absolute path'),
  archetype: PageArchetype,
  seo: PageSeo,
  /** Flat and ordered. Every entry must exist in `sections`, and vice versa. */
  order: z.array(InstanceId),
  sections: z.record(InstanceId, SectionInstance),
});
export type Page = z.infer<typeof Page>;

export const Pinned = z.object({
  design_system: VersionedRef,
  art_direction: VersionedRef,
  playbook: VersionedRef,
  library: LibrarySha,
  gate_policy: VersionedRef.optional(),
});
export type Pinned = z.infer<typeof Pinned>;

export const SiteDefinition = z.object({
  schema_version: z.number().int().nonnegative(),
  site: z.object({
    id: AssetId,
    tenant_id: AssetId,
    niche: z.string().min(1),
    positioning: PositioningId,
    locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  }),
  pinned: Pinned,
  pages: z.record(
    z.string().regex(/^[a-z][a-z0-9_]*$/, 'a page id must be lower_snake_case'),
    Page,
  ),
  assets: z.record(AssetId, AssetRef),
  legal: z.object({
    entity_jurisdiction: z.string().min(1),
    privacy_contact: z.string().min(1),
    /** Page ids, resolved against `pages`, so a missing legal page is a structural error. */
    privacy_page: z.string().optional(),
    terms_page: z.string().optional(),
    cookie_page: z.string().optional(),
  }),
  /** Recorded so a build can be reproduced exactly (ARCHITECTURE §5). */
  seed: z.number().int().nonnegative(),
});

export type SiteDefinition = z.infer<typeof SiteDefinition>;

export { SectionInstance, VariantId, ArrangementId };
