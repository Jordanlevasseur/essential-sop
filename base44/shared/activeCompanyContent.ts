import { buildProvisioningKey } from './companyLibraryProvisioning.ts';

/**
 * activeCompanyContent.ts — Phase 5: the SINGLE authoritative active-company-
 * content eligibility rule for essential_sop Jobs.
 *
 * An essential_sop Job is "active company content" — visible in the Company
 * Library list, openable via Job detail, and retrievable/citable by the AI
 * Assistant — if and ONLY if ALL hold:
 *
 *   1. Job.companyId === the requesting company (enforced by the caller's
 *      { companyId } entity filter).
 *   2. Job.status === 'Published' AND !Job.isArchived (enforced by the caller
 *      before calling these helpers).
 *   3. Job.sourceMasterId is present.
 *   4. EssentialSOPMaster(sourceMasterId) exists with status === 'active'.
 *      (resolveJob additionally verifies the pinned version is published.)
 *   5. ProvisioningRecord(companyId, sourceMasterId).assignmentStatus === 'ACTIVE'.
 *
 * Company-created Jobs (sourceType !== 'essential_sop', including the legacy
 * Jobs with unset sourceType) remain eligible when Published + non-archived
 * for the company — their eligibility is unchanged.
 *
 * Consequences enforced by this rule:
 *   - A provisioned-only Master (no adopted Job) is NOT active content.
 *   - A company-removed (archived) Job is NOT active content.
 *   - A platform-unassigned Master (assignment REMOVED) is NOT active content,
 *     even if an adopted published Job still exists.
 *
 * This module is the ONLY definition of active-company-content eligibility.
 * resolveJobsForCompany, resolveJob, and resolveAssistantContext (used by
 * askAssistant + resolveJobsForAssistant) all import from here so the rule
 * is never duplicated and never drifts between surfaces.
 */

/**
 * loadActiveAssignmentMasterIds — bulk lookup for list/Assistant read paths.
 * Returns the set of masterIds that have an ACTIVE ProvisioningRecord for the
 * given company. One call per company read; reused across all sopJobs in it.
 */
/**
 * loadActiveAssignmentMasterIdsWithMetrics — same as loadActiveAssignmentMasterIds
 * but also returns a hasMore flag indicating whether the 500-record query limit
 * was reached. Stage 3 surfaces this in completeness metrics so the router can
 * avoid definitive "no SOP exists" answers on potentially incomplete data.
 */
export async function loadActiveAssignmentMasterIdsWithMetrics(
  SR: any, companyId: string
): Promise<{ masterIds: Set<string>; hasMore: boolean }> {
  try {
    const records = await SR.entities.ProvisioningRecord.filter(
      { companyId, assignmentStatus: 'ACTIVE' }, '-createdAt', 500
    );
    const hasMore = (records || []).length >= 500;
    return {
      masterIds: new Set((records || []).map((r: any) => r.masterId).filter(Boolean)),
      hasMore,
    };
  } catch (_) {
    return { masterIds: new Set(), hasMore: false };
  }
}

export async function loadActiveAssignmentMasterIds(SR: any, companyId: string): Promise<Set<string>> {
  const { masterIds } = await loadActiveAssignmentMasterIdsWithMetrics(SR, companyId);
  return masterIds;
}

/**
 * isMasterAssignedActive — targeted single-master check for resolveJob's deep-
 * link path. Returns true iff an ACTIVE ProvisioningRecord exists for the exact
 * (companyId, masterId) pair. Uses the canonical provisioningKey for one
 * targeted lookup instead of loading all company assignments.
 */
export async function isMasterAssignedActive(SR: any, companyId: string, masterId: string): Promise<boolean> {
  try {
    const key = buildProvisioningKey(companyId, masterId);
    const recs = await SR.entities.ProvisioningRecord.filter({ provisioningKey: key }, '-createdAt', 10);
    return (recs || []).some((r: any) => r.assignmentStatus === 'ACTIVE');
  } catch (_) {
    return false;
  }
}