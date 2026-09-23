/**
 * `SectionInstance` (ARCHITECTURE §3).
 *
 * A page is a flat `Record<instance_id, SectionInstance>` plus an ordered `order[]` — not a
 * tree, not a grid. Trees and grids express *position*, which would let the model or the owner
 * assemble a composition nobody authored. Here the only compositional choices are which
 * authored variant fills a beat and which of its authored arrangements runs.
 *
 * `family` is the discriminator, and the only vocabulary the model ever sees.
 */
import { z } from 'zod';
import { ArrangementId, InstanceId, VariantId } from '../ids.js';

export const SECTION_FAMILIES = [
  'hero',
  'problem',
  'services',
  'process',
  'proof',
  'faq',
  'cta',
  'team',
  'footer',
] as const;
export type SectionFamily = (typeof SECTION_FAMILIES)[number];

export const SectionFamily = z.enum(SECTION_FAMILIES);

/** A slot is bound to a fact, to an asset, or to generated copy held on a `grounded_in` leash. */
export const SlotValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fact'), fact_id: z.string().min(1) }),
  z.object({ kind: z.literal('asset'), asset_id: z.string().min(1) }),
  z.object({
    kind: z.literal('generated'),
    text: z.string(),
    /**
     * The leash. Every number, name, date or quotation in `text` must resolve to one of these
     * facts, and every one of them must be `quotable: true`.
     */
    grounded_in: z.array(z.string().min(1)),
  }),
]);
export type SlotValue = z.infer<typeof SlotValue>;

export const MOTION_PATTERNS = [
  'none',
  'reveal',
  'parallax',
  'scroll_story',
  'depth',
  'cinematic',
  'webgl_scene',
] as const;

/**
 * Motion tiers replace v4 §9's single budget (ARCHITECTURE §1.1). `tier_c` is the only one
 * that may run WebGL, is capped at one per site, and ships a poster that stays in the DOM
 * until the first rendered frame.
 */
export const MOTION_TIERS = ['tier_0', 'tier_a', 'tier_b', 'tier_c'] as const;
export type MotionTier = (typeof MOTION_TIERS)[number];

export const MotionProfileRef = z.object({
  /** An id in the motion registry; the registry owns the byte ceiling and the implementation. */
  pattern: z.enum(MOTION_PATTERNS),
  tier: z.enum(MOTION_TIERS),
  trigger: z.enum(['load', 'in_view', 'scroll_linked', 'interaction']),
  /** 0–1. Also an input to the computed intensity (v4 §7). */
  density: z.number().min(0).max(1),
  budget_ms: z.number().nonnegative(),
  /** Measured at library-build time, never guessed. */
  main_thread_ms_est: z.number().nonnegative(),
  reduced_motion_fallback: z.string().min(1),
});
export type MotionProfileRef = z.infer<typeof MotionProfileRef>;

export const Density = z.enum(['sparse', 'medium', 'dense']);
export type Density = z.infer<typeof Density>;

/** Written by assembly, read by the gate and the anti-slop sequence rules. Never authored. */
export const ComputedComposition = z.object({
  intensity: z.number().min(0).max(1),
  focal_weight: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  density: Density,
  approx_vh: z.number().positive(),
  background_weight: z.enum(['light', 'dark', 'accent', 'image']),
  /** True when the arrangement names a signature move (v4 §11). */
  is_signature: z.boolean(),
});
export type ComputedComposition = z.infer<typeof ComputedComposition>;

const sectionShape = {
  instance_id: InstanceId,
  variant_id: VariantId,
  arrangement_id: ArrangementId,
  schema_version: z.number().int().nonnegative(),
  slots: z.record(z.string().min(1), SlotValue),
  motion: MotionProfileRef,
  computed: ComputedComposition,
};

const member = <F extends SectionFamily>(family: F) =>
  z.object({ family: z.literal(family), ...sectionShape });

/**
 * One member per family, listed rather than generated so the union keeps its literal types.
 * The shapes are identical today; the union exists so a family can gain its own constraints
 * without the others inheriting them, and so the JSON Schema handed to the model enumerates
 * families rather than accepting a free string.
 */
export const SectionInstance = z.discriminatedUnion('family', [
  member('hero'),
  member('problem'),
  member('services'),
  member('process'),
  member('proof'),
  member('faq'),
  member('cta'),
  member('team'),
  member('footer'),
]);

export type SectionInstance = z.infer<typeof SectionInstance>;
