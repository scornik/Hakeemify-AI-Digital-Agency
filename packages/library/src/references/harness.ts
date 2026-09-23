/**
 * Reference-render addressing, index and storage contract (ARCHITECTURE §7.4).
 *
 * The gate compares a rendered page against a library-time reference render "keyed
 * (arrangement, design_system, project)". P3 owns that key: the path template, the index of
 * which references exist, and the resolver that turns a key into a path and reports what is
 * missing. It deliberately owns nothing else — **no Playwright, no browser, no I/O beyond
 * reading an index file**. The gate package owns browser execution, and a harness that shelled
 * out to a browser could not be unit-tested by either package.
 *
 * ### The qualified arrangement id
 *
 * `@ada/contract`'s `ARRANGEMENT_ID` is `portrait-left` — unique within a variant, not across
 * the library, because two families may each want a `portrait-left`. The spec's key is a
 * triple, so the arrangement half carries the variant with it:
 *
 *     hero/founder_editorial#portrait-left
 *
 * The key stays the triple the spec names, and it is unambiguous. The alternative — a
 * four-field key — would have meant every caller remembering to pass a variant id that is
 * already implied by the arrangement it is addressing.
 */
import { z } from 'zod';
import { ARRANGEMENT_ID, VARIANT_ID, variantFamily } from '@ada/contract';

/** Playwright project names, per ARCHITECTURE §7.2's artifact bundle. */
export const REFERENCE_PROJECTS = [
  'desktop-chrome',
  'mobile-safari',
  'tablet',
  'reduced-motion',
  'dark',
] as const;
export type ReferenceProject = (typeof REFERENCE_PROJECTS)[number];

export const ReferenceProjectSchema = z.enum(REFERENCE_PROJECTS);

export const QUALIFIED_ARRANGEMENT_ID = new RegExp(
  `^${VARIANT_ID.source.slice(1, -1)}#${ARRANGEMENT_ID.source.slice(1, -1)}$`,
);

export interface ReferenceKey {
  /** Qualified: `family/variant#arrangement`. */
  readonly arrangement_id: string;
  readonly design_system_id: string;
  readonly project: ReferenceProject;
}

export const ReferenceKeySchema = z.object({
  arrangement_id: z
    .string()
    .regex(QUALIFIED_ARRANGEMENT_ID, 'a reference key names `family/variant#arrangement`'),
  design_system_id: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a design system id is lower_snake_case'),
  project: ReferenceProjectSchema,
});

export function qualifyArrangementId(variantId: string, arrangementId: string): string {
  const qualified = `${variantId}#${arrangementId}`;
  if (!QUALIFIED_ARRANGEMENT_ID.test(qualified)) {
    throw new Error(
      `"${qualified}" is not a qualified arrangement id (family/variant#arrangement)`,
    );
  }
  return qualified;
}

export interface ParsedArrangementId {
  readonly variant_id: string;
  readonly family: string;
  readonly variant: string;
  readonly arrangement_id: string;
}

/** Split a qualified id back into its parts. Returns `null` when it is malformed. */
export function parseQualifiedArrangementId(qualified: string): ParsedArrangementId | null {
  if (!QUALIFIED_ARRANGEMENT_ID.test(qualified)) return null;
  const hash = qualified.indexOf('#');
  const variant_id = qualified.slice(0, hash);
  const family = variantFamily(variant_id);
  /* c8 ignore next -- the regex already guarantees the family half */
  if (family === null) return null;
  return {
    variant_id,
    family,
    variant: variant_id.slice(family.length + 1),
    arrangement_id: qualified.slice(hash + 1),
  };
}

/* -------------------------------------------------------------------------------------- */
/* Storage contract                                                                         */
/* -------------------------------------------------------------------------------------- */

export const REFERENCE_INDEX_FILENAME = 'index.json';
export const REFERENCE_EXTENSION = '.png';

/**
 * `<design_system>/<family>/<variant>/<arrangement>/<project>.png`, posix, relative to the
 * references root.
 *
 * Design system first because a reference render is only meaningful against the tokens it was
 * rendered with; grouping by design system means retiring one is a directory, not a grep.
 */
export function referencePath(key: ReferenceKey): string {
  const parsed = parseQualifiedArrangementId(key.arrangement_id);
  if (parsed === null) {
    throw new Error(`"${key.arrangement_id}" is not a qualified arrangement id`);
  }
  if (!REFERENCE_PROJECTS.includes(key.project)) {
    throw new Error(`"${key.project}" is not a reference project`);
  }
  return [
    key.design_system_id,
    parsed.family,
    parsed.variant,
    parsed.arrangement_id,
    `${key.project}${REFERENCE_EXTENSION}`,
  ].join('/');
}

export const ReferenceIndexEntry = z.object({
  arrangement_id: ReferenceKeySchema.shape.arrangement_id,
  design_system_id: ReferenceKeySchema.shape.design_system_id,
  project: ReferenceProjectSchema,
  /** Relative to the references root, posix. Must equal `referencePath(key)`. */
  path: z.string().min(1),
  /** Of the image bytes. The gate compares against the file it was told about, not a name. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 lower-case hex characters'),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  captured_at: z.string().min(1),
  /** The library commit the reference was rendered from (v4 §12 pins `library@commit`). */
  library_sha: z.string().regex(/^[0-9a-f]{7,40}$/, 'library_sha must be a git sha'),
});
export type ReferenceIndexEntry = z.infer<typeof ReferenceIndexEntry>;

export const ReferenceIndexFile = z
  .object({
    schema_version: z.number().int().nonnegative(),
    entries: z.array(ReferenceIndexEntry).default([]),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.entries.forEach((entry, index) => {
      const key = referenceKeyString(entry);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index],
          message: `two references claim the key ${key}`,
        });
      }
      seen.add(key);
      const expected = referencePath(entry);
      if (entry.path !== expected) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'path'],
          message: `path "${entry.path}" does not match the template "${expected}"`,
        });
      }
    });
  });
export type ReferenceIndexFile = z.infer<typeof ReferenceIndexFile>;

/** The canonical string form of a key. Used for map lookups and for error messages. */
export function referenceKeyString(key: ReferenceKey): string {
  return `${key.design_system_id}|${key.arrangement_id}|${key.project}`;
}

/* -------------------------------------------------------------------------------------- */
/* Index and resolution                                                                     */
/* -------------------------------------------------------------------------------------- */

export interface ReferenceIndex {
  readonly schema_version: number;
  readonly byKey: ReadonlyMap<string, ReferenceIndexEntry>;
}

export function buildReferenceIndex(file: ReferenceIndexFile): ReferenceIndex {
  return {
    schema_version: file.schema_version,
    byKey: new Map(file.entries.map((entry) => [referenceKeyString(entry), entry])),
  };
}

export type ReferenceResolution =
  | {
      readonly found: true;
      readonly key: ReferenceKey;
      readonly path: string;
      readonly entry: ReferenceIndexEntry;
    }
  | {
      readonly found: false;
      readonly key: ReferenceKey;
      readonly path: string;
      readonly reason: string;
    };

/**
 * Resolve a key to a path.
 *
 * A missing reference is a **result**, not an exception: the gate's job on a missing reference
 * is to record `needs_review` and carry on collecting, not to abandon the run. An
 * unaddressable key — a malformed id, an unknown project — still throws, because that is a
 * programming error rather than a gap in the library.
 */
export function resolveReference(index: ReferenceIndex, key: ReferenceKey): ReferenceResolution {
  const path = referencePath(key);
  const entry = index.byKey.get(referenceKeyString(key));
  if (entry === undefined) {
    return {
      found: false,
      key,
      path,
      reason: `no reference render for ${referenceKeyString(key)}`,
    };
  }
  return { found: true, key, path, entry };
}

export interface ArrangementRef {
  readonly variant_id: string;
  readonly arrangement_id: string;
}

/**
 * The full grid a build needs: every arrangement × every design system it is compatible with ×
 * every project. This is what makes a missing reference visible before a gate run rather than
 * during one.
 */
export function requiredReferenceKeys(
  arrangements: readonly ArrangementRef[],
  designSystemIds: readonly string[],
  projects: readonly ReferenceProject[] = REFERENCE_PROJECTS,
): ReferenceKey[] {
  const keys: ReferenceKey[] = [];
  for (const arrangement of arrangements) {
    const qualified = qualifyArrangementId(arrangement.variant_id, arrangement.arrangement_id);
    for (const design_system_id of designSystemIds) {
      for (const project of projects) {
        keys.push({ arrangement_id: qualified, design_system_id, project });
      }
    }
  }
  return keys;
}

/** Every required key the index does not hold, in the order they were required. */
export function missingReferences(
  index: ReferenceIndex,
  required: readonly ReferenceKey[],
): ReferenceKey[] {
  return required.filter((key) => !index.byKey.has(referenceKeyString(key)));
}

export interface ReferenceCoverage {
  readonly required: number;
  readonly present: number;
  readonly missing: readonly ReferenceKey[];
  /** References in the index that nothing requires — a retired arrangement leaves these. */
  readonly orphaned: readonly ReferenceIndexEntry[];
}

export function referenceCoverage(
  index: ReferenceIndex,
  required: readonly ReferenceKey[],
): ReferenceCoverage {
  const requiredKeys = new Set(required.map(referenceKeyString));
  const missing = missingReferences(index, required);
  const orphaned = [...index.byKey.values()].filter(
    (entry) => !requiredKeys.has(referenceKeyString(entry)),
  );
  return {
    required: required.length,
    present: required.length - missing.length,
    missing,
    orphaned,
  };
}
