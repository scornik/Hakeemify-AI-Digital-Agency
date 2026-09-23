/**
 * The interactive half of `pnpm library:grade`.
 *
 * Split from the entry point so the refusal is enforced before this module is even loaded (see
 * `bin/library-grade.mjs`), and split from `record.ts` so the recording logic is testable
 * without a terminal.
 *
 * The rule this file obeys, and the reason it exists at all: **it asks, it does not suggest.**
 * There is no default answer to a rubric item, no pre-filled ELO, no "looks fine?" phrasing. A
 * blank answer is re-asked, not taken as a no. ARCHITECTURE §8's tier 0 is the whole game, and
 * a tool that nudges a tired reviewer towards `y` is a tool that quietly grades for them.
 */
import { RUBRIC_KEYS, familyStandard } from '../manifest/index.js';
import { SECTION_FAMILIES, variantFamily, type SectionFamily } from '@ada/contract';
import { appendGradeRecord, buildGradeRecord, type GradeRecord } from './record.js';

export interface Prompter {
  /** Ask a free-text question. Returns the raw answer. */
  ask(question: string): Promise<string>;
  write(line: string): void;
}

export class GradingAborted extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradingAborted';
  }
}

const MAX_ATTEMPTS = 5;

async function askRequired(io: Prompter, question: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const answer = (await io.ask(question)).trim();
    if (answer !== '') return answer;
    io.write('  An answer is required.');
  }
  throw new GradingAborted(`no answer given for: ${question}`);
}

/**
 * Yes or no, with no default. `y`/`n` only — `yes`/`no` are accepted because people type them,
 * but Enter is not an answer.
 */
async function askBoolean(io: Prompter, question: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const answer = (await io.ask(`${question} [y/n] `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') return true;
    if (answer === 'n' || answer === 'no') return false;
    io.write('  Answer y or n. There is no default.');
  }
  throw new GradingAborted(`no answer given for: ${question}`);
}

async function askNumber(io: Prompter, question: string): Promise<number> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const raw = (await io.ask(question)).trim();
    const value = Number(raw);
    if (raw !== '' && Number.isFinite(value)) return value;
    io.write('  A number is required.');
  }
  throw new GradingAborted(`no number given for: ${question}`);
}

export interface GradingSessionOptions {
  readonly io: Prompter;
  /** Where the ledger lives. Defaults to the package's `assets/grades`. */
  readonly dir?: string;
  readonly now?: Date;
  /** Appends to the ledger. Injected so the session can be driven in a test. */
  readonly append?: (record: GradeRecord, dir?: string) => string;
}

/**
 * Run one grading session and append one ledger line.
 *
 * Every value in the resulting record came from an answer. Nothing here computes a grade,
 * suggests a rubric value, or writes `signature_move` / `negative_example` — those are
 * authoring fields, recorded when the variant is authored.
 */
export async function runGradingSession({
  io,
  dir,
  now,
  append = appendGradeRecord,
}: GradingSessionOptions): Promise<{ record: GradeRecord; path: string }> {
  io.write('');
  io.write('library:grade — recording a human grade (ARCHITECTURE §10).');
  io.write('Nothing is suggested and nothing is defaulted. Every answer is yours.');
  io.write('');

  const reviewerId = await askRequired(io, 'Reviewer id (git identity or email): ');
  const reviewerName = await askRequired(io, 'Reviewer name: ');
  const variantId = await askRequired(io, 'Variant id (family/variant): ');

  const family = variantFamily(variantId);
  if (family === null || !(SECTION_FAMILIES as readonly string[]).includes(family)) {
    throw new GradingAborted(`"${variantId}" is not a family/variant id in the closed family set`);
  }
  const standard = familyStandard(family as SectionFamily);

  const arrangementId = await askRequired(io, 'Arrangement id (lower-kebab-case): ');

  io.write('');
  io.write(`Rubric — v4 §11, all ${RUBRIC_KEYS.length} items, at both content extremes.`);
  const rubric: Record<string, boolean> = {};
  for (const key of RUBRIC_KEYS) {
    rubric[key] = await askBoolean(io, `  ${key}`);
  }

  const extra_rubric: Record<string, boolean> = {};
  if (standard.extra_rubric.length > 0) {
    io.write('');
    io.write(`Extra rubric — required for the "${family}" family.`);
    for (const key of standard.extra_rubric) {
      extra_rubric[key] = await askBoolean(io, `  ${key}`);
    }
  }

  io.write('');
  io.write('ELO is pairwise WITHIN this family. It is your number, not a computed one.');
  const elo = await askNumber(io, `  ELO for ${variantId}#${arrangementId}: `);

  const record = buildGradeRecord({
    variant_id: variantId,
    arrangement_id: arrangementId,
    reviewer: { id: reviewerId, name: reviewerName },
    rubric,
    extra_rubric,
    elo,
    ...(now === undefined ? {} : { now }),
  });

  const path = append(record, dir);
  io.write('');
  io.write(`Recorded as ${record.grade.graded_by} by ${record.reviewer.id} → ${path}`);
  io.write(`This family needs ${standard.reviewers} reviewers before the variant may go active.`);
  return { record, path };
}
