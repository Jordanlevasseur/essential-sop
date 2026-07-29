import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * restoreCompanyJob — Removes company customizations from a provisioned Essential SOP Job.
 *
 * Restore = delete JobOverride. Nothing else.
 * Job entity, Master content, Master version — NEVER touched.
 * After restore, resolveJob() naturally falls back to the pinned Master.
 * companyId is ALWAYS derived from job.companyId — never trusted from client.
 *
 * Request: { jobId, expectedRevision, mutationKey }
 * Response: { success, resolvedJob } or { error, code }
 */

const SECTION_DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { jobId, expectedRevision, mutationKey } = body;

    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (typeof expectedRevision !== 'number') {
      return Response.json({ error: 'expectedRevision is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!mutationKey || typeof mutationKey !== 'string') {
      return Response.json({ error: 'mutationKey is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Load job — derive companyId server-side
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // Membership + role verification
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId: job.companyId, status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';

    if (!isCompanyAdmin) {
      return Response.json({ error: 'Insufficient role to restore job content', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
    }
    if (job.sourceType !== 'essential_sop') {
      return Response.json({ error: 'Only provisioned Essential SOP Jobs can be restored', code: 'NOT_ESSENTIAL_SOP' }, { status: 409 });
    }

    // Locate JobOverride
    const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
    const override: any = overrides?.[0] || null;

    if (!override) {
      return Response.json({ error: 'No customization exists for this Job', code: 'NO_OVERRIDE' }, { status: 409 });
    }

    // Idempotency — same mutationKey already processed
    if (override.lastMutationKey === mutationKey) {
      const resolvedJob = await resolveAfterRestore(job, SR, membership);
      return Response.json({ success: true, idempotent: true, resolvedJob });
    }

    // Optimistic concurrency
    if (override.revision !== expectedRevision) {
      return Response.json({
        error: 'Conflict: the override was changed since you loaded this job. Reload and retry.',
        code: 'REVISION_CONFLICT',
        currentRevision: override.revision,
      }, { status: 409 });
    }

    // Capture audit fields before deletion
    const capturedRevision = override.revision;
    const capturedFields = override.customizedFields || [];
    const now = new Date().toISOString();

    // DELETE THE OVERRIDE — this IS the restore
    await SR.entities.JobOverride.delete(override.id);

    // Clear isCustomized flag on the Job (informational only — resolver does not depend on it)
    try {
      await SR.entities.Job.update(job.id, { isCustomized: false, customizedAt: null, customizedBy: null });
    } catch (_) {}

    // Audit record
    try {
      await SR.entities.ActivityLog.create({
        companyId: job.companyId,
        actingUserId: user.id,
        actionType: 'job_restored',
        targetType: 'job',
        targetId: job.id,
        summary: `Restored Essential SOP "${job.title}" to pinned master version`,
        metadata: {
          masterId: job.sourceMasterId,
          masterVersionId: job.sourceVersionId,
          previousRevision: capturedRevision,
          customizedFields: capturedFields,
          mutationKey,
          event: 'COMPANY_JOB_OVERRIDE_RESTORED',
        },
        timestamp: now,
      });
    } catch (_) {}

    const resolvedJob = await resolveAfterRestore(job, SR, membership);
    return Response.json({ success: true, resolvedJob });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

async function resolveAfterRestore(job: any, SR: any, membership: any): Promise<any> {
  const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
  const capabilities = {
    canEditContent: false, canCreateContent: false, canDeleteContent: false,
    canReorderContent: false, canChangeSectionStatus: false, canEditJobMetadata: false,
    canCustomize: isCompanyAdmin,
  };

  const version = await SR.entities.EssentialSOPVersion.get(job.sourceVersionId).catch(() => null);
  if (!version || version.status !== 'published') {
    return { job, sections: [], contentBySection: {}, capabilities, override: null };
  }

  const masterSections = await SR.entities.EssentialSOPSection.filter(
    { masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10
  );

  const sections = SECTION_DISPLAY_ORDER.map((st, i) => {
    const ms = (masterSections || []).find((s: any) => s.sectionType === st);
    if (!ms) return null;
    return { id: ms.id, jobId: job.id, companyId: job.companyId, sectionType: st, title: ms.title || SECTION_TITLES[st], sortOrder: i, completionStatus: 'Empty' };
  }).filter(Boolean);

  const contentBySection: Record<string, any[]> = {};
  for (const ms of (masterSections || [])) {
    const st = ms.sectionType;
    contentBySection[st] = (ms.contentItems || []).map((item: any, idx: number) => ({
      id: `m_${ms.id}_${idx}`, jobId: job.id, companyId: job.companyId, sectionId: ms.id,
      sectionType: st, contentType: item.contentType || 'text',
      title: item.title || '', body: item.body || '',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
      isRequired: item.isRequired || false, isCritical: item.isCritical || false,
      metadata: item.metadata || {},
    }));
  }

  const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st,
          isCustomized: _ic, customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = job;

  return {
    job: { ...publicJobFields, title: job.title, shortDescription: job.shortDescription },
    sections, contentBySection, capabilities, override: null,
  };
}