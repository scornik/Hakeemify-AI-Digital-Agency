/**
 * Fact Registry entities (v4 §1).
 *
 * One decision worth stating: v4 declares `attributable` as a TypeScript getter on
 * `Testimonial`. A getter cannot survive JSONB, and the predicate evaluator is deliberately
 * generic — it knows about paths, not about testimonials. So **derived fields are materialised
 * by the schema at parse time**. `attributable` becomes a real boolean on the parsed object,
 * computed from `author_name` and `consented`, and the evaluator stays a plain data walker.
 *
 * Derived fields are always recomputed on parse, never trusted from input, so a stored
 * registry cannot carry a stale or forged `attributable`.
 */
import { z } from 'zod';

export const Verification = z.enum(['self_reported', 'documented', 'third_party']);
export type Verification = z.infer<typeof Verification>;

export const Rights = z.enum(['owned', 'licensed', 'unknown']);
export type Rights = z.infer<typeof Rights>;

export const Provenance = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('intake'), field: z.string().min(1) }),
  z.object({ kind: z.literal('upload'), file: z.string().min(1), checked: z.boolean() }),
  z.object({
    kind: z.literal('external'),
    source: z.enum(['gbp', 'registry', 'site']),
    url: z.string().url(),
    fetched_at: z.iso.datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal('derived'),
    from: z.array(z.string().min(1)).min(1),
    rule: z.string().min(1),
  }),
]);
export type Provenance = z.infer<typeof Provenance>;

/**
 * `Fact<T>`. `quotable: false` means the value may inform a layout decision but must never
 * appear as a claim in copy — the invariant runner enforces that, not a prompt.
 */
export function fact<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    id: z.string().min(1),
    value,
    provenance: Provenance,
    quotable: z.boolean(),
    verification: Verification,
  });
}

export type Fact<T> = {
  id: string;
  value: T;
  provenance: Provenance;
  quotable: boolean;
  verification: Verification;
};

export const ImageAsset = z.object({
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Read by arrangement `asset_constraints` (v4 §8). Recomputed, never trusted from input. */
  aspect: z.number().positive().optional(),
  alt: z.string().optional(),
  /** `unknown` is ineligible everywhere. */
  rights: Rights,
  subject_consent: z.boolean().default(false),
  /** Ingest-time classifier output; feeds the anti-slop photo checks. */
  tags: z.array(z.string()).default([]),
  /** Survives LUT application without clipping. */
  grade_safe: z.boolean().default(false),
  /** True when the asset was produced by a generative model. Never eligible for a person. */
  ai_generated: z.boolean().default(false),
});

export const ImageAssetWithDerived = ImageAsset.transform((asset) => ({
  ...asset,
  aspect: asset.width / asset.height,
}));
export type ImageAsset = z.infer<typeof ImageAssetWithDerived>;

export const VideoAsset = z.object({
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_s: z.number().positive(),
  poster: ImageAssetWithDerived.optional(),
  rights: Rights,
  has_audio: z.boolean().default(false),
  captions_path: z.string().optional(),
});
export type VideoAsset = z.infer<typeof VideoAsset>;

export const Testimonial = z
  .object({
    quote: z.string().min(1),
    author_name: z.string().min(1).optional(),
    author_role: z.string().min(1).optional(),
    portrait: ImageAssetWithDerived.optional(),
    consented: z.boolean(),
    verification: Verification,
  })
  .transform((t) => ({
    ...t,
    /** v4 §1: `author_name && consented`. Derived here so predicates see plain data. */
    attributable: Boolean(t.author_name) && t.consented,
  }));
export type Testimonial = z.infer<typeof Testimonial>;

export const Metric = z.object({
  label: z.string().min(1),
  value: z.number(),
  unit: z.string().optional(),
  as_of: z.iso.date().optional(),
  source: z.string().optional(),
  verification: Verification,
});
export type Metric = z.infer<typeof Metric>;

export const GeoArea = z.object({
  name: z.string().min(1),
  kind: z.enum(['city', 'region', 'postcode', 'radius']).default('city'),
  radius_km: z.number().positive().optional(),
});
export type GeoArea = z.infer<typeof GeoArea>;

export const Project = z
  .object({
    title: z.string().min(1),
    summary: z.string().optional(),
    before_photo: ImageAssetWithDerived.optional(),
    after_photo: ImageAssetWithDerived.optional(),
    outcome_metric: Metric.optional(),
    location: GeoArea.optional(),
    client_named: z.boolean().default(false),
    completed_at: z.iso.date().optional(),
  })
  .transform((p) => ({
    ...p,
    /** The pairing the `transformation` archetype gates on. */
    has_before_after: Boolean(p.before_photo) && Boolean(p.after_photo),
  }));
export type Project = z.infer<typeof Project>;

export const Person = z
  .object({
    name: z.string().min(1),
    role: z.string().min(1),
    /** Real photo only. An `ai_generated` portrait is rejected by the invariant runner. */
    portrait: ImageAssetWithDerived.optional(),
    bio: z.string().optional(),
    is_founder: z.boolean().default(false),
  })
  .transform((p) => ({
    ...p,
    has_portrait: Boolean(p.portrait),
    bio_length: p.bio?.length ?? 0,
  }));
export type Person = z.infer<typeof Person>;

export const Service = z.object({
  name: z.string().min(1),
  summary: z.string().optional(),
  price_from: z.number().nonnegative().optional(),
  price_currency: z.string().length(3).optional(),
  is_primary: z.boolean().default(false),
});
export type Service = z.infer<typeof Service>;

export const Credential = z.object({
  name: z.string().min(1),
  issuer: z.string().min(1),
  identifier: z.string().optional(),
  issued_at: z.iso.date().optional(),
  expires_at: z.iso.date().optional(),
  verification: Verification,
});
export type Credential = z.infer<typeof Credential>;

export const Client = z.object({
  name: z.string().min(1),
  logo: ImageAssetWithDerived.optional(),
  consented: z.boolean().default(false),
});
export type Client = z.infer<typeof Client>;

export const Guarantee = z.object({
  label: z.string().min(1),
  terms: z.string().min(1),
  duration_months: z.number().int().positive().optional(),
});
export type Guarantee = z.infer<typeof Guarantee>;

export const PostalAddress = z.object({
  street: z.string().min(1),
  locality: z.string().min(1),
  region: z.string().optional(),
  postal_code: z.string().min(1),
  country: z.string().length(2),
});
export type PostalAddress = z.infer<typeof PostalAddress>;

export const OpeningHours = z.object({
  days: z.array(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])).min(1),
  opens: z.string().regex(/^\d{2}:\d{2}$/),
  closes: z.string().regex(/^\d{2}:\d{2}$/),
});
export type OpeningHours = z.infer<typeof OpeningHours>;

export const CookieCategory = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  essential: z.boolean(),
  purpose: z.string().min(1),
});
export type CookieCategory = z.infer<typeof CookieCategory>;

export const BusinessType = z.enum(['local_service', 'ecommerce', 'saas', 'practice', 'studio']);
export type BusinessType = z.infer<typeof BusinessType>;

/** v4 §6. Declared by the owner in intake, never inferred. */
export const PositioningId = z.enum([
  'local_trust',
  'volume_value',
  'premium',
  'luxury',
  'challenger',
  'specialist',
  'leader',
]);
export type PositioningId = z.infer<typeof PositioningId>;
