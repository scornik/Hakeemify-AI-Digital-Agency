/**
 * The Fact Registry (v4 §1): every value the system is allowed to put on a page.
 *
 * Nothing renders that is not traceable to an entry here. The registry is the only input to
 * the predicate evaluator, so its shape is also the vocabulary every predicate is written
 * against.
 */
import { z } from 'zod';
import {
  BusinessType,
  Client,
  CookieCategory,
  Credential,
  fact,
  Guarantee,
  ImageAssetWithDerived,
  Metric,
  GeoArea,
  OpeningHours,
  Person,
  PositioningId,
  PostalAddress,
  Project,
  Service,
  Testimonial,
  VideoAsset,
} from './entities.js';

export const FactRegistry = z.object({
  business: z.object({
    legal_name: fact(z.string().min(1)),
    trading_name: fact(z.string().min(1)).optional(),
    type: fact(BusinessType),
    /** Keys into the niche playbook. */
    niche: fact(z.string().min(1)),
    /** Owner-declared (v4 §6). The pipeline interrupts rather than guessing. */
    positioning: fact(PositioningId),
    founded_year: fact(z.number().int().min(1000).max(2200)).optional(),
    story: fact(z.string()).optional(),
    problem_statement: fact(z.string()).optional(),
    differentiators: fact(z.array(z.string())).optional(),
    guarantees: fact(z.array(Guarantee)).optional(),
    response_time_promise: fact(z.string()).optional(),
  }),

  services: fact(z.array(Service)),
  people: fact(z.array(Person)),

  proof: z.object({
    testimonials: fact(z.array(Testimonial)),
    projects: fact(z.array(Project)),
    metrics: fact(z.array(Metric)),
    credentials: fact(z.array(Credential)),
    clients: fact(z.array(Client)),
  }),

  media: z.object({
    logo: fact(ImageAssetWithDerived).optional(),
    brand_colors: fact(z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/))).optional(),
    photos: fact(z.array(ImageAssetWithDerived)),
    video: fact(z.array(VideoAsset)).optional(),
  }),

  contact: z.object({
    phone: fact(z.string().min(1)).optional(),
    email: fact(z.string().email()),
    address: fact(PostalAddress).optional(),
    service_area: fact(z.array(GeoArea)).optional(),
    hours: fact(z.array(OpeningHours)).optional(),
    booking_url: fact(z.string().url()).optional(),
  }),

  legal: z.object({
    entity_jurisdiction: fact(z.string().min(1)),
    privacy_contact: fact(z.string().min(1)),
    refund_terms: fact(z.string()).optional(),
    cookie_categories: fact(z.array(CookieCategory)).optional(),
  }),
});

export type FactRegistry = z.infer<typeof FactRegistry>;

export interface FlatFact {
  readonly id: string;
  readonly path: string;
  readonly value: unknown;
  readonly quotable: boolean;
  readonly verification: string;
}

function isFactNode(value: unknown): value is FlatFact & { provenance: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'value' in value &&
    'provenance' in value &&
    'id' in value
  );
}

/**
 * Flatten the registry to `{ id, path, value, quotable }` rows. The invariant runner needs a
 * fact lookup by id; the Gap Report needs one by path.
 */
export function flattenFacts(registry: unknown, prefix = ''): FlatFact[] {
  const out: FlatFact[] = [];

  const walk = (node: unknown, path: string): void => {
    if (isFactNode(node)) {
      out.push({
        id: String(node.id),
        path,
        value: node.value,
        quotable: Boolean(node.quotable),
        verification: String(node.verification ?? 'self_reported'),
      });
      return;
    }
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return;
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(registry, prefix);
  return out;
}

/** Index the flattened facts by id, for the `grounded_in` leash. */
export function factsById(registry: unknown): Map<string, FlatFact> {
  return new Map(flattenFacts(registry).map((f) => [f.id, f]));
}

/** Every image asset anywhere in the registry, with the path that reached it. */
export function collectImageAssets(registry: unknown): { path: string; asset: unknown }[] {
  const out: { path: string; asset: unknown }[] = [];
  const seen = new Set<unknown>();

  const looksLikeImage = (value: unknown): boolean =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    'path' in value &&
    'rights' in value &&
    'width' in value;

  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (looksLikeImage(node)) {
      out.push({ path, asset: node });
      // An image has no nested images, but its fields are still walked for uniformity.
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(registry, '');
  return out;
}
