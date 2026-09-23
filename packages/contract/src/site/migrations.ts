/**
 * Migration harness (P1 DoD).
 *
 * A stored `SiteDefinition` is never silently reinterpreted: it carries the schema version it
 * was written at, and moving it forward is an explicit, ordered chain of pure
 * `(doc) => doc` steps. This is the mechanism behind v4 §12's promise that existing sites
 * never auto-migrate — migration is something a rebuild opts into, not something a deploy does.
 */
import { SITE_DEFINITION_SCHEMA_VERSION } from './site-definition.js';

export interface Migration {
  /** The version this migration reads. */
  readonly from: number;
  /** The version it writes. Must be `from + 1`; gaps hide missing steps. */
  readonly to: number;
  readonly description: string;
  readonly migrate: (doc: Record<string, unknown>) => Record<string, unknown>;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/**
 * The registered chain. Empty at v1 by construction: there is nothing before the first
 * version. Every future shape change appends exactly one entry and bumps
 * `SITE_DEFINITION_SCHEMA_VERSION`.
 */
export const MIGRATIONS: readonly Migration[] = [];

/** Validate the chain shape. Called by tests and at boot, so a bad chain fails loudly. */
export function assertMigrationChain(
  migrations: readonly Migration[] = MIGRATIONS,
  target: number = SITE_DEFINITION_SCHEMA_VERSION,
): void {
  let expected = 1;
  for (const migration of migrations) {
    if (migration.from !== expected) {
      throw new MigrationError(
        `migration chain is not contiguous: expected a step from ${expected}, found ${migration.from}`,
      );
    }
    if (migration.to !== migration.from + 1) {
      throw new MigrationError(
        `migration ${migration.from}->${migration.to} skips a version; steps must be single`,
      );
    }
    expected = migration.to;
  }
  if (expected !== target) {
    throw new MigrationError(
      `migration chain ends at ${expected} but the current schema version is ${target}`,
    );
  }
}

export interface MigrationResult {
  readonly document: Record<string, unknown>;
  readonly from: number;
  readonly to: number;
  readonly applied: readonly string[];
}

/**
 * Bring a document up to the current schema version. Refuses to guess: a document with no
 * version, or one from the future, is an error rather than an assumption.
 */
export function migrateSiteDefinition(
  document: unknown,
  options: { migrations?: readonly Migration[]; target?: number } = {},
): MigrationResult {
  const migrations = options.migrations ?? MIGRATIONS;
  const target = options.target ?? SITE_DEFINITION_SCHEMA_VERSION;

  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new MigrationError('a site definition must be an object');
  }

  const doc = { ...(document as Record<string, unknown>) };
  const rawVersion = doc['schema_version'];
  if (typeof rawVersion !== 'number' || !Number.isInteger(rawVersion)) {
    throw new MigrationError('a site definition must carry an integer schema_version');
  }
  if (rawVersion > target) {
    throw new MigrationError(
      `document is at schema_version ${rawVersion}, ahead of this build's ${target}; ` +
        'upgrade the code rather than downgrading the document',
    );
  }

  let current = doc;
  let version = rawVersion;
  const applied: string[] = [];

  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) {
      throw new MigrationError(`no migration registered from schema_version ${version}`);
    }
    current = { ...step.migrate(current), schema_version: step.to };
    applied.push(step.description);
    version = step.to;
  }

  return { document: current, from: rawVersion, to: version, applied };
}
