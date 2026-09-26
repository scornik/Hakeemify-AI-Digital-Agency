/**
 * Sites, versions and gate reports.
 *
 * A run cannot be persisted before the site it belongs to exists — every site-scoped table
 * references `sites`, and the composite foreign keys mean the database will refuse the row rather
 * than create a dangling one. So `upsertSite` is the first write of any persisted run, and
 * everything else in this module hangs off it.
 */
import { and, eq } from 'drizzle-orm';

import type { Database } from './client.js';
import { gateReports, siteVersions, sites, type SITE_VERSION_STATUSES } from './schema.js';
import type { SiteScope } from './tenancy.js';

export interface SiteInput {
  readonly site_id: string;
  readonly tenant_id: string;
  readonly niche: string;
  /** Owner-declared, or null. The pipeline interrupts rather than inferring it. */
  readonly positioning?: string | null;
}

/**
 * Create the site or update its mutable fields.
 *
 * `tenant_id` is deliberately **not** in the update set. A site changing tenant is not an edit, it
 * is a different site: every row beneath it is keyed on `site_id` and would silently follow,
 * carrying one tenant's facts into another's ownership. If that is genuinely needed it is a
 * migration someone writes on purpose.
 */
export async function upsertSite(db: Database, scope: SiteScope, site: SiteInput): Promise<void> {
  const [row] = scope.rowsFor(sites, [
    {
      siteId: site.site_id,
      tenantId: site.tenant_id,
      niche: site.niche,
      positioning: site.positioning ?? null,
    },
  ]);

  await db
    .insert(sites)
    .values(row as never)
    .onConflictDoUpdate({
      target: sites.siteId,
      set: { niche: row?.niche as never, positioning: row?.positioning as never },
    });
}

export interface VersionInput {
  readonly version_id: string;
  readonly parent_version_id?: string | null;
  readonly site_definition: unknown;
  readonly manifest: unknown;
  readonly gap_report: unknown;
  readonly gate_report_id?: string | null;
  readonly schema_version: number;
  readonly created_by: 'pipeline' | 'owner_edit' | 'migration';
  readonly status?: (typeof SITE_VERSION_STATUSES)[number];
}

/**
 * Write a version. Defaults to `draft`, and there is no `status: 'published'` shortcut here —
 * publishing is stage 16 and confirm-gated, so a repository function that could publish as a side
 * effect of saving would route around the gate.
 */
export async function saveVersion(
  db: Database,
  scope: SiteScope,
  version: VersionInput,
): Promise<void> {
  const [row] = scope.rowsFor(siteVersions, [
    {
      versionId: version.version_id,
      parentVersionId: version.parent_version_id ?? null,
      siteDefinition: version.site_definition as never,
      manifest: version.manifest as never,
      gapReport: version.gap_report as never,
      gateReportId: version.gate_report_id ?? null,
      schemaVersion: version.schema_version,
      createdBy: version.created_by,
      status: version.status ?? 'draft',
    },
  ]);

  await db
    .insert(siteVersions)
    .values(row as never)
    .onConflictDoUpdate({
      target: [siteVersions.siteId, siteVersions.versionId],
      set: {
        siteDefinition: row?.siteDefinition as never,
        manifest: row?.manifest as never,
        gapReport: row?.gapReport as never,
        gateReportId: row?.gateReportId as never,
      },
    });
}

export async function loadVersion(
  db: Database,
  scope: SiteScope,
  versionId: string,
): Promise<typeof siteVersions.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(siteVersions)
    .where(scope.where(siteVersions, eq(siteVersions.versionId, versionId)))
    .limit(1);
  return rows[0];
}

export interface GateReportInput {
  readonly report_id: string;
  readonly version_id: string;
  readonly policy_ver: string;
  readonly checks: unknown;
  readonly summary: unknown;
}

/**
 * Store a gate report against a version.
 *
 * Upsert rather than insert, because a version is gated again after a repair and the second report
 * is the one that matters. The history of *why* lives in `run_events`, which is append-only.
 */
export async function saveGateReport(
  db: Database,
  scope: SiteScope,
  report: GateReportInput,
): Promise<void> {
  const [row] = scope.rowsFor(gateReports, [
    {
      reportId: report.report_id,
      versionId: report.version_id,
      policyVer: report.policy_ver,
      checks: report.checks as never,
      summary: report.summary as never,
    },
  ]);

  await db
    .insert(gateReports)
    .values(row as never)
    .onConflictDoUpdate({
      target: [gateReports.siteId, gateReports.reportId],
      set: { checks: row?.checks as never, summary: row?.summary as never },
    });
}

export async function loadGateReport(
  db: Database,
  scope: SiteScope,
  versionId: string,
): Promise<typeof gateReports.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(gateReports)
    .where(and(scope.where(gateReports), eq(gateReports.versionId, versionId)))
    .limit(1);
  return rows[0];
}
