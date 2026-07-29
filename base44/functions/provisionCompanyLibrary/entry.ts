import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformAdmin, writePlatformAudit } from '../../shared/esopAdminAuth.js';

/**
 * provisionCompanyLibrary — Company Library Provisioning Engine
 *
 * Creates lightweight company-owned Job records linking a company to every
 * eligible published Essential SOP master. Does NOT duplicate section content.
 *
 * Authorization: platform admin only.
 *
 * Request payload:
 *   { companyId: string }
 *
 * Idempotency: safe to call multiple times. Existing provisioned Jobs are
 * detected by (companyId + sourceMasterId) and skipped.
 *
 * Returns a structured provisioning result including a provisioningRunId.
 */
export default async function(req: Request): Promise<Response> {
  const startedAt = new Date().toISOString();
  let runRecord: any = null;
  const SR = createClientFromRequest(req).asServiceRole;

  try {
    // ── Authorization ────────────────────────────────────────────────────────
    const base44 = createClientFromRequest(req);
    const { user, error: authError } = await requirePlatformAdmin(base44);
    if (authError) return authError;

    // ── Input validation ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { companyId } = body;

    if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Company existence check ──────────────────────────────────────────────
    let company: any;
    try {
      company = await SR.entities.Company.get(companyId);
    } catch (_) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }
    if (!company) {
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }

    // ── Create provisioning run record (started) ─────────────────────────────
    runRecord = await SR.entities.CompanyLibraryProvisioningRun.create({
      companyId,
      initiatedByUserId: user.id,
      initiatedByType: 'admin',
      startedAt,
      status: 'started',
      eligibleMasterCount: 0,
      existingProvisionedCount: 0,
      createdCount: 0,
      skippedCount: 0,
      failedCount: 0,
      createdJobIds: [],
      errors: [],
    });

    // ── Load eligible master SOPs ────────────────────────────────────────────
    // Eligible = active status + distributionStatus = customer_available + has a published version
    const allMasters = await SR.entities.EssentialSOPMaster.filter(
      { status: 'active', distributionStatus: 'customer_available' },
      '-updatedAt',
      500
    );
    const eligibleMasters = (allMasters || []).filter(
      (m: any) => m.currentPublishedVersionId && m.currentPublishedVersionId.trim()
    );

    // ── Load existing provisioned Jobs for this company ──────────────────────
    // We identify provisioned jobs by sourceType='essential_sop' + companyId.
    // Build a Set of sourceMasterId values already provisioned (non-archived).
    const existingProvisionedJobs = await SR.entities.Job.filter(
      { companyId, sourceType: 'essential_sop' },
      '-created_date',
      500
    );
    const alreadyProvisionedMasterIds = new Set<string>(
      (existingProvisionedJobs || [])
        .filter((j: any) => !j.isArchived)
        .map((j: any) => j.sourceMasterId)
        .filter(Boolean)
    );

    const existingProvisionedCount = alreadyProvisionedMasterIds.size;
    const eligibleMasterCount = eligibleMasters.length;

    // ── Provision missing SOPs individually (idempotent, partial-failure safe) ──
    const createdJobIds: string[] = [];
    const errors: Array<{ sourceMasterId: string; code: string; message: string }> = [];
    let skippedCount = 0;

    const now = new Date().toISOString();

    for (const master of eligibleMasters) {
      // Skip already provisioned
      if (alreadyProvisionedMasterIds.has(master.id)) {
        skippedCount++;
        continue;
      }

      try {
        // Verify the published version is still valid and published
        const version = await SR.entities.EssentialSOPVersion.get(master.currentPublishedVersionId);
        if (!version || version.status !== 'published') {
          errors.push({
            sourceMasterId: master.id,
            code: 'VERSION_NOT_PUBLISHED',
            message: 'The referenced version is not in published status.',
          });
          continue;
        }

        // Create lightweight company Job — no section content duplicated
        const job = await SR.entities.Job.create({
          companyId,
          title: master.title,
          shortDescription: master.description || '',
          trade: master.trade || '',
          category: master.category || '',
          status: 'Published',
          isArchived: false,
          sourceType: 'essential_sop',
          sourceMasterId: master.id,
          sourceVersionId: version.id,
          isCustomized: false,
          customizedAt: null,
          customizedBy: null,
        });

        createdJobIds.push(job.id);
        // Track so concurrent iterations within this run also see this master as provisioned
        alreadyProvisionedMasterIds.add(master.id);
      } catch (err: any) {
        errors.push({
          sourceMasterId: master.id,
          code: 'PROVISIONING_CREATE_FAILED',
          message: 'The SOP could not be provisioned.',
        });
      }
    }

    const createdCount = createdJobIds.length;
    const failedCount = errors.length;
    const finalStatus = failedCount === 0 ? 'completed' : createdCount > 0 ? 'partially_completed' : 'failed';
    const completedAt = new Date().toISOString();

    // ── Update provisioning run record ───────────────────────────────────────
    await SR.entities.CompanyLibraryProvisioningRun.update(runRecord.id, {
      completedAt,
      status: finalStatus,
      eligibleMasterCount,
      existingProvisionedCount,
      createdCount,
      skippedCount,
      failedCount,
      createdJobIds,
      errors,
      errorSummary: failedCount > 0
        ? `${failedCount} SOP(s) failed to provision. See errors array for details.`
        : null,
    });

    // ── Platform audit log ───────────────────────────────────────────────────
    await writePlatformAudit(SR, {
      actingUserId: user.id,
      actingUserRole: user.role,
      action: 'company_library_provisioned',
      extra: {
        metadata: {
          companyId,
          provisioningRunId: runRecord.id,
          eligibleMasterCount,
          existingProvisionedCount,
          createdCount,
          skippedCount,
          failedCount,
          status: finalStatus,
        },
      },
    });

    return Response.json({
      success: finalStatus !== 'failed',
      status: finalStatus,
      provisioningRunId: runRecord.id,
      companyId,
      eligibleMasterCount,
      existingProvisionedCount,
      createdCount,
      skippedCount,
      failedCount,
      createdJobIds,
      errors,
    }, { status: 200 });

  } catch (error: any) {
    // Unexpected infrastructure failure — update run record if it was created
    if (runRecord) {
      try {
        await SR.entities.CompanyLibraryProvisioningRun.update(runRecord.id, {
          completedAt: new Date().toISOString(),
          status: 'failed',
          errorSummary: 'Unexpected failure during provisioning.',
        });
      } catch (_) { /* best effort */ }
    }
    return Response.json({ error: 'An unexpected error occurred during provisioning.' }, { status: 500 });
  }
}