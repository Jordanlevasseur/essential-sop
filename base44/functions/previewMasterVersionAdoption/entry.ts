import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { sanitizeStoredOverride, VALID_SECTION_TYPES } from '../../shared/overrideSchema.js';
import {
  diffSection, diffMetadata,
  computePreviewFingerprint, buildSummary,
  SECTION_LABELS,
} from '../../shared/versionDiff.ts';

/**
 * previewMasterVersionAdoption — Three-way diff preview service.
 *
 * Returns an exact structured diff between BASE (pinned), TARGET (selected), and COMPANY (override).
 * This is the ONLY source of diff data — never computed on the frontend.
 *
 * Request: { jobId: string, targetVersionId: string }
 * Response: full preview contract including changesBySection, conflicts, fingerprint, capabilities
 */

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { jobId, targetVersionId } = body;

    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (!targetVersionId || typeof targetVersionId !== 'string') {
      return Response.json({ error: 'targetVersionId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Load job — company identity derived server-side
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // Membership check
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId: job.companyId, status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';

    if (job.sourceType !== 'essential_sop') {
      return Response.json({ error: 'Version preview only applies to provisioned Essential SOP Jobs', code: 'NOT_ESSENTIAL_SOP' }, { status: 409 });
    }

    // Validate target version
    let targetVersion: any;
    try { targetVersion = await SR.entities.EssentialSOPVersion.get(targetVersionId); } catch (_) {}
    if (!targetVersion) return Response.json({ error: 'Target version not found', code: 'VERSION_NOT_FOUND' }, { status: 404 });
    if (targetVersion.status !== 'published') return Response.json({ error: 'Target version is not published', code: 'VERSION_NOT_PUBLISHED' }, { status: 409 });
    if (targetVersion.masterId !== job.sourceMasterId) return Response.json({ error: 'Target version belongs to a different Master SOP', code: 'VERSION_MASTER_MISMATCH' }, { status: 409 });
    if (targetVersionId === job.sourceVersionId) return Response.json({ error: 'Job is already on this version', code: 'ALREADY_CURRENT' }, { status: 409 });

    // Load BASE version
    let baseVersion: any;
    try { baseVersion = await SR.entities.EssentialSOPVersion.get(job.sourceVersionId); } catch (_) {}
    if (!baseVersion || baseVersion.status !== 'published') {
      return Response.json({ error: 'Base version not available', code: 'BASE_VERSION_UNAVAILABLE' }, { status: 409 });
    }

    // Load company override
    const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
    const override: any = overrides?.[0] || null;
    const overridePresent = !!override;
    const overrideRevision = override?.revision ?? 0;

    let sanitizedOverrideData: any = null;
    if (override?.overrideData) {
      const { sanitized, warnings } = sanitizeStoredOverride(override.overrideData, job.id);
      if (warnings.length > 0) console.warn(warnings.join('\n'));
      sanitizedOverrideData = sanitized;
    }

    // Load BASE and TARGET sections in parallel
    const [baseSections, targetSections] = await Promise.all([
      SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10),
      SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: targetVersionId }, 'sortOrder', 10),
    ]);

    // Load master record for title/desc comparison
    let masterRecord: any = null;
    try { masterRecord = await SR.entities.EssentialSOPMaster.get(job.sourceMasterId); } catch (_) {}

    // ── Three-way diff ────────────────────────────────────────────────────────
    const changesBySection: Record<string, any[]> = {};

    // Diff each section
    for (const st of SECTION_ORDER) {
      if (!(VALID_SECTION_TYPES as Set<string>).has(st)) continue;

      const baseSection = (baseSections || []).find((s: any) => s.sectionType === st);
      const targetSection = (targetSections || []).find((s: any) => s.sectionType === st);
      const companyItems = sanitizedOverrideData?.sectionOverrides?.[st] ?? null;

      const baseItems = baseSection?.contentItems || [];
      const targetItems = targetSection?.contentItems || [];
      const baseSectionId = baseSection?.id || `missing_${st}`;
      const targetSectionId = targetSection?.id || `missing_${st}`;

      const changes = diffSection(st, baseSectionId, targetSectionId, baseItems, targetItems, companyItems);
      if (changes.length > 0) changesBySection[st] = changes;
    }

    // Diff metadata (title, shortDescription)
    // For BASE title/desc: these are stored on the Job entity (master title is the job title for essential_sop)
    // TARGET title/desc: we use the masterRecord.title as the effective master title
    // (EssentialSOPMaster.title is the current/canonical title; we can only approximate BASE title from job.title)
    const baseTitle = job.title || '';
    const targetTitle = masterRecord?.title || job.title || '';
    const baseDesc = job.shortDescription || '';
    const targetDesc = baseDesc; // shortDescription not tracked per-version on master; no diff possible
    const companyTitle = sanitizedOverrideData?.title || null;
    const companyDesc = sanitizedOverrideData?.shortDescription || null;

    const metadataChanges = diffMetadata(baseTitle, targetTitle, baseDesc, targetDesc, companyTitle, companyDesc);
    if (metadataChanges.length > 0) changesBySection['metadata'] = metadataChanges;

    // ── Summary ───────────────────────────────────────────────────────────────
    const summary = buildSummary(changesBySection);

    // ── Fingerprint ───────────────────────────────────────────────────────────
    // jobRevision: we use job.updated_date as a proxy since Job has no explicit revision field
    const jobRevision = job.updated_date || job.updatedAt || '0';
    const previewFingerprint = computePreviewFingerprint(
      job.id, job.sourceVersionId, targetVersionId, jobRevision, overrideRevision, changesBySection
    );

    // ── Build section-display-friendly structure ──────────────────────────────
    const allSectionTypes = [...SECTION_ORDER, 'metadata'].filter(st =>
      changesBySection[st] && changesBySection[st].length > 0
    );

    return Response.json({
      companyJobId: job.id,
      currentVersion: { id: baseVersion.id, versionNumber: baseVersion.versionNumber, publishedAt: baseVersion.publishedAt },
      targetVersion: { id: targetVersion.id, versionNumber: targetVersion.versionNumber, publishedAt: targetVersion.publishedAt },
      currentJobRevision: jobRevision,
      currentOverrideRevision: overrideRevision,
      previewFingerprint,
      generatedAt: new Date().toISOString(),
      updateEligible: true,
      overridePresent,
      summary,
      changesBySection,
      activeSectionTypes: allSectionTypes,
      sectionLabels: SECTION_LABELS,
      capabilities: {
        canAdoptVersion: isCompanyAdmin,
        canPreview: true,
      },
    });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}