/**
 * Strict id grammar. Authored assets are loaded and validated at boot (ARCHITECTURE §2), and a
 * typo in an id is otherwise indistinguishable from an asset that is simply ineligible — the
 * build would quietly fall back instead of failing.
 */
import { z } from 'zod';

/** `editorial_v3`, `quiet_authority`, `service_clarity`, `local_trust`, `roofing`. */
export const ASSET_ID = /^[a-z][a-z0-9_]*$/;

/** `hero/founder_editorial` — family-scoped so two families may reuse a variant name. */
export const VARIANT_ID = /^[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/;

/** `portrait-left`, `full-bleed-overlap` — v4 §8 writes arrangement ids with hyphens. */
export const ARRANGEMENT_ID = /^[a-z][a-z0-9-]*$/;

/** `s_hero_01` — stable per section instance, referenced by the DOM, telemetry and the gate. */
export const INSTANCE_ID = /^[a-z][a-z0-9_]*$/;

/** `editorial_v3@3.1`, `roofing@4`, `quiet_authority@2`. */
export const VERSIONED_REF = /^[a-z][a-z0-9_]*@[0-9]+(\.[0-9]+)?$/;

/** A git commit sha, short or full, pinning the section library. */
export const LIBRARY_SHA = /^[0-9a-f]{7,40}$/;

export const assetId = (label: string) =>
  z.string().regex(ASSET_ID, `${label} must match ${ASSET_ID.source}`);

export const AssetId = assetId('an id');
export const VariantId = z.string().regex(VARIANT_ID, 'a variant id must be `family/variant`');
export const ArrangementId = z
  .string()
  .regex(ARRANGEMENT_ID, 'an arrangement id must be lower-kebab-case');
export const InstanceId = z.string().regex(INSTANCE_ID, 'an instance id must be lower_snake_case');
export const VersionedRef = z.string().regex(VERSIONED_REF, 'a pinned ref must be `id@version`');
export const LibrarySha = z.string().regex(LIBRARY_SHA, 'a library pin must be a git sha');

export type AssetId = z.infer<typeof AssetId>;
export type VariantId = z.infer<typeof VariantId>;
export type ArrangementId = z.infer<typeof ArrangementId>;
export type InstanceId = z.infer<typeof InstanceId>;
export type VersionedRef = z.infer<typeof VersionedRef>;

/** Split `editorial_v3@3.1` into its parts. Returns null when the ref is malformed. */
export function parseVersionedRef(ref: string): { id: string; version: string } | null {
  if (!VERSIONED_REF.test(ref)) return null;
  const at = ref.lastIndexOf('@');
  return { id: ref.slice(0, at), version: ref.slice(at + 1) };
}

/** The family half of a variant id. Returns null when the id is malformed. */
export function variantFamily(variantId: string): string | null {
  if (!VARIANT_ID.test(variantId)) return null;
  return variantId.slice(0, variantId.indexOf('/'));
}
