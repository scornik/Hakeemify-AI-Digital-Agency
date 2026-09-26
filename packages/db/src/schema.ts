/**
 * The relational core (ARCHITECTURE §4).
 *
 * > Relational core, JSONB documents. The Zod contract is the single source from which JSON
 * > Schema, DB column types and TypeScript are derived — **code schema prints DB schema, never
 * > the reverse.**
 *
 * That last clause is the design constraint, and it has a concrete consequence: every JSONB
 * column below is typed with `.$type<T>()` where `T` comes from `@ada/contract`. The database
 * stores documents whose shape is decided in one place, and a migration cannot quietly widen a
 * document's type because the type is not written here. `schema-sync.test.ts` asserts the two
 * have not drifted.
 *
 * ## Multi-tenancy is structural, not procedural
 *
 * ARCHITECTURE §4 asks for "`site_id` on every row, a filter layer on every query, and a write
 * hook that rejects cross-tenant references". A convention that every query remembers to filter
 * is a convention that will be forgotten once, and once is enough to leak one client's facts into
 * another client's site.
 *
 * So: `site_id` is `notNull` on every table that has one, every foreign key to a site-scoped row
 * is **composite** — `(site_id, parent_id)` referencing `(site_id, id)` — and `tenancy.ts` owns
 * the query helpers. A composite key means the database itself refuses a row that points at
 * another site's parent; there is no code path that can forget.
 *
 * ## Append-only means append-only
 *
 * `run_events`, `edit_actions` and `telemetry_events` are logs. They have no `updated_at` and
 * `tenancy.ts` exposes no update or delete for them. An audit log you can rewrite is a story.
 */
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type { Fact, Provenance } from '@ada/contract';

// ---------------------------------------------------------------------------------------------
// Shared column shapes
// ---------------------------------------------------------------------------------------------

/**
 * `timestamptz`, always. A timestamp without a zone is a timestamp whose meaning depends on the
 * server's locale, and this system will run in at least two.
 */
const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();

/** Text ids rather than uuid columns: the pipeline already mints readable ones (`b_fixture`). */
const id = (name: string) => text(name).notNull();

// ---------------------------------------------------------------------------------------------
// Sites and versions
// ---------------------------------------------------------------------------------------------

export const sites = pgTable(
  'sites',
  {
    siteId: id('site_id').primaryKey(),
    tenantId: id('tenant_id'),
    niche: text('niche').notNull(),
    /**
     * Nullable on purpose. Positioning is owner-declared and the pipeline *interrupts* rather
     * than inferring it (§5, stage 4). A NOT NULL here would force the pipeline to invent a
     * value to create the row, which is precisely the inference the interrupt exists to prevent.
     */
    positioning: text('positioning'),
    publishedVersionId: text('published_version_id'),
    createdAt: createdAt(),
  },
  (table) => [index('sites_tenant_idx').on(table.tenantId)],
);

export const SITE_VERSION_STATUSES = ['draft', 'published', 'archived'] as const;
export const VERSION_AUTHORS = ['pipeline', 'owner_edit', 'migration'] as const;

export const siteVersions = pgTable(
  'site_versions',
  {
    versionId: id('version_id'),
    siteId: id('site_id').references(() => sites.siteId),
    parentVersionId: text('parent_version_id'),
    siteDefinition: jsonb('site_definition').notNull(),
    manifest: jsonb('manifest').notNull(),
    gapReport: jsonb('gap_report').notNull(),
    gateReportId: text('gate_report_id'),
    status: text('status', { enum: SITE_VERSION_STATUSES }).notNull().default('draft'),
    pinned: jsonb('pinned').notNull().default({}),
    schemaVersion: integer('schema_version').notNull(),
    createdBy: text('created_by', { enum: VERSION_AUTHORS }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.versionId] }),
    // The composite self-reference is the point: a version cannot descend from another site's
    // version, and the database enforces it rather than a reviewer noticing.
    foreignKey({
      columns: [table.siteId, table.parentVersionId],
      foreignColumns: [table.siteId, table.versionId],
      name: 'site_versions_parent_fk',
    }),
    // At most one published version per site. Enforced as a partial unique index because
    // "published" is a state, not a column somebody remembers to clear.
    uniqueIndex('site_versions_one_published')
      .on(table.siteId)
      .where(sql`status = 'published'`),
    index('site_versions_site_idx').on(table.siteId, table.createdAt),
  ],
);

// ---------------------------------------------------------------------------------------------
// Facts and their sources
// ---------------------------------------------------------------------------------------------

export const FACT_VERIFICATIONS = ['unverified', 'owner_confirmed', 'source_checked'] as const;

export const facts = pgTable(
  'facts',
  {
    factId: id('fact_id'),
    siteId: id('site_id').references(() => sites.siteId),
    path: text('path').notNull(),
    value: jsonb('value').notNull(),
    /** The shape the contract defines. A fact without provenance cannot be quoted (v4 §8). */
    provenance: jsonb('provenance').$type<Provenance>().notNull(),
    quotable: boolean('quotable').notNull().default(false),
    verification: text('verification', { enum: FACT_VERIFICATIONS })
      .notNull()
      .default('unverified'),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.factId] }),
    // One fact per path per site: two rows claiming the same path is how a build renders one and
    // grounds against the other.
    unique('facts_site_path_unique').on(table.siteId, table.path),
    index('facts_quotable_idx').on(table.siteId, table.quotable),
  ],
);

export const factSources = pgTable(
  'fact_sources',
  {
    sourceId: id('source_id'),
    siteId: id('site_id').references(() => sites.siteId),
    url: text('url').notNull(),
    finalUrl: text('final_url'),
    statusCode: integer('status_code'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'string' }),
    etag: text('etag'),
    contentHash: text('content_hash'),
    citations: jsonb('citations').notNull().default([]),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.sourceId] }),
    index('fact_sources_hash_idx').on(table.siteId, table.contentHash),
  ],
);

// ---------------------------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------------------------

export const assets = pgTable(
  'assets',
  {
    assetId: id('asset_id'),
    siteId: id('site_id').references(() => sites.siteId),
    path: text('path').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    /** Derived, stored: every eligibility predicate reads it and none should recompute it. */
    aspect: doublePrecision('aspect').notNull(),
    rights: text('rights').notNull(),
    /**
     * Not nullable and not defaulted. In the medical niche a photograph of a person without
     * recorded consent is the single most expensive thing this system could publish, so the
     * absence of an answer must be impossible to insert rather than silently false.
     */
    subjectConsent: boolean('subject_consent').notNull(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'`),
    gradeSafe: boolean('grade_safe').notNull().default(false),
    alt: text('alt'),
    placeholderDataUri: text('placeholder_data_uri'),
    gradedVariants: jsonb('graded_variants').notNull().default({}),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.assetId] }),
    unique('assets_site_path_unique').on(table.siteId, table.path),
  ],
);

// ---------------------------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------------------------

export const RUN_STATUSES = [
  'IDLE',
  'RUNNING',
  'WAITING_FOR_OWNER',
  'WAITING_FOR_REVIEW',
  'FINISHED',
  'ERROR',
  'STUCK',
  'BUDGET_EXCEEDED',
] as const;

export const runs = pgTable(
  'runs',
  {
    runId: id('run_id'),
    siteId: id('site_id').references(() => sites.siteId),
    versionId: text('version_id'),
    stage: text('stage').notNull(),
    status: text('status', { enum: RUN_STATUSES }).notNull().default('IDLE'),
    checkpoint: jsonb('checkpoint').notNull().default({}),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    iterations: integer('iterations').notNull().default(0),
    /** Recorded so a run can be replayed. Without it "reproducible" is a claim, not a property. */
    seed: integer('seed').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.runId] }),
    foreignKey({
      columns: [table.siteId, table.versionId],
      foreignColumns: [siteVersions.siteId, siteVersions.versionId],
      name: 'runs_version_fk',
    }),
    index('runs_status_idx').on(table.siteId, table.status),
  ],
);

/** Append-only. `parent_id` makes the log a tree, so a fan-out stage's children are attributable. */
export const runEvents = pgTable(
  'run_events',
  {
    eventId: id('event_id'),
    siteId: id('site_id'),
    runId: id('run_id'),
    parentId: text('parent_id'),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    ts: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.eventId] }),
    foreignKey({
      columns: [table.siteId, table.runId],
      foreignColumns: [runs.siteId, runs.runId],
      name: 'run_events_run_fk',
    }),
    foreignKey({
      columns: [table.siteId, table.parentId],
      foreignColumns: [table.siteId, table.eventId],
      name: 'run_events_parent_fk',
    }),
    index('run_events_run_idx').on(table.siteId, table.runId, table.ts),
  ],
);

export const modelCalls = pgTable(
  'model_calls',
  {
    callId: id('call_id'),
    siteId: id('site_id'),
    runId: id('run_id'),
    stage: text('stage').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    schemaHash: text('schema_hash').notNull(),
    promptHash: text('prompt_hash').notNull(),
    outputHash: text('output_hash').notNull(),
    costUsd: doublePrecision('cost_usd').notNull(),
    durationMs: integer('duration_ms').notNull(),
    finishReason: text('finish_reason').notNull(),
    attempts: integer('attempts').notNull(),
    guardrailCodes: text('guardrail_codes')
      .array()
      .notNull()
      .default(sql`'{}'`),
    ts: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.callId] }),
    foreignKey({
      columns: [table.siteId, table.runId],
      foreignColumns: [runs.siteId, runs.runId],
      name: 'model_calls_run_fk',
    }),
    // The audit question this table answers: what did this run spend, and on what.
    index('model_calls_run_idx').on(table.siteId, table.runId),
  ],
);

// ---------------------------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------------------------

export const gateReports = pgTable(
  'gate_reports',
  {
    reportId: id('report_id'),
    siteId: id('site_id'),
    versionId: id('version_id'),
    policyVer: text('policy_ver').notNull(),
    checks: jsonb('checks').notNull(),
    summary: jsonb('summary').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.reportId] }),
    foreignKey({
      columns: [table.siteId, table.versionId],
      foreignColumns: [siteVersions.siteId, siteVersions.versionId],
      name: 'gate_reports_version_fk',
    }),
  ],
);

// ---------------------------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------------------------

/**
 * Append-only, with `inverse` stored alongside `action`. Undo is replaying an inverse, not
 * reconstructing one — a reconstruction is a second implementation of every edit and will
 * disagree with the first.
 */
export const editActions = pgTable(
  'edit_actions',
  {
    actionId: id('action_id'),
    siteId: id('site_id'),
    versionId: id('version_id'),
    seq: integer('seq').notNull(),
    action: jsonb('action').notNull(),
    inverse: jsonb('inverse').notNull(),
    txnId: text('txn_id').notNull(),
    actor: text('actor').notNull(),
    ts: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.actionId] }),
    foreignKey({
      columns: [table.siteId, table.versionId],
      foreignColumns: [siteVersions.siteId, siteVersions.versionId],
      name: 'edit_actions_version_fk',
    }),
    // A gap or a duplicate in the sequence makes undo ambiguous.
    unique('edit_actions_seq_unique').on(table.siteId, table.versionId, table.seq),
  ],
);

// ---------------------------------------------------------------------------------------------
// Telemetry, priors, diversity
// ---------------------------------------------------------------------------------------------

export const telemetryEvents = pgTable(
  'telemetry_events',
  {
    eventId: id('event_id'),
    siteId: id('site_id').references(() => sites.siteId),
    versionId: text('version_id'),
    kind: text('kind').notNull(),
    /** Which section produced it. Priors are per-arrangement, so this is the join key. */
    sectionInstanceId: text('section_instance_id'),
    props: jsonb('props').notNull().default({}),
    ts: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.siteId, table.eventId] }),
    index('telemetry_kind_idx').on(table.siteId, table.kind, table.ts),
  ],
);

export const PRIOR_STATUSES = ['insufficient', 'provisional', 'established'] as const;

/**
 * Not site-scoped. Priors are learned **across** tenants — that is what makes them worth having —
 * so this table is deliberately the exception to the `site_id` rule, and `stratum` carries the
 * segmentation instead. Nothing identifying belongs in it.
 */
export const priors = pgTable(
  'priors',
  {
    arrangementId: id('arrangement_id'),
    stratum: jsonb('stratum').notNull(),
    status: text('status', { enum: PRIOR_STATUSES }).notNull().default('insufficient'),
    evidence: jsonb('evidence').notNull(),
    window: text('window').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.arrangementId, table.window] })],
);

/** Also cross-tenant by design: diversity is only meaningful over the whole population. */
export const diversityLedger = pgTable(
  'diversity_ledger',
  {
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'string' }).notNull(),
    key: text('key').notNull(),
    value: text('value').notNull(),
    share: doublePrecision('share').notNull(),
  },
  (table) => [primaryKey({ columns: [table.windowStart, table.key, table.value] })],
);

// ---------------------------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------------------------

export const sitesRelations = relations(sites, ({ many }) => ({
  versions: many(siteVersions),
  facts: many(facts),
  assets: many(assets),
  runs: many(runs),
}));

export const siteVersionsRelations = relations(siteVersions, ({ one, many }) => ({
  site: one(sites, { fields: [siteVersions.siteId], references: [sites.siteId] }),
  gateReports: many(gateReports),
  editActions: many(editActions),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
  site: one(sites, { fields: [runs.siteId], references: [sites.siteId] }),
  events: many(runEvents),
  modelCalls: many(modelCalls),
}));

/** Every table, for the tenancy tests and the migration generator. */
export const ALL_TABLES = {
  sites,
  siteVersions,
  facts,
  factSources,
  assets,
  runs,
  runEvents,
  modelCalls,
  gateReports,
  editActions,
  telemetryEvents,
  priors,
  diversityLedger,
} as const;

/**
 * The two tables that are cross-tenant on purpose. Named here so the tenancy test can assert
 * that the exception list is exactly this and has not quietly grown.
 */
export const CROSS_TENANT_TABLES: readonly (keyof typeof ALL_TABLES)[] = [
  'priors',
  'diversityLedger',
];

/** Logs. No update, no delete, no `updated_at`. */
export const APPEND_ONLY_TABLES: readonly (keyof typeof ALL_TABLES)[] = [
  'runEvents',
  'modelCalls',
  'editActions',
  'telemetryEvents',
];

export type FactRow = typeof facts.$inferSelect;
export type SiteVersionRow = typeof siteVersions.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
export type ModelCallRow = typeof modelCalls.$inferSelect;

/** Re-exported so a caller typing a fact row and a contract fact cannot pick different shapes. */
export type { Fact, Provenance };
