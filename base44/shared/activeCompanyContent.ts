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
export async function loadActiveAssignmentMasterIds(SR: any, companyId: string): Promise<Set<string>> {
  try {
    const records = await SR.entities.ProvisioningRecord.filter(
      { companyId, assignmentStatus: 'ACTIVE' }, '-createdAt', 500
    );
    return new Set((records || []).map((r: any) => r.masterId).filter(Boolean));
  } catch (_) {
    return new Set();
  }
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