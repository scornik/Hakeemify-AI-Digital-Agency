/**
 * Grade records: what the grading CLI writes down.
 *
 * ARCHITECTURE §10 is unambiguous — an agent may build the grading CLI and may not grade. So
 * this module has no opinion about any rubric item. It takes answers a human typed, checks
 * that a human is attached to them, stamps `graded_by: "human"` **literally** rather than from
 * input, and appends the result to a ledger.
 *
 * The ledger is append-only and one line per reviewer, because v4 §11's family standards
 * require two reviewers per variant. A file per arrangement would have made the second
 * reviewer an edit to the first reviewer's record, which is the shape in which a disagreement
 * quietly disappears.
 *
 * Nothing here touches `signature_move` or `negative_example`. Those are *authoring* fields,
 * written when the variant is written, not when it is graded; folding them into the grading
 * flow would have put an agent-run CLI one prompt away from filling them in.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ArrangementId, SECTION_FAMILIES, VariantId, variantFamily } from '@ada/contract';
import { GRADES_DIR } from '../paths.js';
import { LibraryGrade, RUBRIC_KEYS, familyStandard } from '../manifest/index.js';

export const GRADE_LEDGER_FILENAME = 'ledger.jsonl';

export const Reviewer = z.object({
  /** A stable handle — a git identity, an email, a name. Non-empty is the whole requirement. */
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
});
export type Reviewer = z.infer<typeof Reviewer>;

export const GradeRecord = z.object({
  schema_version: z.literal(1),
  variant_id: VariantId,
  arrangement_id: ArrangementId,
  reviewer: Reviewer,
  recorded_at: z.string().min(1),
  /** The tool that collected it. Recorded so a ledger line is traceable to a session. */
  recorded_by_tool: z.string().min(1),
  grade: LibraryGrade.extend({
    // Literal. There is no code path in this package that writes anything else.
    graded_by: z.literal('human'),
  }),
});
export type GradeRecord = z.infer<typeof GradeRecord>;

export class GradeRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GradeRecordError';
  }
}

export interface BuildGradeRecordInput {
  readonly variant_id: string;
  readonly arrangement_id: string;
  readonly reviewer: { id: string; name: string };
  /** One boolean per key in `RUBRIC_KEYS`, as answered. */
  readonly rubric: Record<string, boolean>;
  /** One boolean per key in the family's `extra_rubric`, as answered. */
  readonly extra_rubric?: Record<string, boolean>;
  /** Pairwise within family. Entered by the reviewer; never computed here. */
  readonly elo: number;
  readonly now?: Date;
  readonly tool?: string;
}

/**
 * Turn collected answers into a record. Throws rather than filling a gap: an unanswered rubric
 * item is not `false`, it is an incomplete review, and defaulting it would produce a grade
 * nobody gave.
 */
export function buildGradeRecord(input: BuildGradeRecordInput): GradeRecord {
  const family = variantFamily(input.variant_id);
  if (family === null || !(SECTION_FAMILIES as readonly string[]).includes(family)) {
    throw new GradeRecordError(
      `"${input.variant_id}" is not a family/variant id in the closed family set`,
    );
  }
  if (input.reviewer.id.trim() === '' || input.reviewer.name.trim() === '') {
    throw new GradeRecordError('a grade needs the reviewer who gave it — id and name are required');
  }

  const rubric: Record<string, boolean> = {};
  for (const key of RUBRIC_KEYS) {
    const answer = input.rubric[key];
    if (typeof answer !== 'boolean') {
      throw new GradeRecordError(`rubric item "${key}" was not answered`);
    }
    rubric[key] = answer;
  }

  const standard = familyStandard(family as (typeof SECTION_FAMILIES)[number]);
  const extra_rubric: Record<string, boolean> = {};
  for (const key of standard.extra_rubric) {
    const answer = input.extra_rubric?.[key];
    if (typeof answer !== 'boolean') {
      throw new GradeRecordError(`extra rubric item "${key}" was not answered`);
    }
    extra_rubric[key] = answer;
  }

  const parsed = GradeRecord.safeParse({
    schema_version: 1,
    variant_id: input.variant_id,
    arrangement_id: input.arrangement_id,
    reviewer: { id: input.reviewer.id.trim(), name: input.reviewer.name.trim() },
    recorded_at: (input.now ?? new Date()).toISOString(),
    recorded_by_tool: input.tool ?? 'library:grade',
    grade: {
      rubric,
      extra_rubric,
      elo: input.elo,
      graded_at: (input.now ?? new Date()).toISOString(),
      graded_by: 'human',
    },
  });
  if (!parsed.success) {
    throw new GradeRecordError(
      z.prettifyError(parsed.error).split('\n').filter(Boolean).join('; '),
    );
  }
  return parsed.data;
}

export function gradeLedgerPath(dir: string = GRADES_DIR): string {
  return join(dir, GRADE_LEDGER_FILENAME);
}

/** Append one line. The ledger is never rewritten; a correction is a later line. */
export function appendGradeRecord(record: GradeRecord, dir: string = GRADES_DIR): string {
  const path = gradeLedgerPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(GradeRecord.parse(record))}\n`, 'utf8');
  return path;
}

export function readGradeLedger(dir: string = GRADES_DIR): GradeRecord[] {
  const path = gradeLedgerPath(dir);
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line, index) => {
      const parsed = GradeRecord.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new GradeRecordError(`${path}:${index + 1} is not a grade record`);
      }
      return parsed.data;
    });
}

/** Distinct reviewers who have graded a given arrangement. v4 §11 wants at least two. */
export function reviewersFor(
  ledger: readonly GradeRecord[],
  variant_id: string,
  arrangement_id: string,
): string[] {
  const ids = new Set<string>();
  for (const record of ledger) {
    if (record.variant_id === variant_id && record.arrangement_id === arrangement_id) {
      ids.add(record.reviewer.id);
    }
  }
  return [...ids].sort();
}
