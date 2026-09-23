/**
 * The authored design-system file: DTCG-shaped YAML, validated by Zod.
 *
 * DTCG gives us `$type` / `$value` / `$description` / `$extensions` and the group-vs-token
 * distinction (a node with `$type` is a token; anything else is a group). Everything this
 * system needs beyond DTCG — which algorithm derives a seed, which ramp index a role is,
 * which conditions override a value — lives under `$extensions.agency`, which is exactly what
 * `$extensions` is for.
 *
 * Nothing here computes. This module says what a file may contain; `compile.ts` says what it
 * means.
 */
import { z } from 'zod';
import { AssetId, VERSIONED_REF } from '@ada/contract';
import { CONDITION_NAMES } from './conditions.js';
import { PALETTE_STEPS } from './algorithms.js';

/**
 * v4 §12 lists `active | frozen | retired`. `reference` is a fourth value, and it is not a
 * design decision hiding in a schema: it marks a file that exists to feed the compiler and
 * must never reach an eligible set. Eligibility filters on `active`, so adding a value here
 * cannot widen what a build may select.
 */
export const DESIGN_SYSTEM_STATUSES = ['active', 'frozen', 'retired', 'reference'] as const;
export type DesignSystemStatus = (typeof DESIGN_SYSTEM_STATUSES)[number];

const VERSION = /^[0-9]+(\.[0-9]+)?$/;

/** v4 writes `version: 3.1` unquoted, which YAML reads as a number. Accept both, store text. */
export const DesignSystemVersion = z
  .union([z.number(), z.string()])
  .transform((value) => String(value))
  .refine((value) => VERSION.test(value), 'a version must be `N` or `N.N`');

export const VisualDna = z.object({
  composition_family: z.enum([
    'editorial',
    'product_story',
    'cinematic',
    'minimalist',
    'technical',
    'magazine',
  ]),
  typography_voice: z.enum(['luxury', 'corporate', 'modern', 'playful', 'utilitarian']),
  visual_energy: z.number().int().min(1).max(10),
  motion_language: z.enum(['none', 'subtle', 'expressive', 'immersive']),
});
export type VisualDna = z.infer<typeof VisualDna>;

const ConditionName = z.enum(CONDITION_NAMES);

/** A seed declares which algorithm consumes it. The seed's own key names the result. */
export const SeedAlgorithm = z.discriminatedUnion('algorithm', [
  z.object({
    algorithm: z.literal('palette'),
    steps: z.literal(PALETTE_STEPS).optional(),
  }),
  z.object({
    algorithm: z.literal('type_scale'),
    ratio: z.number().gt(1),
    steps: z.array(z.number()).min(1),
  }),
  z.object({
    algorithm: z.literal('spacing_scale'),
    steps: z.array(z.number().nonnegative()).min(1),
  }),
  z.object({
    algorithm: z.literal('radius_scale'),
    steps: z.array(z.number().nonnegative()).min(1),
  }),
]);
export type SeedAlgorithm = z.infer<typeof SeedAlgorithm>;

export const SeedToken = z.object({
  $type: z.enum(['color', 'dimension']),
  $value: z.union([z.string(), z.number()]),
  $description: z.string().optional(),
  $extensions: z.object({ agency: SeedAlgorithm }),
});
export type SeedToken = z.infer<typeof SeedToken>;

/** A ramp index, or a raw CSS value for conditions no ramp can express (system colours). */
export const RoleConditionValue = z.union([
  z
    .number()
    .int()
    .min(0)
    .max(PALETTE_STEPS - 1),
  z.string(),
]);

export const RoleToken = z.object({
  $type: z.literal('color'),
  $value: z.never().optional(),
  $description: z.string().optional(),
  $extensions: z.object({
    agency: z.object({
      role: z.object({
        ramp: z.string().min(1),
        index: z
          .number()
          .int()
          .min(0)
          .max(PALETTE_STEPS - 1),
        // `partialRecord`, not `record`: Zod 4's enum-keyed record is exhaustive, and a role
        // that overrides only `dark` is the normal case, not an incomplete one.
        conditions: z.partialRecord(ConditionName, RoleConditionValue).optional(),
      }),
    }),
  }),
});
export type RoleToken = z.infer<typeof RoleToken>;

/**
 * `string` is not a DTCG type; it is our escape hatch for a raw CSS value (a shadow list, a
 * `none`). It is named rather than implicit so a reviewer can see every place the compiler
 * stops understanding a value.
 */
export const LITERAL_TYPES = [
  'color',
  'dimension',
  'number',
  'duration',
  'cubicBezier',
  'fontFamily',
  'fontWeight',
  'string',
] as const;

const LiteralValue = z.union([
  z.string(),
  z.number(),
  z.array(z.union([z.string(), z.number()])).min(1),
]);

export const LiteralToken = z.object({
  $type: z.enum(LITERAL_TYPES),
  $value: LiteralValue,
  $description: z.string().optional(),
  $extensions: z
    .object({
      agency: z
        .object({ conditions: z.partialRecord(ConditionName, LiteralValue).optional() })
        .optional(),
    })
    .optional(),
});
export type LiteralToken = z.infer<typeof LiteralToken>;

export const ContrastPair = z.object({
  /** A role path, e.g. `fg.primary`. */
  fg: z.string().min(1),
  bg: z.string().min(1),
  /** WCAG 2.2 SC 1.4.3: 4.5:1 normal, 3:1 large. The author declares which a pair is. */
  size: z.enum(['normal', 'large']).default('normal'),
  $description: z.string().optional(),
});
export type ContrastPair = z.infer<typeof ContrastPair>;

/** A DTCG subtree. Walked by `compile.ts`, which decides group from token by `$type`. */
const DtcgTree = z.record(z.string(), z.unknown());

export const DesignSystemFile = z.object({
  id: AssetId,
  version: DesignSystemVersion,
  status: z.enum(DESIGN_SYSTEM_STATUSES),
  $description: z.string().optional(),
  visual_dna: VisualDna,
  art_direction_compat: z.array(AssetId).default([]),
  positioning_compat: z.array(AssetId).default([]),
  forbids: z.array(AssetId).default([]),
  seed: z.record(z.string(), z.unknown()),
  roles: DtcgTree,
  literal: DtcgTree.default({}),
  contrast: z.object({
    $description: z.string().optional(),
    pairs: z.array(ContrastPair).min(1),
  }),
});
export type DesignSystemFile = z.infer<typeof DesignSystemFile>;

/** `editorial_v3@3.1` — the form every build manifest pins (v4 §12). */
export function versionedRef(file: Pick<DesignSystemFile, 'id' | 'version'>): string {
  const ref = `${file.id}@${file.version}`;
  /* c8 ignore next 3 -- both halves are already regex-validated; this is a belt-and-braces check */
  if (!VERSIONED_REF.test(ref)) {
    throw new Error(`design system ${file.id} does not produce a valid pinned ref (${ref})`);
  }
  return ref;
}
