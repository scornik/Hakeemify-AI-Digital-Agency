import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GRADE_LEDGER_FILENAME,
  GradeRecordError,
  GradingAborted,
  LIBRARY_ROOT,
  RUBRIC_KEYS,
  appendGradeRecord,
  buildGradeRecord,
  readGradeLedger,
  reviewersFor,
  runGradingSession,
  type Prompter,
} from '../src/index.js';

const ENTRY = join(LIBRARY_ROOT, 'bin', 'library-grade.mjs');

const allTrue = () => Object.fromEntries(RUBRIC_KEYS.map((key) => [key, true]));

/** A scripted terminal. Answers are consumed in order; anything unanswered throws. */
function scriptedIo(answers: string[]): Prompter & { transcript: string[] } {
  const queue = [...answers];
  const transcript: string[] = [];
  return {
    transcript,
    write: (line) => transcript.push(line),
    ask: async (question) => {
      transcript.push(question);
      const answer = queue.shift();
      if (answer === undefined) throw new Error(`unscripted prompt: ${question}`);
      return answer;
    },
  };
}

describe('library:grade refuses to run non-interactively', () => {
  it('exits non-zero with a clear message when there is no TTY', () => {
    // The DoD assertion. Vitest spawns with pipes, so stdin/stdout are not terminals.
    const result = spawnSync(process.execPath, [ENTRY], {
      encoding: 'utf8',
      env: { ...process.env, CI: '' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('library:grade refuses to run non-interactively.');
    expect(result.stderr).toContain('stdin is not a terminal');
    expect(result.stderr).toContain('ARCHITECTURE.md §10');
    expect(result.stdout).toBe('');
  });

  it('names CI explicitly when CI is set', () => {
    const result = spawnSync(process.execPath, [ENTRY], {
      encoding: 'utf8',
      env: { ...process.env, CI: '1' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('CI is set in the environment');
  });

  it('refuses before importing anything, so a broken build still refuses', () => {
    // The entry point must not reach `dist/` on the refusal path: a crash is not a refusal.
    const source = readFileSync(ENTRY, 'utf8');
    const refusalAt = source.indexOf('process.exit(EXIT_REFUSED)');
    const firstImport = source.indexOf('await import(');
    expect(refusalAt).toBeGreaterThan(-1);
    expect(firstImport).toBeGreaterThan(refusalAt);
  });

  it('is reachable as a root script', () => {
    const pkg = JSON.parse(
      readFileSync(join(LIBRARY_ROOT, '..', '..', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts['library:grade']).toBeDefined();
    // Running it through the root script must refuse in exactly the same way.
    const result = spawnSync('node', [ENTRY], { encoding: 'utf8', shell: false });
    expect(result.status).toBe(2);
  });
});

describe('recording a grade', () => {
  it('requires the reviewer', () => {
    expect(() =>
      buildGradeRecord({
        variant_id: 'hero/founder_editorial',
        arrangement_id: 'portrait-left',
        reviewer: { id: '  ', name: 'Someone' },
        rubric: allTrue(),
        elo: 1500,
      }),
    ).toThrow(GradeRecordError);
  });

  it('writes graded_by: "human", literally', () => {
    const record = buildGradeRecord({
      variant_id: 'services/service_clarity_stack',
      arrangement_id: 'stacked',
      reviewer: { id: 'dana@example.com', name: 'Dana' },
      rubric: allTrue(),
      elo: 1500,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(record.grade.graded_by).toBe('human');
    expect(record.grade.graded_at).toBe('2026-01-01T00:00:00.000Z');
    expect(record.reviewer.id).toBe('dana@example.com');
  });

  it('refuses an unanswered rubric item rather than defaulting it to false', () => {
    const partial = allTrue();
    delete partial['readable_at_360px'];
    expect(() =>
      buildGradeRecord({
        variant_id: 'services/service_clarity_stack',
        arrangement_id: 'stacked',
        reviewer: { id: 'd', name: 'D' },
        rubric: partial,
        elo: 1500,
      }),
    ).toThrow(/"readable_at_360px" was not answered/);
  });

  it('refuses an unanswered family extra-rubric item', () => {
    expect(() =>
      buildGradeRecord({
        variant_id: 'hero/founder_editorial',
        arrangement_id: 'portrait-left',
        reviewer: { id: 'd', name: 'D' },
        rubric: allTrue(),
        elo: 1500,
      }),
    ).toThrow(/extra rubric item "works_with_4_word_headline" was not answered/);
  });

  it('refuses an id outside the closed family set', () => {
    expect(() =>
      buildGradeRecord({
        variant_id: 'marketing/banner',
        arrangement_id: 'plain',
        reviewer: { id: 'd', name: 'D' },
        rubric: allTrue(),
        elo: 1500,
      }),
    ).toThrow(GradeRecordError);
  });

  it('appends to a ledger, one line per reviewer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-grades-'));
    const base = {
      variant_id: 'services/service_clarity_stack',
      arrangement_id: 'stacked',
      rubric: allTrue(),
      elo: 1500,
    } as const;
    appendGradeRecord(buildGradeRecord({ ...base, reviewer: { id: 'a', name: 'A' } }), dir);
    const path = appendGradeRecord(
      buildGradeRecord({ ...base, reviewer: { id: 'b', name: 'B' } }),
      dir,
    );
    expect(path).toBe(join(dir, GRADE_LEDGER_FILENAME));

    const ledger = readGradeLedger(dir);
    expect(ledger).toHaveLength(2);
    expect(reviewersFor(ledger, 'services/service_clarity_stack', 'stacked')).toEqual(['a', 'b']);
    expect(reviewersFor(ledger, 'services/service_clarity_stack', 'two-column')).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads an absent ledger as empty and a corrupt one as an error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-grades-'));
    expect(readGradeLedger(dir)).toEqual([]);
    execFileSync(process.execPath, [
      '-e',
      `require('fs').writeFileSync(${JSON.stringify(join(dir, GRADE_LEDGER_FILENAME))}, '{"schema_version":1}\\n')`,
    ]);
    expect(() => readGradeLedger(dir)).toThrow(/is not a grade record/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the grading session asks and does not suggest', () => {
  const answers = (extra: string[] = []) => [
    'dana@example.com',
    'Dana',
    'services/service_clarity_stack',
    'stacked',
    ...RUBRIC_KEYS.map(() => 'y'),
    ...extra,
    '1512',
  ];

  it('collects every answer from the reviewer', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ada-grades-'));
    const io = scriptedIo(answers());
    const { record } = await runGradingSession({ io, dir, now: new Date('2026-02-02T00:00:00Z') });
    expect(record.grade.elo).toBe(1512);
    expect(record.grade.graded_by).toBe('human');
    expect(record.reviewer.name).toBe('Dana');
    expect(readGradeLedger(dir)).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('offers no default: a blank answer is re-asked, never taken as a no', async () => {
    const io = scriptedIo([
      'dana@example.com',
      'Dana',
      'services/service_clarity_stack',
      'stacked',
      '', // blank on the first rubric item
      'n', // then a real answer
      ...RUBRIC_KEYS.slice(1).map(() => 'y'),
      '1400',
    ]);
    const { record } = await runGradingSession({ io, append: () => '<not written>' });
    expect(record.grade.rubric[RUBRIC_KEYS[0]!]).toBe(false);
    expect(io.transcript).toContain('  Answer y or n. There is no default.');
    // No prompt hints at an expected answer: no capitalised default in the brackets, no
    // "press enter to accept", no reassurance that it probably passes.
    const transcript = io.transcript.join('\n');
    // Case matters here: `[y/n]` is neutral, `[Y/n]` is a nudge.
    expect(transcript).not.toMatch(/\[Y\/n]|\[y\/N]/);
    expect(transcript).toMatch(/\[y\/n]/);
    expect(transcript).not.toMatch(/looks fine|press enter|\(default|probably/i);
  });

  it('asks the hero family its extra rubric, and asks nothing extra of services', async () => {
    const heroIo = scriptedIo([
      'dana@example.com',
      'Dana',
      'hero/founder_editorial',
      'portrait-left',
      ...RUBRIC_KEYS.map(() => 'y'),
      ...new Array(6).fill('y'),
      '1600',
    ]);
    const hero = await runGradingSession({ io: heroIo, append: () => 'x' });
    expect(Object.keys(hero.record.grade.extra_rubric ?? {})).toEqual([
      'works_with_4_word_headline',
      'works_with_12_word_headline',
      'works_with_no_photo',
      'mobile_cta_visible_without_scroll',
      'lcp_element_is_text_or_preloaded_image',
      'holds_up_at_intensity_1.0',
    ]);

    const servicesIo = scriptedIo([
      'dana@example.com',
      'Dana',
      'services/service_clarity_stack',
      'stacked',
      ...RUBRIC_KEYS.map(() => 'y'),
      '1500',
    ]);
    const services = await runGradingSession({ io: servicesIo, append: () => 'x' });
    expect(services.record.grade.extra_rubric).toEqual({});
  });

  it('never writes signature_move or negative_example', async () => {
    const io = scriptedIo(answers());
    const { record } = await runGradingSession({ io, append: () => 'x' });
    expect(JSON.stringify(record)).not.toMatch(/signature_move|negative_example/);
    expect(io.transcript.join('\n')).not.toMatch(/signature move|negative example/i);
  });

  it('aborts rather than accepting silence', async () => {
    const io = scriptedIo(['', '', '', '', '', '']);
    await expect(runGradingSession({ io, append: () => 'x' })).rejects.toBeInstanceOf(
      GradingAborted,
    );
  });
});
