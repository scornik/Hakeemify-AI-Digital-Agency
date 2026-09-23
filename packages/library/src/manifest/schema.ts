/**
 * The library manifest: a **superset of the shadcn registry item**.
 *
 * shadcn's registry-item shape (`name`, `type`, `files[]`, `dependencies`,
 * `registryDependencies`, `cssVars`, …) is kept verbatim so the CLI ecosystem and the
 * ts-morph `--check` pattern MagicUI uses both work unmodified. Everything the selection
 * pipeline needs — v4 §8's layout genome and §11's authoring standard — is added beside it.
 *
 * Three things this schema does that a registry item does not:
 *
 * 1. **`name` carries the strict id grammar.** shadcn names are free strings; ours are
 *    `family/variant` per `@ada/contract`'s `VARIANT_ID`, and the `family` field must agree
 *    with the family half. One id, cross-checked, rather than a slug and an id that can drift.
 * 2. **Every `requires` string is parsed at validation time** with `parsePredicate`. A typo in
 *    a predicate is otherwise indistinguishable from a section that is simply ineligible, and
 *    the build would quietly fall back instead of failing (the same reason the id grammar is
 *    strict).
 * 3. **The tier-0 entry gate is a schema rule, not a review convention** (v4 §11). An `active`
 *    manifest must carry `signature_move`, a `negative_example`, the family's minimum
 *    arrangements, a full rubric on each, and enough reviewers. A `scaffold` manifest must
 *    carry none of it and must be `ungraded` throughout. There is no shape in this schema that
 *    lets an ungraded variant present itself as graded.
 */
import { z } from 'zod';
import {
  ArrangementId,
  AssetId,
  Density,
  MOTION_PATTERNS,
  MOTION_TIERS,
  SectionFamily,
  VariantId,
  parsePredicate,
  variantFamily,
} from '@ada/contract';
import { familyStandard } from './family-standards.js';

/* -------------------------------------------------------------------------------------- */
/* shadcn registry-item surface                                                             */
/* -------------------------------------------------------------------------------------- */

/** shadcn's own set, plus `registry:section` for an `.astro` section variant. */
export const REGISTRY_ITEM_TYPES = [
  'registry:section',
  'registry:block',
  'registry:component',
  'registry:ui',
  'registry:lib',
  'registry:hook',
  'registry:page',
  'registry:file',
  'registry:style',
  'registry:theme',
] as const;

export const RegistryItemFile = z.object({
  /** Relative to the manifest's own directory. A manifest describes its own folder. */
  path: z.string().min(1),
  type: z.enum(REGISTRY_ITEM_TYPES),
  target: z.string().min(1).optional(),
});
export type RegistryItemFile = z.infer<typeof RegistryItemFile>;

export const CssVars = z.object({
  theme: z.record(z.string(), z.string()).optional(),
  light: z.record(z.string(), z.string()).optional(),
  dark: z.record(z.string(), z.string()).optional(),
});

/* -------------------------------------------------------------------------------------- */
/* Predicates                                                                               */
/* -------------------------------------------------------------------------------------- */

/** A predicate string that must parse under the v4 §2 grammar `@ada/contract` implements. */
export const PredicateString = z
  .string()
  .min(1)
  .superRefine((value, ctx) => {
    const parsed = parsePredicate(value);
    if (!parsed.ok) {
      ctx.addIssue({
        code: 'custom',
        message: `predicate does not parse: ${parsed.error.message} (at ${parsed.error.pos})`,
      });
    }
  });

/* -------------------------------------------------------------------------------------- */
/* v4 §8 — layout genome                                                                    */
/* -------------------------------------------------------------------------------------- */

export const RHYTHM_ROLES = ['impact', 'explanation', 'proof', 'relief', 'offer'] as const;

export const FocalWeight = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const Composition = z.object({
  density: Density,
  background_weight: z.enum(['light', 'dark', 'accent', 'image']),
  focal_weight: FocalWeight,
  approx_vh: z.number().positive(),
  media_dependency: z.enum(['none', 'abstract', 'photo_required', 'video_optional']),
  text_volume: z.object({
    headline_max_chars: z.number().int().positive(),
    body_max_chars: z.number().int().nonnegative(),
    items_min: z.number().int().nonnegative().optional(),
    items_max: z.number().int().positive().optional(),
  }),
});
export type Composition = z.infer<typeof Composition>;

/**
 * v4 §9's `MotionProfile`, narrowed to ARCHITECTURE §1.1's tiers and pointed at a motion
 * registry id. `respects_prefers_reduced_motion` is not a field: v4 declares it literal and
 * unsettable, and a boolean nobody may set false is better expressed by not existing.
 */
export const ManifestMotion = z.object({
  /** An id in the motion registry, which owns the byte ceiling and the implementation. */
  effect: AssetId,
  pattern: z.enum(MOTION_PATTERNS),
  tier: z.enum(MOTION_TIERS),
  trigger: z.enum(['load', 'in_view', 'scroll_linked', 'interaction']),
  density: z.number().min(0).max(1),
  budget_ms: z.number().nonnegative(),
  stagger_ms: z.number().nonnegative().optional(),
  /** Measured at library-build time, never guessed (v4 §9). */
  main_thread_ms_est: z.number().nonnegative(),
  /** Lenis's tri-mode reading; the motion registry defines the semantics. */
  reduced_motion_fallback: z.enum(['instant', 'one_to_one', 'poster']),
});
export type ManifestMotion = z.infer<typeof ManifestMotion>;

export const SlotBinding = z.object({
  slot: z.string().min(1),
  required: z.boolean(),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('fact'), query: z.string().min(1) }),
    z.object({ kind: z.literal('asset'), query: z.string().min(1) }),
    z.object({
      kind: z.literal('generated'),
      /** The leash (v4 §8). */
      grounded_in: z.array(z.string().min(1)).default([]),
      may_claim: z.union([z.literal(false), z.literal('quotable_only')]),
    }),
  ]),
  max_chars: z.number().int().positive().optional(),
  register: z.literal('inherit_positioning').optional(),
});

export const AssetConstraint = z.object({
  slot: z.string().min(1),
  min_aspect: z.number().positive().optional(),
  max_aspect: z.number().positive().optional(),
  min_width: z.number().int().positive().optional(),
  focal_safe_area: z.enum(['center', 'upper_third', 'any']).optional(),
});

/* -------------------------------------------------------------------------------------- */
/* v4 §11 — authoring standard and grades                                                   */
/* -------------------------------------------------------------------------------------- */

export const RUBRIC_KEYS = [
  'single_dominant_focal_element',
  'type_scale_respected',
  'consistent_optical_alignment',
  'whitespace_rhythm_consistent',
  'survives_long_content',
  'survives_sparse_content',
  'readable_at_360px',
  'focus_states_visible',
  'grade_survives_art_directions',
] as const;

export const LibraryGrade = z.object({
  rubric: z.object(
    Object.fromEntries(RUBRIC_KEYS.map((key) => [key, z.boolean()])) as Record<
      (typeof RUBRIC_KEYS)[number],
      z.ZodBoolean
    >,
  ),
  extra_rubric: z.record(z.string(), z.boolean()).optional(),
  /** Pairwise, WITHIN family. Recorded, never computed by this package. */
  elo: z.number(),
  graded_at: z.string().min(1),
  graded_by: z.enum(['human', 'human_plus_model']),
});
export type LibraryGrade = z.infer<typeof LibraryGrade>;

/**
 * `ungraded` is a literal, not an absent field. An arrangement always answers the question
 * "has a human graded this?", and the only two answers are a grade and the word `ungraded`.
 */
export const Grade = z.union([z.literal('ungraded'), LibraryGrade]);
export type Grade = z.infer<typeof Grade>;

export const isGraded = (grade: Grade): grade is LibraryGrade => grade !== 'ungraded';

export const AuthoringRecord = z.object({
  /** One deliberate, non-obvious compositional decision, in one sentence (v4 §11). */
  signature_move: z.string().min(1),
  negative_example: z.object({
    screenshot: z.string().min(1),
    why_rejected: z.string().min(1),
  }),
  author: z.string().min(1),
  authored_at: z.string().min(1),
  reviewed_by: z.array(z.string().min(1)).default([]),
});
export type AuthoringRecord = z.infer<typeof AuthoringRecord>;

export const Arrangement = z.object({
  id: ArrangementId,
  props: z.record(z.string(), z.unknown()).default({}),
  novelty_class: z.string().min(1),
  requires: z.array(PredicateString).default([]),
  /** What stops arrangements being cosmetic: the one that runs is the one the photo carries. */
  asset_constraints: z.array(AssetConstraint).default([]),
  composition_override: Composition.partial().optional(),
  motion_override: ManifestMotion.partial().optional(),
  signature_move: z.string().min(1).optional(),
  grade: Grade.default('ungraded'),
});
export type Arrangement = z.infer<typeof Arrangement>;

/* -------------------------------------------------------------------------------------- */
/* v4 §10 — priors                                                                          */
/* -------------------------------------------------------------------------------------- */

export const ConversionPrior = z
  .object({
    status: z.enum(['unproven', 'plausible', 'measured']),
    /** The source of the belief. v4 §10: no invented percentages. */
    note: z.string().optional(),
    evidence: z
      .object({
        lift_vs_family_baseline: z.number(),
        interval_95: z.tuple([z.number(), z.number()]),
        n_impressions: z.number().int().nonnegative(),
        n_conversions: z.number().int().nonnegative(),
        n_businesses: z.number().int().nonnegative(),
        window: z.string().min(1),
        stratum: z
          .object({
            niche: z.string().optional(),
            positioning: z.string().optional(),
            device: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  })
  .refine(
    (prior) => prior.status !== 'measured' || prior.evidence !== undefined,
    'a `measured` prior must carry its evidence',
  );

/* -------------------------------------------------------------------------------------- */
/* The manifest                                                                             */
/* -------------------------------------------------------------------------------------- */

/**
 * `scaffold` is ARCHITECTURE §10's fourth status: machine-authored plumbing that exists so the
 * pipeline is end-to-end testable, excluded from every real client build until a human grades
 * it. v4 §12's three remain unchanged in meaning.
 */
export const MANIFEST_STATUSES = ['active', 'scaffold', 'frozen', 'retired'] as const;
export type ManifestStatus = (typeof MANIFEST_STATUSES)[number];

const manifestShape = z.object({
  $schema: z.string().optional(),

  // --- shadcn registry item ---------------------------------------------------------------
  name: VariantId,
  type: z.enum(REGISTRY_ITEM_TYPES),
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  author: z.string().optional(),
  files: z.array(RegistryItemFile).min(1),
  dependencies: z.array(z.string().min(1)).default([]),
  devDependencies: z.array(z.string().min(1)).default([]),
  registryDependencies: z.array(z.string().min(1)).default([]),
  cssVars: CssVars.default({}),
  categories: z.array(z.string().min(1)).default([]),
  meta: z.record(z.string(), z.unknown()).optional(),
  docs: z.string().optional(),

  // --- ours (v4 §8, §11) ------------------------------------------------------------------
  schema_version: z.number().int().nonnegative(),
  family: SectionFamily,
  status: z.enum(MANIFEST_STATUSES),
  serves_beats: z.array(z.string().min(1)).min(1),
  serves_rhythm_roles: z.array(z.enum(RHYTHM_ROLES)).default([]),
  /** HARD GATE. Never relaxed by the compat-filter retreat order (ARCHITECTURE §5). */
  requires: z.array(PredicateString).default([]),
  enhanced_by: z.array(z.object({ predicate: PredicateString, weight: z.number() })).default([]),
  slots: z.array(SlotBinding).default([]),
  affinity: z
    .object({
      industries: z.array(z.string().min(1)).default([]),
      exclude_industries: z.array(z.string().min(1)).default([]),
    })
    .default({ industries: [], exclude_industries: [] }),
  design_compat: z.object({
    systems: z.array(AssetId).min(1),
    art_directions: z.array(AssetId).optional(),
    composition_families: z.array(z.string().min(1)).optional(),
    visual_energy_range: z.tuple([z.number(), z.number()]).optional(),
  }),
  /** Omitted means "any" (v4 §8). */
  positioning_compat: z.array(AssetId).optional(),
  composition: Composition,
  motion: ManifestMotion,
  budget: z.object({
    js_kb: z.number().nonnegative(),
    blocks_lcp: z.boolean(),
    requires_webgl: z.boolean(),
  }),
  a11y: z.object({
    interactive: z.boolean(),
    keyboard_pattern: z.enum(['accordion', 'carousel', 'disclosure', 'slider', 'tabs']).optional(),
    reduced_motion_fallback: z.string().min(1),
    contrast_pairs: z.array(z.tuple([z.string().min(1), z.string().min(1)])).default([]),
  }),
  priors: ConversionPrior,
  arrangements: z.array(Arrangement).min(1),
  authoring: AuthoringRecord.optional(),
  novelty_class: z.string().min(1),
  fallback: z.boolean().default(false),
});

export type SectionManifestInput = z.input<typeof manifestShape>;

/**
 * Cross-field rules. Everything here is a rule the spec states in prose and that would
 * otherwise be enforced by whoever reviewed the pull request.
 */
export const SectionManifest = manifestShape.superRefine((manifest, ctx) => {
  const fail = (path: (string | number)[], message: string): void => {
    ctx.addIssue({ code: 'custom', path, message });
  };

  // The id grammar and the discriminator must agree.
  if (variantFamily(manifest.name) !== manifest.family) {
    fail(
      ['family'],
      `family "${manifest.family}" does not match the family half of the id "${manifest.name}"`,
    );
  }

  const paths = new Set<string>();
  manifest.files.forEach((file, index) => {
    if (paths.has(file.path)) fail(['files', index, 'path'], `${file.path} is listed twice`);
    paths.add(file.path);
  });

  const ids = new Set<string>();
  manifest.arrangements.forEach((arrangement, index) => {
    if (ids.has(arrangement.id)) {
      fail(['arrangements', index, 'id'], `arrangement id "${arrangement.id}" is used twice`);
    }
    ids.add(arrangement.id);
  });

  const standard = familyStandard(manifest.family);
  const graded = manifest.arrangements.filter((a) => isGraded(a.grade));

  if (manifest.status === 'scaffold') {
    // ARCHITECTURE §10. A scaffold that could carry a grade is a scaffold that could be
    // mistaken for library content, which is the one failure mode the boundary exists for.
    if (manifest.authoring !== undefined) {
      fail(['authoring'], 'a scaffold may not carry an authoring record — only a human authors');
    }
    manifest.arrangements.forEach((arrangement, index) => {
      if (isGraded(arrangement.grade)) {
        fail(['arrangements', index, 'grade'], 'a scaffold arrangement must be `ungraded`');
      }
      if (arrangement.signature_move !== undefined) {
        fail(
          ['arrangements', index, 'signature_move'],
          'a scaffold may not name a signature move — only a human names one',
        );
      }
    });
    return;
  }

  if (manifest.status !== 'active') return; // frozen and retired are historical records

  // v4 §11 `required_to_enter_library`, checked rather than reviewed.
  if (manifest.authoring === undefined) {
    fail(
      ['authoring'],
      'an active variant needs an authoring record (signature_move + negative_example)',
    );
  } else if (manifest.authoring.reviewed_by.length < standard.reviewers) {
    fail(
      ['authoring', 'reviewed_by'],
      `family "${manifest.family}" needs ${standard.reviewers} reviewers, got ${manifest.authoring.reviewed_by.length}`,
    );
  }

  if (manifest.arrangements.length < standard.min_arrangements) {
    fail(
      ['arrangements'],
      `family "${manifest.family}" needs at least ${standard.min_arrangements} arrangements, got ${manifest.arrangements.length}`,
    );
  }

  if (graded.length !== manifest.arrangements.length) {
    fail(['arrangements'], 'every arrangement of an active variant must be graded');
  }

  manifest.arrangements.forEach((arrangement, index) => {
    if (arrangement.signature_move === undefined) {
      fail(
        ['arrangements', index, 'signature_move'],
        'an active arrangement must name its signature move',
      );
    }
    const grade = arrangement.grade;
    if (!isGraded(grade)) return;
    for (const [key, value] of Object.entries(grade.rubric)) {
      if (value !== true) {
        fail(['arrangements', index, 'grade', 'rubric', key], `rubric item "${key}" is not true`);
      }
    }
    for (const key of standard.extra_rubric) {
      if (grade.extra_rubric?.[key] !== true) {
        fail(
          ['arrangements', index, 'grade', 'extra_rubric', key],
          `family "${manifest.family}" requires extra rubric item "${key}" to be true`,
        );
      }
    }
  });
});

export type SectionManifest = z.infer<typeof SectionManifest>;
