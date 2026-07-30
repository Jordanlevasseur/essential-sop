import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { sanitizeStoredOverride, VALID_SECTION_TYPES } from '../../shared/overrideSchema.js';

/**
 * previewFromAnalysis — Edit 5D Hardening
 *
 * Generates the identical post-adoption content that adoptVersionFromAnalysis would produce,
 * WITHOUT writing anything. Uses the same rebase logic as adoptionEngine.ts.
 *
 * This is the ONLY authoritative preview. previewMasterVersionAdoption is NOT used here.
 *
 * Request: { companyJobId, analysisId, reviewDecisions }
 * Response: { sections: { [sectionType]: ContentItem[] }, targetVersionNumber, jobTitle, jobShortDescription }
 */

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
const SECTION_TITLES = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};
const COMPATIBILITY = { SAFE: 'SAFE', REVIEW_REQUIRED: 'REVIEW_REQUIRED', ORPHANED: 'ORPHANED', INVALID: 'INVALID', NO_OP: 'NO_OP' };

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

    // Authorization
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

    // Load current override
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

    // Run the same rebase logic as adoptionEngine._rebaseOverrideFromAnalysis
    const rebasedOverrideData = rebaseOverrideFromAnalysis(
      analysis.itemResults || [],
      sanitizedOverrideData,
      targetSections,
      reviewDecisions || {}
    );

    // Build the final resolved content — same logic as adoptVersionFromAnalysis resolver
    const resolvedTitle = rebasedOverrideData?.title || job.title;
    const resolvedShortDescription = rebasedOverrideData?.shortDescription || job.shortDescription;

    const sections = {};
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

// ── Rebase logic (mirror of adoptionEngine._rebaseOverrideFromAnalysis) ────────
// Must stay in sync with adoptionEngine.ts. Any change there must be reflected here.
function rebaseOverrideFromAnalysis(
  itemResults: any[],
  existingOverrideData: any,
  targetSections: any[],
  reviewDecisions: Record<string, string>
): any {
  if (!existingOverrideData) return null;

  const resultByItemId: Record<string, any> = {};
  for (const ir of itemResults) {
    if (ir.currentItemId) resultByItemId[ir.currentItemId] = ir;
    if (ir.companyOverrideValues?.item?._itemId) resultByItemId[ir.companyOverrideValues.item._itemId] = ir;
  }

  const rebasedSectionOverrides: Record<string, any[]> = {};
  for (const st of SECTION_ORDER) {
    const existingItems: any[] = existingOverrideData?.sectionOverrides?.[st] || [];
    if (existingItems.length === 0) continue;
    const rebasedItems: any[] = [];
    for (const item of existingItems) {
      const itemId = item._itemId || '';
      const ir = itemId ? resultByItemId[itemId] : null;
      if (!ir) { rebasedItems.push({ ...item }); continue; }
      const compat = ir.compatibility;
      if (compat === COMPATIBILITY.SAFE || compat === COMPATIBILITY.NO_OP) {
        rebasedItems.push({ ...item });
      } else if (compat === COMPATIBILITY.ORPHANED) {
        rebasedItems.push({ ...item });
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const key = ir.logicalItemId || itemId;
        const decision = reviewDecisions[key];
        if (decision === 'KEEP_COMPANY') { rebasedItems.push({ ...item }); }
        else if (decision === 'USE_NEW_MASTER') { /* drop */ }
        else { rebasedItems.push({ ...item }); } // undecided: keep as-is for preview
      } else {
        rebasedItems.push({ ...item });
      }
    }
    if (rebasedItems.length > 0) rebasedSectionOverrides[st] = rebasedItems;
  }

  let rebasedTitle = null;
  let rebasedDesc = null;
  const metaResults = itemResults.filter((r: any) => r.itemType === 'metadata_field');
  for (const mr of metaResults) {
    const fieldPath = mr.logicalItemId?.replace('metadata_', '') || '';
    const compat = mr.compatibility;
    if (fieldPath.startsWith('title')) {
      if (compat === COMPATIBILITY.SAFE || compat === COMPATIBILITY.NO_OP) {
        if (existingOverrideData?.title) rebasedTitle = existingOverrideData.title;
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const dec = reviewDecisions[mr.logicalItemId || 'metadata_title'];
        if (dec === 'KEEP_COMPANY' && existingOverrideData?.title) rebasedTitle = existingOverrideData.title;
      }
    } else if (fieldPath.startsWith('shortDescription')) {
      if (compat === COMPATIBILITY.SAFE || compat === COMPATIBILITY.NO_OP) {
        if (existingOverrideData?.shortDescription) rebasedDesc = existingOverrideData.shortDescription;
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const dec = reviewDecisions[mr.logicalItemId || 'metadata_shortDescription'];
        if (dec === 'KEEP_COMPANY' && existingOverrideData?.shortDescription) rebasedDesc = existingOverrideData.shortDescription;
      }
    }
  }
  if (!rebasedTitle && existingOverrideData?.title && !metaResults.some((r: any) => (r.logicalItemId || '').includes('title'))) {
    rebasedTitle = existingOverrideData.title;
  }
  if (!rebasedDesc && existingOverrideData?.shortDescription && !metaResults.some((r: any) => (r.logicalItemId || '').includes('shortDescription'))) {
    rebasedDesc = existingOverrideData.shortDescription;
  }

  const result: any = {};
  if (rebasedTitle) result.title = rebasedTitle;
  if (rebasedDesc) result.shortDescription = rebasedDesc;
  if (Object.keys(rebasedSectionOverrides).length > 0) result.sectionOverrides = rebasedSectionOverrides;
  return Object.keys(result).length === 0 ? null : result;
}