import { buildProvisioningKey } from './companyLibraryProvisioning.ts';

/**
 * activeCompanyContent.ts — Active-assignment lookup helpers.
 *
 * ADOPTED-SOP OWNERSHIP RULE (current):
 * Once a company adopts a Master SOP, its company Job and customizations are
 * protected company-owned content. Reading an EXISTING adopted company SOP
 * (Company Library list, Job detail/deep link, Assistant retrieval, all six
 * sections, overrides, resources, PDF export) is decoupled from platform
 * Master availability. An adopted SOP remains accessible as long as:
 *   - The company Job exists and belongs to the requesting user's company.
 *   - The Job is Published and NOT company-archived (deliberate company removal
 *     via removeFromCompanyLibrary is still honored — it archives the Job).
 *   - The pinned source EssentialSOPVersion remains published and its sections
 *     remain intact (so content is resolvable).
 *   - The company override (JobOverride) remains available.
 * Archiving, retiring, or unassigning the original platform Master does NOT
 * revoke access to an already-adopted SOP.
 *
 * WHAT THESE HELPERS ARE FOR:
 * The helpers below define the "ACTIVE platform assignment" set and the
 * single-master active-assignment check. They are used by NEW-adoption and
 * provisioning-eligibility paths (addToCompanyLibrary, resolveCompanyMasterLibrary,
 * resolveCompanyMasterPreview, companyLibraryProvisioning) to decide whether a
 * Master may be NEWLY adopted or provisioned. They are NOT used to gate reads of
 * already-adopted company SOPs — those paths no longer require an active
 * platform assignment or an active Master.
 *
 * Company-created Jobs (sourceType !== 'essential_sop') are unaffected: they
 * remain list/detail/Assistant-eligible when Published + non-archived.
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
 * isMasterAssignedActive — targeted single-master check used by NEW-adoption
 * gating paths. Returns true iff an ACTIVE ProvisioningRecord exists for the
 * exact (companyId, masterId) pair. Uses the canonical provisioningKey for one
 * targeted lookup instead of loading all company assignments. NOTE: reading an
 * EXISTING adopted company SOP no longer requires an active assignment (see the
 * Adopted-SOP ownership rule above); this helper is for new-adoption/provisioning
 * eligibility only.
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