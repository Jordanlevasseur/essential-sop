import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requireCompanyAdmin } from '../../shared/platformAuth.ts';

/**
 * resolveCompanyMasterLibrary — Company-facing Provisioned Master Library list.
 *
 * Returns ONLY the Master SOPs that a Platform Super Admin has assigned
 * (ProvisioningRecord.assignmentStatus='ACTIVE') to the requesting company.
 *
 * Authorization:
 *   - Caller must be authenticated.
 *   - Caller must hold an active CompanyMembership for `companyId`.
 *   - Caller must be general_manager or project_manager (requireCompanyAdmin →
 *     canCustomizeCompanyJobs). This is the same create-and-edit capability
 *     that already governs company Jobs/SOPs. No new permission or role.
 *
 * Data scoping:
 *   - Reads ONLY ProvisioningRecords where companyId === the caller's company
 *     and assignmentStatus === 'ACTIVE'. Records provisioned exclusively to
 *     other companies are never read.
 *   - Returns only eligible, active, published Masters (status='active' with a
 *     published currentPublishedVersionId).
 *   - Returns only the minimal fields the company-facing UI needs.
 *   - Never accepts client-supplied Master IDs as proof of authorization — the
 *     authoritative set comes from the company's own ProvisioningRecords.
 *
 * Adoption state is derived from the existing linked Job relationship (no new
 * field, no new entity):
 *   - Active published linked Job (sourceType='essential_sop', sourceMasterId,
 *     status='Published', isArchived=false) → 'adopted' (in Company Library)
 *   - No linked Job                                       → 'available'
 *   - Archived linked Job (isArchived=true)               → 'removed'
 *
 * Request:  { companyId: string }
 * Response: { masters: Array<{ masterId, title, trade, category, versionNumber,
 *                             adoptionState, jobId }> }
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
      return Response.json({ error: 'companyId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // ── Authorization: GM/PM of this company ───────────────────────────────────
    const { error: authError } = await requireCompanyAdmin(base44, companyId);
    if (authError) return authError;

    const SR = base44.asServiceRole;

    // ── 1. Platform assignments for THIS company only (ACTIVE) ─────────────────
    let assignments: any[] = [];
    try {
      assignments = await SR.entities.ProvisioningRecord.filter(
        { companyId, assignmentStatus: 'ACTIVE' }, '-createdAt', 500
      ) || [];
    } catch (_) {
      return Response.json({ error: 'Failed to load company assignments', code: 'INTERNAL_ERROR' }, { status: 500 });
    }

    // Deduplicate by masterId (canonical key is deterministic; defensive only).
    const recordByMaster = new Map<string, any>();
    for (const r of assignments) {
      if (!r.masterId) continue;
      const ex = recordByMaster.get(r.masterId);
      if (!ex || (ex.provisioningStatus === 'FAILED' && r.provisioningStatus !== 'FAILED')) {
        recordByMaster.set(r.masterId, r);
      }
    }
    const masterIds = [...recordByMaster.keys()];
    if (masterIds.length === 0) return Response.json({ masters: [] });

    // ── 2. Bulk-load the assigned Masters ─────────────────────────────────────
    const masterMap = new Map<string, any>();
    const mFetches = await Promise.allSettled(
      masterIds.map(async (mid: string) => {
        try { return { mid, m: await SR.entities.EssentialSOPMaster.get(mid) }; }
        catch { return { mid, m: null }; }
      })
    );
    for (const f of mFetches) if (f.status === 'fulfilled' && f.value.m) masterMap.set(f.value.mid, f.value.m);

    // ── 3. Bulk-load published versions for eligible masters ──────────────────
    const versionIds = new Set<string>();
    for (const [, m] of masterMap) {
      if (m.status === 'active' && m.currentPublishedVersionId) versionIds.add(m.currentPublishedVersionId);
    }
    const versionMap = new Map<string, any>();
    const vFetches = await Promise.allSettled(
      [...versionIds].map(async (vid: string) => {
        try { return { vid, v: await SR.entities.EssentialSOPVersion.get(vid) }; }
        catch { return { vid, v: null }; }
      })
    );
    for (const f of vFetches) if (f.status === 'fulfilled' && f.value.v) versionMap.set(f.value.vid, f.value.v);

    // ── 4. Load existing essential_sop Jobs for this company (adoption state) ─
    let jobs: any[] = [];
    try {
      jobs = await SR.entities.Job.filter(
        { companyId, sourceType: 'essential_sop' }, '-created_date', 500
      ) || [];
    } catch (_) {}
    const jobByMaster = new Map<string, any>();
    for (const j of jobs) if (j.sourceMasterId) jobByMaster.set(j.sourceMasterId, j);

    // ── 5. Build minimal, adoption-annotated response ──────────────────────────
    const masters: any[] = [];
    for (const mid of masterIds) {
      const m = masterMap.get(mid);
      if (!m || m.status !== 'active' || m.distributionStatus === 'retired' || !m.currentPublishedVersionId) continue;
      const v = versionMap.get(m.currentPublishedVersionId);
      if (!v || v.status !== 'published') continue;

      const job = jobByMaster.get(mid) || null;
      let adoptionState: 'adopted' | 'available' | 'removed' = 'available';
      if (job) {
        adoptionState = (!job.isArchived && job.status === 'Published') ? 'adopted' : 'removed';
      }

      masters.push({
        masterId: mid,
        title: m.title,
        trade: m.trade || '',
        category: m.category || '',
        versionNumber: v.versionNumber,
        adoptionState,
        jobId: job?.id || null,
      });
    }

    return Response.json({ masters });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}