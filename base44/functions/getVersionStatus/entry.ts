import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { sanitizeStoredOverride, VALID_SECTION_TYPES } from '../../shared/overrideSchema.js';

/**
 * getVersionStatus — Version Management Engine: status authority.
 *
 * Returns structured version awareness data for a provisioned Essential SOP Job.
 * This is the ONLY source of version status — never computed on the frontend.
 *
 * Response shape:
 * {
 *   pinnedVersion:    { id, versionNumber, publishedAt }
 *   newestVersion:    { id, versionNumber, publishedAt }
 *   availableVersions: [{ id, versionNumber, publishedAt, status }]  -- all eligible published versions
 *   updateAvailable:  boolean
 *   overridePresent:  boolean
 *   predictedConflicts: [{ sectionType, field, pinnedValue, newestValue }]
 *   compatibility:    'compatible' | 'conflicts_detected' | 'not_applicable'
 *   capabilities: {
 *     canAdoptVersion: boolean
 *   }
 * }
 *
 * Request: { jobId: string }
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { jobId } = body;
    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }

    const SR = base44.asServiceRole;

    // Load job
    let job: any;
    try { job = await SR.entities.Job.get(jobId); } catch (_) {}
    if (!job) return Response.json({ error: 'Job not found', code: 'NOT_FOUND' }, { status: 404 });

    // Membership check — company isolation
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId: job.companyId, status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    const membership = memberships[0];
    const isCompanyAdmin = membership.role === 'general_manager' || membership.role === 'project_manager';

    // Version status only applies to provisioned Essential SOP Jobs
    if (job.sourceType !== 'essential_sop') {
      return Response.json({
        pinnedVersion: null, newestVersion: null, availableVersions: [],
        updateAvailable: false, overridePresent: false,
        predictedConflicts: [], compatibility: 'not_applicable',
        capabilities: { canAdoptVersion: false },
      });
    }

    // Load all published versions for this master
    const allVersions = await SR.entities.EssentialSOPVersion.filter(
      { masterId: job.sourceMasterId, status: 'published' }, '-versionNumber', 50
    );
    if (!allVersions || allVersions.length === 0) {
      return Response.json({ error: 'No published versions found', code: 'NO_VERSIONS' }, { status: 409 });
    }

    // Available versions: all published — ordered newest first
    const availableVersions = allVersions
      .sort((a: any, b: any) => b.versionNumber - a.versionNumber)
      .map((v: any) => ({ id: v.id, versionNumber: v.versionNumber, publishedAt: v.publishedAt, status: v.status }));

    // Pinned version (currently adopted by this Job)
    const pinnedVersionRecord = allVersions.find((v: any) => v.id === job.sourceVersionId);
    const pinnedVersion = pinnedVersionRecord
      ? { id: pinnedVersionRecord.id, versionNumber: pinnedVersionRecord.versionNumber, publishedAt: pinnedVersionRecord.publishedAt }
      : null;

    // Newest published version
    const newestRecord = availableVersions[0];
    const newestVersion = { id: newestRecord.id, versionNumber: newestRecord.versionNumber, publishedAt: newestRecord.publishedAt };

    const updateAvailable = !!pinnedVersionRecord && newestRecord.id !== job.sourceVersionId;

    // Load company override
    const overrides = await SR.entities.JobOverride.filter({ companyId: job.companyId, jobId: job.id });
    const override: any = overrides?.[0] || null;
    const overridePresent = !!override;

    // Conflict prediction: compare override sections against newest version's sections
    // A conflict exists when: company has overridden a section AND the newest master changed that section
    let predictedConflicts: any[] = [];
    let compatibility: string = 'compatible';

    if (updateAvailable && overridePresent && override?.overrideData) {
      const { sanitized: sanitizedOverride } = sanitizeStoredOverride(override.overrideData, job.id);
      const overriddenSections = new Set(Object.keys(sanitizedOverride?.sectionOverrides || {}));
      const hasOverriddenTitle = !!sanitizedOverride?.title;
      const hasOverriddenDesc = !!sanitizedOverride?.shortDescription;

      if (overriddenSections.size > 0 || hasOverriddenTitle || hasOverriddenDesc) {
        // Load sections for BOTH pinned and newest versions
        const [pinnedSections, newestSections] = await Promise.all([
          SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: job.sourceVersionId }, 'sortOrder', 10),
          SR.entities.EssentialSOPSection.filter({ masterId: job.sourceMasterId, versionId: newestRecord.id }, 'sortOrder', 10),
        ]);

        // Load master record for title/description comparison
        let masterRecord: any = null;
        try { masterRecord = await SR.entities.EssentialSOPMaster.get(job.sourceMasterId); } catch (_) {}

        // Compare each overridden section against the newest version
        for (const st of overriddenSections) {
          if (!VALID_SECTION_TYPES.has(st)) continue;
          const pinnedSection = (pinnedSections || []).find((s: any) => s.sectionType === st);
          const newestSection = (newestSections || []).find((s: any) => s.sectionType === st);
          if (!pinnedSection || !newestSection) continue;

          // Compare contentItems by serializing — if they differ, master changed this section
          const pinnedContent = JSON.stringify(pinnedSection.contentItems || []);
          const newestContent = JSON.stringify(newestSection.contentItems || []);
          if (pinnedContent !== newestContent) {
            predictedConflicts.push({
              sectionType: st,
              field: 'sectionContent',
              description: `Master changed the '${st}' section. Your company override for this section may need review.`,
            });
          }
        }

        // Check title/description conflicts (company overrode title, and master title changed between versions)
        // We cannot compare pinned vs newest master title directly since EssentialSOPMaster.title reflects
        // the current title. We flag this only if the master record has been updated since pinned version.
        // As a conservative measure: if company overrode title/desc, note it as a potential conflict when
        // the pinned version is not the newest (any master change could have included title).
        if (updateAvailable) {
          if (hasOverriddenTitle) {
            predictedConflicts.push({
              sectionType: 'metadata',
              field: 'title',
              description: 'Company has a custom title override. Verify it is still appropriate after the version update.',
            });
          }
          if (hasOverriddenDesc) {
            predictedConflicts.push({
              sectionType: 'metadata',
              field: 'shortDescription',
              description: 'Company has a custom description override. Verify it is still appropriate after the version update.',
            });
          }
        }
      }

      compatibility = predictedConflicts.length > 0 ? 'conflicts_detected' : 'compatible';
    }

    return Response.json({
      pinnedVersion,
      newestVersion,
      availableVersions,
      updateAvailable,
      overridePresent,
      predictedConflicts,
      compatibility,
      capabilities: {
        canAdoptVersion: isCompanyAdmin,
      },
    });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}