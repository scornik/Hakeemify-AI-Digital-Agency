/**
 * The motion registry — a closed vocabulary of named effects.
 *
 * ARCHITECTURE §1.1 replaces v4 §9's single WebGL budget with four tiers, because the 140 kB
 * ceiling is unachievable with three.js (measured floor: 123 kB gzip for one basic mesh). The
 * tiers are the whole point: `tier_0` is pre-rendered and cannot regress, `tier_a` is ~10.5 kB,
 * `tier_b` is 46.5 kB and buys pinning, `tier_c` is one WebGL island per site.
 *
 * Two rules here are mechanical rather than advisory:
 *
 * - **Only compositor-threaded properties.** `opacity`, `transform`, `clip-path` and nothing
 *   else. This is what makes `non-composited-animations = 0` (ARCHITECTURE §7) achievable, and
 *   it is checked against the effect's own stylesheets, not only against its declaration.
 * - **The reduced-motion arm follows from the kind of motion, not from an author's taste.**
 *   Lenis's tri-mode reading (SYNTHESIS §7.3): programmatic → instant, gesture → 1:1,
 *   loop → poster. An effect that declares a different pairing does not load.
 */
import { z } from 'zod';
import { AssetId, MOTION_TIERS, type MotionTier } from '@ada/contract';

/** Properties a compositor can animate without the main thread. Motion One's rule. */
export const COMPOSITOR_SAFE_PROPERTIES = ['opacity', 'transform', 'clip-path'] as const;
export type CompositorSafeProperty = (typeof COMPOSITOR_SAFE_PROPERTIES)[number];

/**
 * Per-tier runtime budgets, in gzipped bytes, from ARCHITECTURE §1.1. These are the *runtime*
 * a tier pulls in (motion/mini, GSAP core + ScrollTrigger, OGL), not the effect's own source;
 * an effect's `max_gz_bytes` is its own code and must fit inside its tier's remaining room.
 */
export const TIER_RUNTIME_GZ_BYTES: Readonly<Record<MotionTier, number>> = {
  tier_0: 0, // pre-rendered WebM/AV1 + poster, 0 kB JS
  tier_a: 10752, // motion/mini + inView, ~10.5 kB gz
  tier_b: 47616, // GSAP core + ScrollTrigger, 46.5 kB gz
  tier_c: 15360, // OGL or raw shader plane, <= 15 kB gz
};

/**
 * Lenis's tri-mode reading, as a table rather than a convention (SYNTHESIS §7.3). A flag named
 * `respects_prefers_reduced_motion` tells you nothing about what the effect should *do*; this
 * says it.
 */
export const REDUCED_MOTION_ARM = {
  /** The page moved something on the user's behalf: jump to the end state. */
  programmatic: 'instant',
  /** The user is driving: track the gesture 1:1 and add nothing. */
  gesture: 'one_to_one',
  /** It runs forever on its own: show the poster and never start. */
  loop: 'poster',
} as const;

export type MotionKind = keyof typeof REDUCED_MOTION_ARM;
export type ReducedMotionArm = (typeof REDUCED_MOTION_ARM)[MotionKind];

export const MOTION_KINDS = Object.keys(REDUCED_MOTION_ARM) as MotionKind[];

export const MotionEffect = z
  .object({
    id: AssetId,
    tier: z.enum(MOTION_TIERS),
    /** `planned` means the vocabulary entry exists and the implementation does not yet. */
    status: z.enum(['implemented', 'planned']),
    $description: z.string().optional(),
    motion_kind: z.enum(['programmatic', 'gesture', 'loop']),
    reduced_motion_fallback: z.enum(['instant', 'one_to_one', 'poster']),
    allowed_properties: z.array(z.enum(COMPOSITOR_SAFE_PROPERTIES)).default([]),
    /** Shipped source, relative to the registry file's directory. Measured, not estimated. */
    sources: z.array(z.string().min(1)).default([]),
    max_gz_bytes: z.number().int().nonnegative(),
  })
  .superRefine((effect, ctx) => {
    const expected = REDUCED_MOTION_ARM[effect.motion_kind];
    if (effect.reduced_motion_fallback !== expected) {
      ctx.addIssue({
        code: 'custom',
        path: ['reduced_motion_fallback'],
        message: `a ${effect.motion_kind} effect reduces to "${expected}", not "${effect.reduced_motion_fallback}"`,
      });
    }
    const runtime = TIER_RUNTIME_GZ_BYTES[effect.tier];
    if (effect.max_gz_bytes > runtime && effect.tier !== 'tier_0') {
      ctx.addIssue({
        code: 'custom',
        path: ['max_gz_bytes'],
        message: `${effect.max_gz_bytes} exceeds the ${effect.tier} runtime budget of ${runtime} gz bytes`,
      });
    }
    if (effect.tier === 'tier_0' && (effect.sources.length > 0 || effect.max_gz_bytes > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'tier_0 is pre-rendered: it ships 0 bytes of source and declares a 0 ceiling',
      });
    }
    if (effect.status === 'planned' && effect.sources.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'a planned effect has no source yet; mark it `implemented` once it does',
      });
    }
    if (
      effect.status === 'implemented' &&
      effect.tier !== 'tier_0' &&
      effect.sources.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['sources'],
        message: 'an implemented effect above tier_0 must name the source its ceiling measures',
      });
    }
  });
export type MotionEffect = z.infer<typeof MotionEffect>;

export const MotionRegistryFile = z
  .object({
    schema_version: z.number().int().nonnegative(),
    $description: z.string().optional(),
    effects: z.array(MotionEffect).min(1),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.effects.forEach((effect, index) => {
      if (seen.has(effect.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['effects', index, 'id'],
          message: `effect id "${effect.id}" is used twice`,
        });
      }
      seen.add(effect.id);
    });
  });
export type MotionRegistryFile = z.infer<typeof MotionRegistryFile>;
