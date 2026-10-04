/**
 * What the harvester extracts, and — more importantly — what it does not.
 *
 * ## The inversion this package exists for
 *
 * The obvious use of a thousand open-source UI components is a component library. That is the
 * wrong use for this system: a scraped component has no slot contract, no `requires` predicate and
 * no `asset_constraints`, and authoring those is most of the work. Worse, approving a thousand
 * components means a machine grading design, which is the thing the whole architecture refuses.
 *
 * The *right* use is the opposite one, and it is already how tier 1 thinks. From `tier1.ts`:
 *
 * > "The effect-name and class-fingerprint bans are **harvested, not invented** (ARCHITECTURE
 * > §1.7): the Aceternity public registry, MagicUI, and the literal utility classes that tutorial
 * > builder prompts mandate. A list of things a person found tasteless would go stale and be
 * > arguable; a list derived from what the most-copied effect libraries actually ship is neither."
 *
 * So the corpus is a **negative example set**. A pattern in 40% of the most-copied component
 * repositories is a cliché by definition, by the same argument tier 3 makes about n-grams across
 * the last hundred builds. No taste required, and nothing to argue with.
 *
 * ## No source is stored, ever
 *
 * This file extracts class tokens, co-occurring class sets, and imported effect names. It stores
 * no markup, no snippet and no file content. That is a legal convenience and an architectural
 * requirement in equal measure: the output is evidence about frequency, and a snippet would turn
 * the corpus into the component library this package exists not to build.
 *
 * ## Why co-occurrence rather than single tokens
 *
 * `rounded-2xl` on its own is a radius. `shadow-2xl` on its own is a shadow. The four of them on
 * one element — `rounded-2xl shadow-2xl backdrop-blur-sm bg-gradient-to-br` — is the generated-
 * marketing-page fingerprint, and banning any one of them individually would ban ordinary design.
 * So the unit of evidence is the **set**, and its weight is how many distinct repositories ship it.
 */
import { stableHash } from '@ada/contract';

/** A `class`/`className` attribute's tokens, in source order. */
export type ClassSet = readonly string[];

export interface RepoFingerprint {
  /** `owner/name`. The audit trail: every count must be traceable to a named repository. */
  readonly repo: string;
  readonly spdx: string;
  /** One entry per class attribute found. Order within a set is preserved, duplicates removed. */
  readonly classSets: readonly ClassSet[];
  /** Imported or referenced animation/effect identifiers. */
  readonly effectNames: readonly string[];
  readonly filesScanned: number;
}

/**
 * Tailwind-ish tokens that carry no stylistic signal and only add noise to the itemsets: layout
 * primitives every page needs. Excluded so a frequent set is about *look* rather than about the
 * fact that websites use flexbox.
 */
const STRUCTURAL_TOKENS = new Set([
  'flex',
  'grid',
  'block',
  'inline',
  'inline-block',
  'hidden',
  'relative',
  'absolute',
  'fixed',
  'sticky',
  'w-full',
  'h-full',
  'container',
  'mx-auto',
  'items-center',
  'justify-center',
  'justify-between',
  'flex-col',
  'flex-row',
  'overflow-hidden',
]);

/**
 * Strip a Tailwind variant prefix so `md:rounded-2xl` and `rounded-2xl` count as the same
 * decision. The breakpoint is a responsive detail; the radius is the style.
 */
export function baseToken(token: string): string {
  // Only colons *before* an arbitrary value are variants. Splitting on the last colon turned
  // `[mask-image:linear-gradient(...)]` into `linear-gradient(...)]`, which no longer looked like
  // an arbitrary value and so survived the filter as a signal token.
  const bracket = token.indexOf('[');
  const searchable = bracket === -1 ? token : token.slice(0, bracket);
  const colon = searchable.lastIndexOf(':');
  return colon === -1 ? token : token.slice(colon + 1);
}

/** True for tokens worth counting: stylistic, not structural, not a bare arbitrary value. */
export function isSignalToken(token: string): boolean {
  const base = baseToken(token);
  if (base === '' || base.startsWith('[')) return false;
  if (STRUCTURAL_TOKENS.has(base)) return false;
  // Single-letter and numeric-only tokens are almost always spacing. Spacing rhythm is judged by
  // the gate, not banned by name.
  return base.length > 2 && !/^-?\d+$/.test(base);
}

const CLASS_ATTRIBUTE = /\b(?:className|class)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

/**
 * Pull class sets out of component source by regex rather than by parsing.
 *
 * A real AST would be more precise and is not worth it here: the harvester reads JSX, Vue, Svelte,
 * Astro and plain HTML from thousands of repositories, and a parser that handles all five is a
 * project. Frequency analysis tolerates noise — a missed attribute lowers a count slightly, and the
 * thresholds are set in document frequency across repositories, not in absolute hits.
 *
 * `cn(...)`/`clsx(...)` wrappers are handled incidentally: their string literals sit inside the
 * template or quoted argument and are picked up as tokens.
 */
export function extractClassSets(source: string): ClassSet[] {
  const sets: ClassSet[] = [];
  for (const match of source.matchAll(CLASS_ATTRIBUTE)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    // `${...}` interpolations are dropped rather than guessed at.
    const tokens = raw
      .replace(/\$\{[^}]*\}/g, ' ')
      .split(/\s+/)
      .filter(isSignalToken)
      .map(baseToken);
    const unique = [...new Set(tokens)];
    if (unique.length > 0) sets.push(unique);
  }
  return sets;
}

/**
 * Animation and effect libraries whose component names are themselves the cliché. Harvested from
 * what the most-copied registries ship, per ARCHITECTURE §1.7 — not from an opinion about motion.
 */
const EFFECT_SOURCES = [
  'framer-motion',
  'motion/react',
  'motion',
  'gsap',
  '@react-spring',
  'react-tsparticles',
  'lottie',
  'aceternity',
  'magicui',
  'three',
  '@react-three',
];

const IMPORT_LINE = /import\s+(?:(?:\{([^}]*)\})|(\w+))?[^'"]*['"]([^'"]+)['"]/g;
const PASCAL_COMPONENT = /<([A-Z][A-Za-z0-9]{3,})[\s/>]/g;

/**
 * Effect names: the specifiers imported from an animation library, plus PascalCase components whose
 * name contains a known effect word. The second half is what catches a vendored copy — a repository
 * that inlined `AnimatedGradientText` rather than importing it still ships the cliché.
 */
export function extractEffectNames(source: string): string[] {
  const names = new Set<string>();

  for (const match of source.matchAll(IMPORT_LINE)) {
    const from = match[3] ?? '';
    if (!EFFECT_SOURCES.some((library) => from.startsWith(library))) continue;
    const named = (match[1] ?? '').split(',');
    for (const specifier of named) {
      const clean = specifier.split(/\s+as\s+/)[0]?.trim() ?? '';
      if (clean !== '') names.add(clean);
    }
    const defaultImport = match[2]?.trim();
    if (defaultImport !== undefined && defaultImport !== '') names.add(defaultImport);
  }

  const EFFECT_WORDS =
    /(?:Animated|Gradient|Spotlight|Beam|Meteor|Marquee|Shimmer|Sparkle|Aurora|Glow|Bento|Orbit|Particle|Typewriter|Reveal|Parallax|Tilt|Glass)/;
  for (const match of source.matchAll(PASCAL_COMPONENT)) {
    const name = match[1] as string;
    if (EFFECT_WORDS.test(name)) names.add(name);
  }

  return [...names].sort();
}

export interface SourceFile {
  readonly path: string;
  readonly content: string;
}

/** Extensions worth reading. Anything else is not component markup. */
export const COMPONENT_EXTENSIONS: readonly string[] = [
  '.tsx',
  '.jsx',
  '.vue',
  '.svelte',
  '.astro',
  '.html',
];

/** Directories whose contents are a bundled copy of somebody else's style, not this repo's. */
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'dist', 'build', '.next', 'out', 'vendor']);

export function isComponentFile(path: string): boolean {
  const lower = path.toLowerCase();
  // Segments, not a substring match: `dist/Hero.tsx` has no leading slash, so `/dist/` missed it
  // and a repository's bundled output counted as its own markup.
  if (lower.split(/[/\\]/).some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  return COMPONENT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function fingerprintRepo(
  repo: string,
  spdx: string,
  files: readonly SourceFile[],
): RepoFingerprint {
  const classSets: ClassSet[] = [];
  const effectNames = new Set<string>();
  let filesScanned = 0;

  for (const file of files) {
    if (!isComponentFile(file.path)) continue;
    filesScanned += 1;
    classSets.push(...extractClassSets(file.content));
    for (const name of extractEffectNames(file.content)) effectNames.add(name);
  }

  return {
    repo,
    spdx,
    classSets,
    effectNames: [...effectNames].sort(),
    filesScanned,
  };
}

/**
 * A stable id for a class set, order-independent.
 *
 * Sorted before hashing because `rounded-2xl shadow-2xl` and `shadow-2xl rounded-2xl` are the same
 * decision written twice. Without the sort the corpus would count them as two patterns and neither
 * would cross its threshold.
 */
export function patternId(tokens: readonly string[]): string {
  return stableHash([...tokens].sort()).slice(0, 16);
}
