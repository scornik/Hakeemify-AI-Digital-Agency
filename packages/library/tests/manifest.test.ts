import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FAMILY_STANDARDS,
  LibraryLoadError,
  RUBRIC_KEYS,
  SECTIONS_DIR,
  SectionManifest,
  checkLibraryImports,
  checkManifestImports,
  eligibleArrangements,
  eligibleVariants,
  extractAstroFrontmatter,
  loadManifests,
  manifestPaths,
  packageNameOf,
  scanImportSpecifiers,
  statusIsSelectable,
} from '../src/index.js';
import { evaluatePredicates } from '@ada/contract';

const FIXTURE_LIBRARY = join(import.meta.dirname, 'fixtures', 'library', 'sections');
const DRIFT_LIBRARY = join(import.meta.dirname, 'fixtures', 'library-drift', 'sections');

const load = (root: string) => loadManifests(root);
const scaffold = () => load(FIXTURE_LIBRARY)[0]!.manifest;

/**
 * A grade is a human artefact (ARCHITECTURE §10). This one is obviously synthetic and exists
 * only inside the test process, to exercise the accept branch of the entry gate. Nothing
 * constructs it outside this file, and a separate test asserts that nothing under `assets/`
 * carries a grade at all.
 */
const NOT_A_REAL_GRADE = (extra: Record<string, boolean> = {}) => ({
  rubric: Object.fromEntries(RUBRIC_KEYS.map((key) => [key, true])),
  extra_rubric: extra,
  elo: 1500,
  graded_at: '2026-01-01',
  graded_by: 'human' as const,
});

describe('boot validation', () => {
  it('loads the fixture library and validates its ids against the strict grammar', () => {
    const loaded = load(FIXTURE_LIBRARY);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.manifest.name).toBe('services/service_clarity_stack');
    expect(loaded[0]!.manifest.family).toBe('services');
    expect(manifestPaths(FIXTURE_LIBRARY)).toHaveLength(1);
  });

  it('accumulates every problem rather than stopping at the first', () => {
    let thrown: LibraryLoadError | undefined;
    try {
      SectionManifest.parse({});
    } catch {
      /* the loader path is what we want; this is only to prove the schema is strict */
    }
    try {
      // Two manifests, both broken in more than one way, through the loader.
      load(join(import.meta.dirname, 'fixtures', 'library-broken', 'sections'));
    } catch (error) {
      thrown = error as LibraryLoadError;
    }
    expect(thrown).toBeInstanceOf(LibraryLoadError);
    expect(thrown!.problems.length).toBeGreaterThan(1);
  });

  it('rejects an id that does not match the strict variant grammar', () => {
    const base = structuredClone(scaffold()) as Record<string, unknown>;
    base['name'] = 'ServicesClarity';
    const result = SectionManifest.safeParse(base);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toMatch(/family\/variant/);
  });

  it('rejects a manifest whose family disagrees with its id', () => {
    const base = structuredClone(scaffold()) as Record<string, unknown>;
    base['family'] = 'hero';
    const result = SectionManifest.safeParse(base);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toMatch(/does not match the family half/);
  });

  it('rejects a `requires` string that does not parse under the predicate grammar', () => {
    const base = structuredClone(scaffold()) as Record<string, unknown>;
    base['requires'] = ['count(proof.testimonials[attributable]) >= '];
    const result = SectionManifest.safeParse(base);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error)).toMatch(/predicate does not parse/);
  });

  it('accepts a `requires` string the contract parser accepts', () => {
    const base = structuredClone(scaffold()) as Record<string, unknown>;
    base['requires'] = ['count(media.photos[rights != "unknown" && grade_safe]) >= 6'];
    expect(SectionManifest.safeParse(base).success).toBe(true);
  });
});

describe('the tier-0 entry gate is a schema rule, not a review convention', () => {
  it('refuses a scaffold that carries a grade or a signature move', () => {
    const graded = structuredClone(scaffold()) as any;
    graded.arrangements[0].grade = NOT_A_REAL_GRADE();
    const gradedResult = SectionManifest.safeParse(graded);
    expect(gradedResult.success).toBe(false);
    expect(JSON.stringify(gradedResult.error)).toMatch(/scaffold arrangement must be `ungraded`/);

    const named = structuredClone(scaffold()) as any;
    named.arrangements[0].signature_move = 'anything at all';
    expect(JSON.stringify(SectionManifest.safeParse(named).error)).toMatch(
      /only a human names one/,
    );
  });

  it('refuses an active variant with no authoring record', () => {
    const active = structuredClone(scaffold()) as any;
    active.status = 'active';
    const error = JSON.stringify(SectionManifest.safeParse(active).error);
    expect(error).toMatch(/needs an authoring record/);
    expect(error).toMatch(/must be graded/);
  });

  it('enforces the family minimum arrangements and reviewer count (v4 §11)', () => {
    const active = structuredClone(scaffold()) as any;
    active.status = 'active';
    active.authoring = {
      signature_move: 'x',
      negative_example: { screenshot: 'x.png', why_rejected: 'x' },
      author: 'x',
      authored_at: '2026-01-01',
      reviewed_by: ['one'],
    };
    for (const arrangement of active.arrangements) {
      arrangement.signature_move = 'x';
      arrangement.grade = NOT_A_REAL_GRADE();
    }
    const error = JSON.stringify(SectionManifest.safeParse(active).error);
    // `services` falls to the default standard: 3 arrangements, 2 reviewers. The fixture has 2 and 1.
    expect(FAMILY_STANDARDS.services.min_arrangements).toBe(3);
    expect(error).toMatch(/needs at least 3 arrangements/);
    expect(error).toMatch(/needs 2 reviewers/);
  });

  it('enforces the hero extra rubric, which the default families do not have', () => {
    expect(FAMILY_STANDARDS.hero.min_arrangements).toBe(5);
    expect(FAMILY_STANDARDS.hero.extra_rubric).toContain('works_with_no_photo');
    expect(FAMILY_STANDARDS.services.extra_rubric).toHaveLength(0);
  });

  it('accepts an active variant only when every rubric item is true', () => {
    const active = structuredClone(scaffold()) as any;
    active.status = 'active';
    active.authoring = {
      signature_move: 'x',
      negative_example: { screenshot: 'x.png', why_rejected: 'x' },
      author: 'x',
      authored_at: '2026-01-01',
      reviewed_by: ['one', 'two'],
    };
    active.arrangements = [0, 1, 2].map((index) => ({
      id: `fixture-${index}`,
      novelty_class: `n${index}`,
      signature_move: 'x',
      grade: NOT_A_REAL_GRADE(),
    }));
    expect(SectionManifest.safeParse(active).success).toBe(true);

    active.arrangements[1].grade.rubric.readable_at_360px = false;
    const failed = SectionManifest.safeParse(active);
    expect(failed.success).toBe(false);
    expect(failed.error!.issues.map((issue) => issue.message)).toContain(
      'rubric item "readable_at_360px" is not true',
    );
  });

  it('refuses a `measured` prior with no evidence', () => {
    const base = structuredClone(scaffold()) as any;
    base.priors = { status: 'measured' };
    expect(JSON.stringify(SectionManifest.safeParse(base).error)).toMatch(
      /must carry its evidence/,
    );
  });
});

describe('the ts-morph import scan', () => {
  it('extracts an .astro frontmatter fence and nothing after it', () => {
    const fence = extractAstroFrontmatter('---\nimport { a } from "b";\n---\n<p>not TS</p>\n');
    expect(fence!.code).toBe('import { a } from "b";\n');
    expect(fence!.startLine).toBe(2);
  });

  it('returns null for a markup-only component, which is legal Astro', () => {
    expect(extractAstroFrontmatter('<p>hello</p>')).toBeNull();
    expect(extractAstroFrontmatter('---\nnever closed\n')).toBeNull();
  });

  it('finds static, type-only, re-exported and dynamic imports', () => {
    const found = scanImportSpecifiers(`
      import a from 'alpha';
      import type { B } from 'bravo';
      export { c } from 'charlie';
      const d = await import('delta');
      import 'node:fs';
    `);
    expect(new Set(found)).toEqual(new Set(['alpha', 'bravo', 'charlie', 'delta', 'node:fs']));
  });

  it('reduces a subpath specifier to its package name', () => {
    expect(packageNameOf('zod/v4')).toBe('zod');
    expect(packageNameOf('@ada/contract')).toBe('@ada/contract');
    expect(packageNameOf('@ada/contract/predicate')).toBe('@ada/contract');
  });

  it('passes a manifest that tells the truth', () => {
    expect(checkLibraryImports(load(FIXTURE_LIBRARY))).toEqual([]);
  });

  it('CATCHES a manifest that omits a real import', () => {
    // The DoD assertion. `js-yaml` is imported and undeclared; `./lib/missing-helper.js` is
    // imported and absent from files[].
    const problems = checkLibraryImports(load(DRIFT_LIBRARY));
    expect(problems.length).toBeGreaterThanOrEqual(2);

    const missingDependency = problems.find((p) => p.kind === 'missing_dependency');
    expect(missingDependency).toBeDefined();
    expect(missingDependency!.specifier).toBe('js-yaml');
    expect(missingDependency!.manifest).toBe('hero/omits_import');
    expect(missingDependency!.message).toMatch(/does not declare the dependency "js-yaml"/);

    const undeclaredFile = problems.find((p) => p.kind === 'undeclared_file');
    expect(undeclaredFile).toBeDefined();
    expect(undeclaredFile!.specifier).toBe('./lib/missing-helper.js');
    expect(undeclaredFile!.message).toMatch(/files\[\] does not declare/);
  });

  it('resolves a `.js` specifier to the `.ts` on disk, as TypeScript ESM means it', () => {
    // The passing fixture imports './lib/format.js' and declares 'lib/format.ts'.
    expect(checkLibraryImports(load(FIXTURE_LIBRARY))).toEqual([]);
  });

  it('reports a declared file that is not on disk', () => {
    const entry = load(FIXTURE_LIBRARY)[0]!;
    const manifest = structuredClone(entry.manifest);
    (manifest.files as { path: string; type: string }[]).push({
      path: 'nope.astro',
      type: 'registry:section',
    });
    const problems = checkManifestImports(manifest, { dir: entry.dir });
    expect(problems.map((p) => p.kind)).toContain('missing_file');
  });

  it('reports an unused dependency when asked, and not otherwise', () => {
    const entry = load(FIXTURE_LIBRARY)[0]!;
    const manifest = structuredClone(entry.manifest);
    (manifest.dependencies as string[]).push('never-imported');
    expect(checkManifestImports(manifest, { dir: entry.dir })).toEqual([]);
    const strict = checkManifestImports(manifest, { dir: entry.dir, reportUnused: true });
    expect(strict.map((p) => p.specifier)).toContain('never-imported');
  });
});

describe('eligibility', () => {
  it('EXCLUDES scaffold variants from a non-fixture build', () => {
    // The DoD assertion, and the reason this module exists (ARCHITECTURE §10).
    const manifests = load(FIXTURE_LIBRARY).map((entry) => entry.manifest);
    expect(manifests.every((m) => m.status === 'scaffold')).toBe(true);

    const client = eligibleVariants(manifests, { build: 'client' });
    expect(client.eligible).toEqual([]);
    expect(client.ruled_out).toHaveLength(1);
    expect(client.ruled_out[0]!.failed).toMatch(/status == "scaffold"/);

    const fixture = eligibleVariants(manifests, { build: 'fixture' });
    expect(fixture.eligible.map((m) => m.name)).toEqual(['services/service_clarity_stack']);
  });

  it('defaults to a client build, so a caller who forgets gets the safe answer', () => {
    const manifests = load(FIXTURE_LIBRARY).map((entry) => entry.manifest);
    expect(eligibleVariants(manifests).eligible).toEqual([]);
  });

  it('never selects a frozen or retired variant, on any build kind', () => {
    for (const build of ['client', 'fixture'] as const) {
      expect(statusIsSelectable('frozen', build)).toBe(false);
      expect(statusIsSelectable('retired', build)).toBe(false);
      expect(statusIsSelectable('active', build)).toBe(true);
    }
    expect(statusIsSelectable('scaffold', 'client')).toBe(false);
    expect(statusIsSelectable('scaffold', 'fixture')).toBe(true);
  });

  it('rules a variant out on an unsatisfied `requires`, reporting the measured value', () => {
    const manifest = structuredClone(scaffold()) as any;
    manifest.status = 'active';
    manifest.requires = ['count(proof.testimonials) >= 3'];
    const snapshot = evaluatePredicates(manifest.requires, { proof: { testimonials: [] } });
    const result = eligibleVariants([manifest], { build: 'client', snapshot });
    expect(result.eligible).toEqual([]);
    expect(result.ruled_out[0]).toEqual({
      id: 'services/service_clarity_stack',
      failed: 'count(proof.testimonials) >= 3',
      actual: 0,
    });
  });

  it('rules a variant out on design and positioning compatibility', () => {
    const manifest = structuredClone(scaffold()) as any;
    manifest.status = 'active';
    manifest.positioning_compat = ['premium'];
    expect(
      eligibleVariants([manifest], { designSystemId: 'editorial_v3' }).ruled_out[0]!.failed,
    ).toMatch(/design_compat\.systems/);
    expect(
      eligibleVariants([manifest], {
        designSystemId: 'reference_v1',
        positioningId: 'volume_value',
      }).ruled_out[0]!.failed,
    ).toMatch(/positioning_compat/);
    expect(
      eligibleVariants([manifest], { designSystemId: 'reference_v1', positioningId: 'premium' })
        .eligible,
    ).toHaveLength(1);
  });

  it('filters arrangements on their own `requires`', () => {
    const manifest = structuredClone(scaffold()) as any;
    manifest.arrangements[1].requires = ['count(media.photos) >= 2'];
    const snapshot = evaluatePredicates(['count(media.photos) >= 2'], { media: { photos: [] } });
    expect(eligibleArrangements(manifest, snapshot).map((a: { id: string }) => a.id)).toEqual([
      'stacked',
    ]);
    expect(eligibleArrangements(manifest)).toHaveLength(2);
  });
});

describe('the authored library', () => {
  it('contains no graded content, because a human has not authored any yet', () => {
    // ARCHITECTURE §10 and §9 P7. If this ever fails, something machine-authored has been
    // presented as library content.
    const loaded = loadManifests(SECTIONS_DIR);
    expect(loaded.filter((entry) => entry.manifest.status === 'active')).toEqual([]);
    expect(checkLibraryImports(loaded)).toEqual([]);
  });
});
