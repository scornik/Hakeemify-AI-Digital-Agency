/**
 * Reading the SiteDefinition at build time.
 *
 * The renderer never invents a route, a section or a slot value: every page it emits comes from
 * the definition, and every value it prints comes from a fact, an asset or a generated slot that
 * already passed the invariant runner. If something is missing here, the right outcome is a
 * build failure, not a placeholder.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface SlotValue {
  kind: 'fact' | 'asset' | 'generated';
  fact_id?: string;
  asset_id?: string;
  text?: string;
  grounded_in?: string[];
}

export interface SectionInstance {
  instance_id: string;
  family: string;
  variant_id: string;
  arrangement_id: string;
  slots: Record<string, SlotValue>;
  computed: { intensity: number; focal_weight: number; density: string; approx_vh: number };
}

export interface PageDefinition {
  route: string;
  archetype: string;
  seo: {
    title: string;
    description: string;
    canonical: string;
    og: { title: string; description: string; image?: string; type?: string };
    robots: { index: boolean; follow: boolean };
    schema_org: { type: string; data: Record<string, unknown> }[];
  };
  order: string[];
  sections: Record<string, SectionInstance>;
}

export interface AssetRef {
  asset_id: string;
  path: string;
  width: number;
  height: number;
  alt?: string;
  grade_id?: string;
}

export interface SiteDefinition {
  schema_version: number;
  site: { id: string; tenant_id: string; niche: string; positioning: string; locale: string };
  pinned: Record<string, string>;
  pages: Record<string, PageDefinition>;
  assets: Record<string, AssetRef>;
  legal: Record<string, string | undefined>;
  seed: number;
}

export interface FactRow {
  id: string;
  value: unknown;
  quotable: boolean;
}

export interface RenderInput {
  definition: SiteDefinition;
  facts: Record<string, FactRow>;
  tokensCss: string;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * The build reads exactly what it was pointed at. No default site, no sample content: a renderer
 * with a fallback fixture is a renderer that can ship one by accident.
 */
export function loadRenderInput(): RenderInput {
  const definitionPath = process.env['ADA_SITE_DEFINITION'];
  const factsPath = process.env['ADA_FACTS'];
  const tokensPath = process.env['ADA_TOKENS_CSS'];

  if (!definitionPath || !factsPath || !tokensPath) {
    throw new Error(
      'ADA_SITE_DEFINITION, ADA_FACTS and ADA_TOKENS_CSS must all be set; the renderer has no ' +
        'default site to fall back to',
    );
  }

  return {
    definition: readJson<SiteDefinition>(resolve(definitionPath)),
    facts: readJson<Record<string, FactRow>>(resolve(factsPath)),
    tokensCss: readFileSync(resolve(tokensPath), 'utf8'),
  };
}

/** `pages.home.sections.s_hero` — the JSON pointer the gate and the editor both address by. */
export function sectionPath(pageId: string, instanceId: string): string {
  return `pages.${pageId}.sections.${instanceId}`;
}

export function slotPath(pageId: string, instanceId: string, slot: string): string {
  return `${sectionPath(pageId, instanceId)}.slots.${slot}`;
}
