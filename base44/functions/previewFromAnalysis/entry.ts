import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { sanitizeStoredOverride, VALID_SECTION_TYPES } from '../../shared/overrideSchema.js';
import { rebaseOverrideFromAnalysis } from '../../shared/rebaseEngine.ts';

/**
 * previewFromAnalysis — Edit 5D Final Correction
 *
 * Generates the identical post-adoption content that adoptVersionFromAnalysis would produce,
 * WITHOUT writing anything.
 *
 * Uses rebaseOverrideFromAnalysis from base44/shared/rebaseEngine.ts —
 * THE SAME function called by adoptionEngine.ts. Not a copy. Not a mirror.
 * The exact same import, the exact same function reference.
 *
 * Request: { companyJobId, analysisId, reviewDecisions }
 * Response: { sections, targetVersionNumber, jobTitle, jobShortDescription }
 */

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyJobId, analysisId, reviewDecisions } = body;

    if (!companyJobId || !analysisId) {
      return Response.json({ error: 'companyJobId and analysisId are required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Load job
    const job = await SR.entities.Job.get(companyJobId).catch(() => null);
    if (!job) return Response.json({ error: 'Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 });

    // Authorization — company admin only (same gate as adoption)
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId: job.companyId, status: 'active',
    }).catch(() => []);
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
    if (!isCompanyAdmin) {
      return Response.json({ error: 'Insufficient role', code: 'INSUFFICIENT_ROLE' }, { status: 403 });
    }

    // Load analysis
    const analysis = await SR.entities.CompanyVersionAnalysis.get(analysisId).catch(() => null);
    if (!analysis) return Response.json({ error: 'Analysis not found', code: 'ANALYSIS_NOT_FOUND' }, { status: 404 });
    if (analysis.status !== 'COMPLETED') {
      return Response.json({ error: 'Analysis not complete', code: 'ANALYSIS_NOT_COMPLETE' }, { status: 409 });
    }
    if (analysis.companyJobId !== companyJobId) {
      return Response.json({ error: 'Analysis job mismatch', code: 'ANALYSIS_JOB_MISMATCH' }, { status: 409 });
    }

    const targetVersionId = analysis.toVersionId;

    // Load current override and sanitize
    const overrideRecords = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: companyJobId }).catch(() => []);
    const override = overrideRecords?.[0] || null;
    let sanitizedOverrideData = null;
    if (override?.overrideData) {
      const { sanitized } = sanitizeStoredOverride(override.overrideData, companyJobId);
      sanitizedOverrideData = sanitized;
    }

    // Load target sections
    const targetSections = await SR.entities.EssentialSOPSection.filter(
      { masterId: job.sourceMasterId, versionId: targetVersionId }, 'sortOrder', 10
    ).catch(() => []) || [];

    // Load target version for version number
    const targetVersion = await SR.entities.EssentialSOPVersion.get(targetVersionId).catch(() => null);

    // ── THE SHARED REBASE FUNCTION ──────────────────────────────────────────────
    // This is the same rebaseOverrideFromAnalysis imported from rebaseEngine.ts
    // that adoptionEngine.ts calls in Phase 4. Not a copy. The same function.
    const { rebasedOverrideData } = rebaseOverrideFromAnalysis({
      itemResults: analysis.itemResults || [],
      existingOverrideData: sanitizedOverrideData,
      targetSections,
      reviewDecisions: reviewDecisions || {},
    });

    // Build the final resolved content — same logic as the resolver in adoptVersionFromAnalysis
    const resolvedTitle = rebasedOverrideData?.title || job.title;
    const resolvedShortDescription = rebasedOverrideData?.shortDescription || job.shortDescription;

    const sections: Record<string, any[]> = {};
    for (const ms of targetSections) {
      const st = ms.sectionType;
      if (!st || !(VALID_SECTION_TYPES as Set<string>).has(st)) continue;
      const sectionOverride = rebasedOverrideData?.sectionOverrides?.[st] || null;
      const sourceItems = sectionOverride || ms.contentItems || [];
      const isOv = !!sectionOverride;
      sections[st] = (sourceItems as any[]).map((item: any, idx: number) => ({
        id: item._itemId || (isOv ? `o_${ms.id}_${idx}` : `m_${ms.id}_${idx}`),
        sectionType: st,
        contentType: item.contentType || 'text',
        title: typeof item.title === 'string' ? item.title : '',
        body: typeof item.body === 'string' ? item.body : '',
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
        isRequired: typeof item.isRequired === 'boolean' ? item.isRequired : false,
        isCritical: typeof item.isCritical === 'boolean' ? item.isCritical : false,
        metadata: (item.metadata && typeof item.metadata === 'object') ? item.metadata : {},
      })).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    }

    return Response.json({
      jobTitle: resolvedTitle,
      jobShortDescription: resolvedShortDescription,
      targetVersionNumber: targetVersion?.versionNumber,
      sections,
    });

  } catch (err: any) {
    console.error('[previewFromAnalysis]', err);
    return Response.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}