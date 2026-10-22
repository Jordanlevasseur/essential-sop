import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requireCompanyAdmin } from '../../shared/platformAuth.ts';
import { buildProvisioningKey } from '../../shared/companyLibraryProvisioning.ts';

/**
 * resolveCompanyMasterPreview — Company-facing read-only preview of ONE
 * provisioned Master SOP's published content.
 *
 * Protects direct requests by ID: hiding navigation alone is insufficient.
 * Even if a caller guesses a masterId, the request is rejected unless an ACTIVE
 * ProvisioningRecord exists for (caller's companyId, masterId).
 *
 * Authorization:
 *   - Caller must be GM/PM of `companyId` (requireCompanyAdmin).
 *   - An ACTIVE ProvisioningRecord for (companyId, masterId) MUST exist.
 *     No assignment → 403 NOT_PROVISIONED. This prevents cross-company disclosure:
 *     Company A cannot preview a Master provisioned exclusively to Company B.
 *
 * Returns the platform-published Master content (master sections + contentItems
 * for the current published version), NOT the company's customized override
 * (that is the company's own Job, viewable via resolveJob). This keeps the
 * preview as the authoritative "what the platform published" view.
 *
 * Adoption state is derived from the linked Job (same rule as the list resolver):
 *   adopted | available | removed.
 *
 * Request:  { companyId: string, masterId: string }
 * Response: { master, sections, adoptionState, jobId } or { error, code }
 */
const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { companyId, masterId } = body;
    if (!companyId || typeof companyId !== 'string' || !companyId.trim()) {
      return Response.json({ error: 'companyId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!masterId || typeof masterId !== 'string' || !masterId.trim()) {
      return Response.json({ error: 'masterId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // ── Authorization: GM/PM of this company ───────────────────────────────────
    const { error: authError } = await requireCompanyAdmin(base44, companyId);
    if (authError) return authError;

    const SR = base44.asServiceRole;

    // ── ID protection: ACTIVE assignment for (companyId, masterId) required ───
    const provisioningKey = buildProvisioningKey(companyId, masterId);
    let assignment: any = null;
    try {
      const recs = await SR.entities.ProvisioningRecord.filter({ provisioningKey }, '-createdAt', 10);
      assignment = (recs || []).find((r: any) => r.assignmentStatus === 'ACTIVE') || null;
    } catch (_) {}
    if (!assignment) {
      return Response.json({
        error: 'This Master SOP is not provisioned to your company.',
        code: 'NOT_PROVISIONED',
      }, { status: 403 });
    }

    // ── Load Master (must be active with a published version) ────────────────
    let master: any;
    try { master = await SR.entities.EssentialSOPMaster.get(masterId); } catch (_) {}
    if (!master) return Response.json({ error: 'Master SOP not found', code: 'NOT_FOUND' }, { status: 404 });
    if (master.status !== 'active' || !master.currentPublishedVersionId) {
      return Response.json({ error: 'Master SOP is not available', code: 'MASTER_UNAVAILABLE' }, { status: 409 });
    }
    if (master.distributionStatus === 'retired') {
      return Response.json({ error: 'This Master SOP has been retired and is no longer available for adoption.', code: 'MASTER_RETIRED' }, { status: 409 });
    }

    let version: any;
    try { version = await SR.entities.EssentialSOPVersion.get(master.currentPublishedVersionId); } catch (_) {}
    if (!version || version.status !== 'published') {
      return Response.json({ error: 'Published version is not available', code: 'VERSION_UNAVAILABLE' }, { status: 409 });
    }

    // ── Load published sections (read-only content) ───────────────────────────
    let sections: any[] = [];
    try {
      sections = await SR.entities.EssentialSOPSection.filter(
        { masterId, versionId: version.id }, 'sortOrder', 10
      ) || [];
    } catch (_) {}

    // ── Derive adoption state from the linked Job ─────────────────────────────
    let job: any = null;
    try {
      const jobs = await SR.entities.Job.filter(
        { companyId, sourceType: 'essential_sop', sourceMasterId: masterId }, '-created_date', 5
      );
      job = (jobs || [])[0] || null;
    } catch (_) {}
    let adoptionState: 'adopted' | 'available' | 'removed' = 'available';
    if (job) {
      adoptionState = (!job.isArchived && job.status === 'Published') ? 'adopted' : 'removed';
    }

    // ── Build ordered, minimal response ──────────────────────────────────────
    const ordered = SECTION_ORDER
      .map((st) => (sections || []).find((s) => s.sectionType === st))
      .filter(Boolean)
      .map((s: any) => ({
        sectionType: s.sectionType,
        title: s.title || SECTION_TITLES[s.sectionType] || s.sectionType,
        contentItems: s.contentItems || [],
      }));

    return Response.json({
      master: {
        masterId,
        title: master.title,
        trade: master.trade || '',
        category: master.category || '',
        versionNumber: version.versionNumber,
        publishedAt: version.publishedAt || null,
        changeNotes: version.changeNotes || '',
      },
      sections: ordered,
      adoptionState,
      jobId: job?.id || null,
    });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}