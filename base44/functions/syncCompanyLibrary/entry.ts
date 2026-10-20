/**
 * syncCompanyLibrary — Company Library Sync
 *
 * SOURCE OF TRUTH: ProvisioningRecord entities with assignmentStatus=ACTIVE for this
 * company define the canonical set of Master SOPs assigned to the company.
 *
 * ASSIGNMENT vs PROVISIONING:
 *   assignmentStatus (ACTIVE/REMOVED/SUSPENDED) = IS the company currently assigned?
 *   provisioningStatus (COMPLETED/FAILED/etc.)  = WAS the Job successfully created?
 *   A COMPLETED provisioningStatus alone is NOT sufficient — assignmentStatus must be ACTIVE.
 *
 * This means:
 *   - ALL_EXISTING_AND_FUTURE_COMPANIES → ACTIVE assignment created at publish time.
 *   - SELECTED_COMPANIES → ACTIVE assignment only if this company was selected.
 *   - MANUAL → ACTIVE assignment only if explicitly distributed to this company.
 *   - REMOVED assignments → excluded from sync; Company Job is preserved but not recreated.
 *
 * The sync loop DOES NOT re-evaluate defaultDistributionPolicy and CANNOT create assignments.
 * Only Publish & Distribution workflows create assignments.
 *
 * Sync responsibilities:
 *  1. Load all ACTIVE ProvisioningRecords for this company → assigned masters.
 *  2. Load company's existing essential_sop Jobs.
 *  3. For each ACTIVE assigned master:
 *     a. If Company Job is missing → available for adoption (skip; Phase 4: sync
 *        no longer auto-provisions Jobs — the company adopts via addToCompanyLibrary).
 *     b. If Company Job exists but is on an older version → create CompanyVersionDecision.
 *     c. If Company Job exists and is current → skip (no write).
 *  4. Persist sync result in CompanyLibraryProvisioningRun (server-side history).
 *  5. Return lightweight summary.
 *
 * Unassignment: ProvisioningRecord.assignmentStatus is set to REMOVED by platform admin.
 * Sync excludes REMOVED records. The Company Job is NOT deleted — product policy preserves data.
 *
 * Auth: any active CompanyMembership member may sync their own company.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  buildProvisioningKey,
} from '../../shared/companyLibraryProvisioning.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── Auth ──────────────────────────────────────────────────────────────────
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // ── Verify active membership ──────────────────────────────────────────────
    let membership: any = null;
    try {
      const memberships = await SR.entities.CompanyMembership.filter({
        companyId,
        userId: user.id,
        status: 'active',
      });
      membership = memberships?.[0] || null;
    } catch (_) {}
    if (!membership) {
      return Response.json({ error: 'No active membership for this company' }, { status: 403 });
    }

    // ── Load company record ───────────────────────────────────────────────────
    let company: any = null;
    try { company = await SR.entities.Company.get(companyId); } catch (_) {}
    if (!company) return Response.json({ error: 'Company not found' }, { status: 404 });

    const startedAt = new Date().toISOString();

    // ── Step 1: Load canonical assignment records (ProvisioningRecord) ────────
    // ACTIVE assignmentStatus = this company is currently assigned this Master SOP.
    // REMOVED assignmentStatus = assignment was revoked; sync must NOT maintain these.
    // provisioningStatus=COMPLETED alone is NOT sufficient — must also be ACTIVE.
    let assignmentRecords: any[] = [];
    try {
      assignmentRecords = await SR.entities.ProvisioningRecord.filter(
        { companyId, assignmentStatus: 'ACTIVE' },
        '-createdAt',
        500
      ) || [];
    } catch (_) {
      return Response.json({ error: 'Failed to load company assignments' }, { status: 500 });
    }

    // Also include ACTIVE+FAILED records for retry (Job was never successfully provisioned)
    // De-duplicate: one canonical record per masterId (prefer ACTIVE records)
    const recordByMasterId = new Map<string, any>();
    for (const rec of assignmentRecords) {
      if (rec.masterId) {
        const existing = recordByMasterId.get(rec.masterId);
        // Prefer records with successful provisioningStatus
        if (!existing ||
            (existing.provisioningStatus === 'FAILED' && rec.provisioningStatus !== 'FAILED')) {
          recordByMasterId.set(rec.masterId, rec);
        }
      }
    }

    const assignedMasterIds = [...recordByMasterId.keys()];

    if (assignedMasterIds.length === 0) {
      // No assignments for this company yet — nothing to sync
      const completedAt = new Date().toISOString();
      await _persistSyncRun(SR, {
        companyId,
        userId: user.id,
        startedAt,
        completedAt,
        checked: 0, added: 0, outdated: 0, skipped: 0, failed: 0,
        failedItems: [],
        status: 'completed',
      });
      return Response.json({
        synced: true,
        summary: { checked: 0, added: 0, outdated: 0, skipped: 0, failed: 0 },
        startedAt,
        completedAt,
        durationMs: 0,
      });
    }

    // ── Step 2: Load assigned Master SOP records ──────────────────────────────
    const masterMap = new Map<string, any>();
    const masterFetches = await Promise.allSettled(
      assignedMasterIds.map(async (mid: string) => {
        try { const m = await SR.entities.EssentialSOPMaster.get(mid); return { mid, m }; }
        catch (_) { return { mid, m: null }; }
      })
    );
    for (const r of masterFetches) {
      if (r.status === 'fulfilled' && r.value.m) {
        masterMap.set(r.value.mid, r.value.m);
      }
    }

    // ── Step 3: Load current company Jobs (essential_sop only) ────────────────
    let existingJobs: any[] = [];
    try {
      existingJobs = await SR.entities.Job.filter(
        { companyId, sourceType: 'essential_sop' },
        '-created_date',
        500
      ) || [];
    } catch (_) {}

    const existingJobByMasterId = new Map<string, any>();
    for (const j of existingJobs) {
      if (j.sourceMasterId) existingJobByMasterId.set(j.sourceMasterId, j);
    }

    // ── Step 4: Load existing PENDING CompanyVersionDecisions ─────────────────
    let existingDecisions: any[] = [];
    try {
      existingDecisions = await SR.entities.CompanyVersionDecision.filter(
        { companyId, status: 'PENDING' },
        '-createdAt',
        500
      ) || [];
    } catch (_) {}
    // Key: `${jobId}:${toVersionId}`
    const decisionKeySet = new Set<string>(
      existingDecisions.map((d: any) => `${d.companyJobId}:${d.toVersionId}`)
    );

    // ── Step 5: Bulk-load published versions for assigned masters ─────────────
    const neededVersionIds = new Set<string>();
    for (const [mid, master] of masterMap) {
      if (master?.currentPublishedVersionId) {
        neededVersionIds.add(master.currentPublishedVersionId);
      }
    }
    const versionMap = new Map<string, any>();
    const versionFetches = await Promise.allSettled(
      [...neededVersionIds].map(async (vid: string) => {
        try { const v = await SR.entities.EssentialSOPVersion.get(vid); return { vid, v }; }
        catch (_) { return { vid, v: null }; }
      })
    );
    for (const r of versionFetches) {
      if (r.status === 'fulfilled' && r.value.v) {
        versionMap.set(r.value.vid, r.value.v);
      }
    }

    // ── Step 6: Sync loop ─────────────────────────────────────────────────────
    const now = new Date().toISOString();
    let added = 0;
    let outdated = 0;
    let skipped = 0;
    let failed = 0;
    const failedItems: Array<{ masterId: string; masterTitle: string; errorCode: string; errorMessage: string }> = [];

    for (const masterId of assignedMasterIds) {
      const master = masterMap.get(masterId);
      const assignmentRecord = recordByMasterId.get(masterId);

      // Skip if master no longer exists or is archived
      if (!master) {
        skipped++;
        continue;
      }

      // Skip archived masters (they're historical; don't provision)
      if (master.status === 'archived') {
        skipped++;
        continue;
      }

      const currentPublishedVersionId = master.currentPublishedVersionId;

      // Skip if master has no published version (draft-only)
      if (!currentPublishedVersionId) {
        skipped++;
        continue;
      }

      const publishedVersion = versionMap.get(currentPublishedVersionId) || null;
      const existingJob = existingJobByMasterId.get(masterId) || null;
      const provisioningKey = buildProvisioningKey(companyId, masterId);

      // ── Company-level removal guard (Phase 2) ───────────────────────────────
      // If a linked essential_sop Job exists but is archived, the company
      // intentionally removed it from its library via removeFromCompanyLibrary.
      // Sync must NOT recreate it (no new Job) and must NOT surface a version
      // decision for it. The platform assignment (ProvisioningRecord) is left
      // untouched — only a Platform Super Admin can revoke provisioning.
      // Re-adoption is via addToCompanyLibrary, which un-archives this same Job.
      if (existingJob?.isArchived) {
        skipped++;
        continue;
      }

      try {
        if (!existingJob) {
          // ── Case A (Phase 4): assignment exists but no linked Job — available ─
          // Platform provisioning no longer auto-creates a company Job. The Master
          // is AVAILABLE for the company to adopt via addToCompanyLibrary. Sync
          // maintains assignments and version decisions only; it does not create
          // Jobs. The ProvisioningRecord (assignment) already exists.
          skipped++;

        } else if (existingJob.sourceVersionId && existingJob.sourceVersionId !== currentPublishedVersionId) {
          // ── Case B: Job exists but is on an older version ─────────────────
          // Do NOT force-adopt. Create a CompanyVersionDecision if not already present.
          const decKey = `${existingJob.id}:${currentPublishedVersionId}`;
          if (!decisionKeySet.has(decKey)) {
            try {
              const decisionKey = `VERSION_DECISION:${existingJob.id}:${currentPublishedVersionId}`;
              const existingDecByKey = await SR.entities.CompanyVersionDecision.filter(
                { decisionKey },
                '-createdAt',
                1
              ).catch(() => []);
              if (!existingDecByKey || existingDecByKey.length === 0) {
                await SR.entities.CompanyVersionDecision.create({
                  companyId,
                  companyJobId: existingJob.id,
                  masterId,
                  fromVersionId: existingJob.sourceVersionId,
                  toVersionId: currentPublishedVersionId,
                  distributionEventId: assignmentRecord?.distributionEventId || null,
                  decisionKey,
                  status: 'PENDING',
                  createdAt: now,
                  createdBy: user.id,
                  updatedAt: now,
                });
              }
              decisionKeySet.add(decKey);
            } catch (_) {}
            outdated++;
          } else {
            // Decision already exists
            skipped++;
          }

        } else {
          // ── Case C: Job exists and is on the correct version ──────────────
          skipped++;
        }

      } catch (outerErr: any) {
        failed++;
        failedItems.push({
          masterId,
          masterTitle: master.title || masterId,
          errorCode: 'UNEXPECTED_ERROR',
          errorMessage: outerErr?.message || 'Unexpected error.',
        });
      }
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    const checked = assignedMasterIds.length;

    // ── Step 7: Persist sync run (server-side history) ────────────────────────
    await _persistSyncRun(SR, {
      companyId,
      userId: user.id,
      startedAt,
      completedAt,
      checked, added, outdated, skipped, failed,
      failedItems,
      status: failed === 0 ? 'completed' : (added > 0 || skipped > 0 ? 'partially_completed' : 'failed'),
    });

    return Response.json({
      synced: true,
      summary: { checked, added, outdated, skipped, failed },
      failedItems,
      startedAt,
      completedAt,
      durationMs,
    });

  } catch (error: any) {
    return Response.json({ error: error.message || 'Sync failed' }, { status: 500 });
  }
}

// ── Persist sync run to CompanyLibraryProvisioningRun ─────────────────────────
// Provides server-side, cross-device sync history for auditing and troubleshooting.

async function _persistSyncRun(SR: any, params: {
  companyId: string;
  userId: string;
  startedAt: string;
  completedAt: string;
  checked: number;
  added: number;
  outdated: number;
  skipped: number;
  failed: number;
  failedItems: Array<{ masterId: string; masterTitle: string; errorCode: string; errorMessage: string }>;
  status: string;
}): Promise<void> {
  const { companyId, userId, startedAt, completedAt, checked, added, outdated, skipped, failed, failedItems, status } = params;
  try {
    await SR.entities.CompanyLibraryProvisioningRun.create({
      companyId,
      initiatedByUserId: userId,
      initiatedByType: 'system',
      startedAt,
      completedAt,
      status,
      eligibleMasterCount: checked,
      existingProvisionedCount: skipped,
      createdCount: added,
      skippedCount: skipped,
      failedCount: failed,
      createdJobIds: [],
      errors: failedItems.map(fi => ({
        sourceMasterId: fi.masterId,
        code: fi.errorCode,
        message: fi.errorMessage,
      })),
      errorSummary: failed > 0
        ? `${failed} assignment(s) failed to sync. outdated=${outdated}`
        : null,
    });
  } catch (_) {
    // Non-fatal — sync result is still returned to the client
  }
}