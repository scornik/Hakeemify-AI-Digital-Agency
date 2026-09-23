import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_INDEX,
  REFERENCE_PROJECTS,
  ReferenceIndexError,
  ReferenceIndexFile,
  buildReferenceIndex,
  loadManifests,
  missingReferences,
  parseQualifiedArrangementId,
  qualifyArrangementId,
  readReferenceIndex,
  referenceCoverage,
  referenceKeyString,
  referencePath,
  requiredReferenceKeys,
  resolveReference,
  writeReferenceIndex,
} from '../src/index.js';

const FIXTURE_LIBRARY = join(import.meta.dirname, 'fixtures', 'library', 'sections');

const entry = (over: Partial<Record<string, unknown>> = {}) => ({
  arrangement_id: 'hero/founder_editorial#portrait-left',
  design_system_id: 'reference_v1',
  project: 'desktop-chrome' as const,
  path: 'reference_v1/hero/founder_editorial/portrait-left/desktop-chrome.png',
  sha256: 'a'.repeat(64),
  width: 1280,
  height: 900,
  captured_at: '2026-01-01T00:00:00.000Z',
  library_sha: 'a7f31c2',
  ...over,
});

describe('addressing', () => {
  it('keys on (arrangement, design_system, project), with the arrangement qualified', () => {
    const qualified = qualifyArrangementId('hero/founder_editorial', 'portrait-left');
    expect(qualified).toBe('hero/founder_editorial#portrait-left');
    expect(parseQualifiedArrangementId(qualified)).toEqual({
      variant_id: 'hero/founder_editorial',
      family: 'hero',
      variant: 'founder_editorial',
      arrangement_id: 'portrait-left',
    });
  });

  it('refuses ids outside the contract grammar', () => {
    expect(() => qualifyArrangementId('Hero/Founder', 'portrait-left')).toThrow(/qualified/);
    expect(() => qualifyArrangementId('hero/founder_editorial', 'Portrait_Left')).toThrow();
    expect(parseQualifiedArrangementId('hero/founder_editorial')).toBeNull();
    expect(parseQualifiedArrangementId('portrait-left')).toBeNull();
  });

  it('resolves a key to the path template', () => {
    expect(
      referencePath({
        arrangement_id: 'hero/founder_editorial#portrait-left',
        design_system_id: 'reference_v1',
        project: 'mobile-safari',
      }),
    ).toBe('reference_v1/hero/founder_editorial/portrait-left/mobile-safari.png');
  });

  it('covers the five Playwright projects ARCHITECTURE §7.2 names', () => {
    expect([...REFERENCE_PROJECTS]).toEqual([
      'desktop-chrome',
      'mobile-safari',
      'tablet',
      'reduced-motion',
      'dark',
    ]);
  });

  it('throws on an unaddressable key, because that is a programming error', () => {
    expect(() =>
      referencePath({
        arrangement_id: 'nonsense',
        design_system_id: 'reference_v1',
        project: 'dark',
      }),
    ).toThrow(/qualified arrangement id/);
    expect(() =>
      referencePath({
        arrangement_id: 'hero/a#b',
        design_system_id: 'reference_v1',
        project: 'widescreen' as never,
      }),
    ).toThrow(/is not a reference project/);
  });
});

describe('the storage contract', () => {
  it('rejects an entry whose path does not match the template', () => {
    const bad = ReferenceIndexFile.safeParse({
      schema_version: 1,
      entries: [entry({ path: 'somewhere/else.png' })],
    });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error)).toMatch(/does not match the template/);
  });

  it('rejects two entries claiming the same key', () => {
    const bad = ReferenceIndexFile.safeParse({
      schema_version: 1,
      entries: [entry(), entry({ sha256: 'b'.repeat(64) })],
    });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error)).toMatch(/two references claim the key/);
  });

  it('requires a real sha and a library pin, so a reference is traceable to a commit', () => {
    expect(
      ReferenceIndexFile.safeParse({ schema_version: 1, entries: [entry({ sha256: 'nope' })] })
        .success,
    ).toBe(false);
    expect(
      ReferenceIndexFile.safeParse({ schema_version: 1, entries: [entry({ library_sha: 'zz' })] })
        .success,
    ).toBe(false);
  });
});

describe('resolution and missing references', () => {
  const index = buildReferenceIndex(
    ReferenceIndexFile.parse({ schema_version: 1, entries: [entry()] }),
  );

  it('finds a reference that exists', () => {
    const resolved = resolveReference(index, {
      arrangement_id: 'hero/founder_editorial#portrait-left',
      design_system_id: 'reference_v1',
      project: 'desktop-chrome',
    });
    expect(resolved.found).toBe(true);
    expect(resolved.path).toBe(
      'reference_v1/hero/founder_editorial/portrait-left/desktop-chrome.png',
    );
  });

  it('REPORTS a missing reference rather than throwing', () => {
    // The gate's job on a gap is to record it and carry on collecting.
    const key = {
      arrangement_id: 'hero/founder_editorial#portrait-left',
      design_system_id: 'reference_v1',
      project: 'dark',
    } as const;
    const resolved = resolveReference(index, key);
    expect(resolved.found).toBe(false);
    expect(resolved.path).toBe('reference_v1/hero/founder_editorial/portrait-left/dark.png');
    expect(resolved.found === false && resolved.reason).toMatch(/no reference render for/);
    expect(referenceKeyString(key)).toBe('reference_v1|hero/founder_editorial#portrait-left|dark');
  });

  it('enumerates the full grid a build needs', () => {
    const required = requiredReferenceKeys(
      [
        { variant_id: 'hero/founder_editorial', arrangement_id: 'portrait-left' },
        { variant_id: 'hero/founder_editorial', arrangement_id: 'full-bleed' },
      ],
      ['reference_v1', 'editorial_v3'],
    );
    expect(required).toHaveLength(2 * 2 * 5);
    expect(missingReferences(index, required)).toHaveLength(19);
  });

  it('reports coverage, including references nothing requires any more', () => {
    const required = requiredReferenceKeys(
      [{ variant_id: 'hero/other_variant', arrangement_id: 'plain' }],
      ['reference_v1'],
      ['dark'],
    );
    const coverage = referenceCoverage(index, required);
    expect(coverage).toMatchObject({ required: 1, present: 0 });
    expect(coverage.missing).toHaveLength(1);
    // The entry in the index is for an arrangement nothing required: a retired one leaves these.
    expect(coverage.orphaned).toHaveLength(1);
  });

  it('builds the grid from real manifests', () => {
    const loaded = loadManifests(FIXTURE_LIBRARY);
    const refs = loaded.flatMap((item) =>
      item.manifest.arrangements.map((arrangement) => ({
        variant_id: item.manifest.name,
        arrangement_id: arrangement.id,
      })),
    );
    const required = requiredReferenceKeys(refs, ['reference_v1']);
    expect(required).toHaveLength(2 * 5);
    expect(required[0]!.arrangement_id).toBe('services/service_clarity_stack#stacked');
  });
});

describe('the index on disk', () => {
  it('treats an absent index as empty, not as an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-refs-'));
    expect(readReferenceIndex(dir).byKey.size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips through disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-refs-'));
    const path = writeReferenceIndex(
      ReferenceIndexFile.parse({ schema_version: 1, entries: [entry()] }),
      dir,
    );
    expect(path).toBe(join(dir, 'index.json'));
    const index = readReferenceIndex(dir);
    expect(index.byKey.size).toBe(1);
    expect(index.schema_version).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to write an index that does not satisfy the storage contract', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-refs-'));
    expect(() =>
      writeReferenceIndex(
        { schema_version: 1, entries: [entry({ path: 'wrong.png' })] } as never,
        dir,
      ),
    ).toThrow(ReferenceIndexError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports a corrupt index rather than silently treating it as empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-refs-'));
    writeFileSync(join(dir, 'index.json'), '{not json', 'utf8');
    expect(() => readReferenceIndex(dir)).toThrow(/not valid JSON/);
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ schema_version: 1, entries: [{}] }));
    expect(() => readReferenceIndex(dir)).toThrow(ReferenceIndexError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('starts from a well-formed empty index', () => {
    expect(ReferenceIndexFile.safeParse(EMPTY_INDEX).success).toBe(true);
  });
});
