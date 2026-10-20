import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin } from '../../shared/platformAuth.ts';
import { provisionCompanyLibraryCore } from '../../shared/companyLibraryProvisioning.ts';

/**
 * provisionCompanyLibrary — Manual Company Library Provisioning (Platform Super Admin only).
 *
 * Creates Company Jobs linking a company to every eligible published Essential SOP master.
 * Does NOT duplicate section content. Idempotent and safe to call multiple times.
 *
 * Authorization: requirePlatformSuperAdmin() — active PlatformMembership(SUPER_ADMIN) required.
 *
 * This function is a thin auth-and-dispatch wrapper. All provisioning logic lives
 * in the canonical provisionCompanyLibraryCore service (base44/shared/companyLibraryProvisioning.ts).
 *
 * Request payload: { companyId: string, retryInitialProvisioning?: boolean }
 * Response: ProvisionCompanyLibraryCoreResult shape with HTTP-compatible envelope.
 *
 * ── RETRY MODE (retryInitialProvisioning: true) ───────────────────────────────
 * Recovers from a PARTIAL initial-provisioning failure: re-runs the COMPANY_CREATION
 * universal seed for an EXISTING company. This is the ONLY safe recovery path when
 * createCompany provisioned only some eligible Masters, because:
 *   - createCompany's same-name idempotency guard returns the existing workspace
 *     with provisioning=null (it never re-provisions).
 *   - The default MANUAL_PLATFORM_ADMIN source uses strict customer_available
 *     eligibility, which excludes 'internal' Masters — so it cannot recover
 *     COMPANY_CREATION assignments.
 *   - syncCompanyLibrary only maintains EXISTING assignments; it cannot create
 *     missing ones.
 *
 * Retry guarantees (inherited from provisionCompanyLibraryCore + the canonical
 * provisionMasterToOneCompany):
 *   - Preserves the existing Company and GM membership (no create/delete).
 *   - Provisions ONLY missing eligible assignments (COMPLETED records are skipped
 *     via the deterministic-key existingRecord lookup).
 *   - Never duplicates successful records (deterministic ESOP_PROVISION key).
 *   - Never auto-adopts Masters into company Jobs (Phase 4: availability only).
 *   - Reports unsuccessful assignments accurately via failedItems.
 *   - Independent of the createCompany same-name idempotency guard.
 */
export default async function(req: Request): Promise<Response> {
  try {
    // ── Authorization ────────────────────────────────────────────────────────
    const base44 = createClientFromRequest(req);
    const { user, error: authError } = await requirePlatformSuperAdmin(base44);
    if (authError) return authError;

    // ── Input validation ─────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { companyId, retryInitialProvisioning } = body;

    if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Company existence check ──────────────────────────────────────────────
    const SR = base44.asServiceRole;
    let company: any;
    try { company = await SR.entities.Company.get(companyId); } catch (_) {}
    if (!company) return Response.json({ error: 'Company not found' }, { status: 404 });

    // ── Delegate to canonical provisioning service ───────────────────────────
    // retryInitialProvisioning: re-run the COMPANY_CREATION universal seed to
    // recover missing assignments from a partial initial-provisioning failure.
    // Default (no flag): strict MANUAL_PLATFORM_ADMIN eligibility as before.
    const source = retryInitialProvisioning === true ? 'COMPANY_CREATION' : 'MANUAL_PLATFORM_ADMIN';
    const result = await provisionCompanyLibraryCore({
      companyId,
      initiatedByUserId: user.id,
      source,
      SR,
    });

    return Response.json({
      success: result.overallStatus !== 'FAILED',
      ...result,
      // Legacy field aliases for backwards compatibility with existing callers
      status: result.overallStatus === 'COMPLETED' ? 'completed'
              : result.overallStatus === 'COMPLETED_WITH_ERRORS' ? 'partially_completed'
              : 'failed',
      eligibleMasterCount: result.totalEligible,
      existingProvisionedCount: result.skipped,
      createdCount: result.completed,
      skippedCount: result.skipped,
      failedCount: result.failed,
      createdJobIds: result.companyJobIds,
      errors: result.failedItems.map((fi: any) => ({
        sourceMasterId: fi.masterId,
        code: fi.errorCode,
        message: fi.errorMessage,
      })),
    }, { status: 200 });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred during provisioning.' }, { status: 500 });
  }
}