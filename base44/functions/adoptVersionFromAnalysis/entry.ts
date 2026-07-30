import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { executeAdoptionFromAnalysis } from '../../shared/adoptionEngine.ts';

/**
 * adoptVersionFromAnalysis — Edit 5C: Analysis-driven version adoption endpoint.
 *
 * Consumes a completed CompanyVersionAnalysis (produced by Edit 5B analyzeVersionUpdate)
 * and executes adoption. NEVER re-runs versionDiff or versionAnalysis.
 *
 * Authorization: Company Admin (general_manager, project_manager) only.
 * Platform Super Admins are NOT authorized — adoption is a company action.
 *
 * Request body:
 * {
 *   companyJobId:             string  — Job.id to adopt
 *   analysisId:               string  — CompanyVersionAnalysis.id to consume
 *   reviewDecisions:          object  — { [logicalItemId]: 'KEEP_COMPANY' | 'USE_NEW_MASTER' }
 *                                       Pass {} if analysis.canAutoAdopt === true
 *   mutationKey:              string  — client idempotency key
 *   expectedOverrideRevision: number  — override.revision seen at time of analysis (0 if none)
 * }
 *
 * Response (success):
 * {
 *   success: true
 *   idempotent?: true        — if same mutationKey already completed
 *   jobId, previousVersionId, newVersionId, analysisId
 *   auditPending: boolean
 *   adoptionSummary: { safeApplied, reviewDecisionsKept, reviewDecisionsAccepted,
 *                      orphanedPreserved, noOpPreserved, companyOnlyPreserved,
 *                      overrideRebased, overrideRemoved }
 *   resolvedJob: { job, sections, contentBySection, capabilities, override }
 * }
 *
 * Error codes:
 *   INVALID_INPUT               — missing/malformed required fields
 *   AUTH_REQUIRED               — not authenticated
 *   FORBIDDEN                   — not a member of this company
 *   INSUFFICIENT_ROLE           — not a company admin
 *   JOB_NOT_FOUND               — Job.id not found
 *   ANALYSIS_NOT_FOUND          — CompanyVersionAnalysis.id not found
 *   ANALYSIS_NOT_COMPLETE       — analysis.status !== 'COMPLETED'
 *   ANALYSIS_JOB_MISMATCH       — analysis.companyJobId !== companyJobId
 *   ANALYSIS_VERSION_MISMATCH   — analysis.fromVersionId !== job.sourceVersionId
 *   ANALYSIS_STALE              — override changed after analysis
 *   ALREADY_CURRENT             — job already on target version (different mutationKey)
 *   REVIEW_DECISIONS_REQUIRED   — canAutoAdopt=false with missing decisions
 *   INVALID_DECISION_VALUE      — decision value is not KEEP_COMPANY or USE_NEW_MASTER
 *   INVALID_ITEMS_PRESENT       — analysis has INVALID items; fix override first
 *   REVISION_CONFLICT           — override changed since expectedOverrideRevision
 *   NOT_ESSENTIAL_SOP           — job is not a provisioned SOP
 *   TARGET_VERSION_NOT_FOUND    — target version missing
 *   TARGET_VERSION_NOT_PUBLISHED — target version not published
 *   VERSION_MASTER_MISMATCH     — target belongs to different master
 *   OVERRIDE_DELETE_FAILED      — atomic step A failed (delete)
 *   OVERRIDE_UPDATE_FAILED      — atomic step A failed (update)
 *   OVERRIDE_CREATE_FAILED      — atomic step A failed (create)
 *   JOB_VERSION_UPDATE_FAILED   — atomic step B failed (rebaseIncomplete set)
 *   REBASE_VALIDATION_FAILED    — rebased override failed schema validation
 *   INTERNAL_ERROR              — unexpected error
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── Authentication ─────────────────────────────────────────────────────────
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    // ── Parse body ─────────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { companyJobId, analysisId, reviewDecisions, mutationKey, expectedOverrideRevision } = body;

    const SR = base44.asServiceRole;

    // ── Delegate to canonical engine ───────────────────────────────────────────
    const { result, error } = await executeAdoptionFromAnalysis(base44, SR, {
      companyJobId,
      analysisId,
      reviewDecisions: reviewDecisions || {},
      mutationKey,
      expectedOverrideRevision,
    }, user.id);

    if (error) return error;
    if (!result) return Response.json({ error: 'Adoption engine returned no result', code: 'INTERNAL_ERROR' }, { status: 500 });

    // ── Resolve and return final job state ──────────────────────────────────────
    // Load the updated job to resolve for the response
    const updatedJob = await SR.entities.Job.get(companyJobId).catch(() => null);
    let resolvedJob: any = null;

    if (updatedJob) {
      const memberships = await base44.entities.CompanyMembership.filter({
        userId: user.id, companyId: updatedJob.companyId, status: 'active',
      }).catch(() => []);
      const membership = memberships?.[0] || null;

      if (membership) {
        // Re-use internal resolver from adoptionEngine (inline here to avoid circular import)
        const { sanitizeStoredOverride, VALID_SECTION_TYPES } = await import('../../shared/overrideSchema.js');

        const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
        const SECTION_TITLES: Record<string, string> = {
          tools: 'Tools', materials: 'Materials', scope: 'Scope',
          procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
        };
        const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';
        const capabilities = {
          canEditContent: false, canCreateContent: false, canDeleteContent: false,
          canReorderContent: false, canChangeSectionStatus: false, canEditJobMetadata: false,
          canCustomize: isCompanyAdmin,
        };

        const masterSections = await SR.entities.EssentialSOPSection.filter(
          { masterId: updatedJob.sourceMasterId, versionId: updatedJob.sourceVersionId }, 'sortOrder', 10
        ).catch(() => []) || [];

        const overrides = await SR.entities.JobOverride.filter({ companyId: updatedJob.companyId, jobId: updatedJob.id }).catch(() => []);
        const override: any = overrides?.[0] || null;
        let sanitizedOverrideData: any = null;
        if (override?.overrideData) {
          const { sanitized } = sanitizeStoredOverride(override.overrideData, updatedJob.id);
          sanitizedOverrideData = sanitized;
        }

        const sections = SECTION_ORDER.map((st: string, i: number) => {
          const ms = masterSections.find((s: any) => s.sectionType === st);
          if (!ms) return null;
          return { id: ms.id, jobId: updatedJob.id, companyId: updatedJob.companyId, sectionType: st, title: SECTION_TITLES[st] || st, sortOrder: i, completionStatus: 'Empty' };
        }).filter(Boolean);

        const contentBySection: Record<string, any[]> = {};
        for (const ms of masterSections) {
          const st = ms.sectionType;
          if (!st || !(VALID_SECTION_TYPES as Set<string>).has(st)) continue;
          const sectionOverride = sanitizedOverrideData?.sectionOverrides?.[st] || null;
          const sourceItems = sectionOverride || ms.contentItems || [];
          const isOv = !!sectionOverride;
          contentBySection[st] = (sourceItems as any[]).map((item: any, idx: number) => ({
            id: item._itemId || (isOv ? `o_${ms.id}_${idx}` : `m_${ms.id}_${idx}`),
            jobId: updatedJob.id, companyId: updatedJob.companyId, sectionId: ms.id, sectionType: st,
            contentType: item.contentType || 'text',
            title: typeof item.title === 'string' ? item.title : '',
            body: typeof item.body === 'string' ? item.body : '',
            sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
            isRequired: typeof item.isRequired === 'boolean' ? item.isRequired : false,
            isCritical: typeof item.isCritical === 'boolean' ? item.isCritical : false,
            metadata: (item.metadata && typeof item.metadata === 'object') ? item.metadata : {},
          })).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
        }

        const resolvedTitle = sanitizedOverrideData?.title || updatedJob.title;
        const resolvedShortDescription = sanitizedOverrideData?.shortDescription || updatedJob.shortDescription;
        const { sourceMasterId: _sm, sourceVersionId: _sv, sourceType: _st, isCustomized: _ic,
                customizedAt: _ca, customizedBy: _cb, ...publicJobFields } = updatedJob;

        resolvedJob = {
          job: { ...publicJobFields, title: resolvedTitle, shortDescription: resolvedShortDescription },
          sections, contentBySection, capabilities,
          override: override ? { revision: override.revision, customizedFields: override.customizedFields, auditPending: override.auditPending || false } : null,
        };
      }
    }

    return Response.json({ ...result, resolvedJob });

  } catch (err: any) {
    console.error('[adoptVersionFromAnalysis] Unexpected error:', err);
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}