import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { analyzeCompanyJobVersionUpdate } from '../../shared/versionAnalysisService.ts';

/**
 * analyzeVersionUpdate — Backend endpoint for version compatibility analysis.
 *
 * Delegates entirely to the canonical analyzeCompanyJobVersionUpdate() service.
 * No analysis logic lives here.
 *
 * Authorization:
 *   - Platform Super Admin: may analyze any company job
 *   - Company Admin (general_manager, project_manager): own company jobs only
 *   - Technicians and non-members: FORBIDDEN
 *
 * This is a read-only analysis endpoint. It MUST NOT:
 *   - Change Job.sourceVersionId
 *   - Change CompanyVersionDecision status
 *   - Create, modify, or delete JobOverride records
 *   - Perform adoption
 *   - Create notifications
 *
 * Request: { companyJobId, targetVersionId, companyVersionDecisionId? }
 * Response: AnalysisResult or { error, code }
 */

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { companyJobId, targetVersionId, companyVersionDecisionId } = body;

    const { result, error } = await analyzeCompanyJobVersionUpdate(base44, {
      companyJobId,
      targetVersionId,
      companyVersionDecisionId: companyVersionDecisionId || null,
    });

    if (error) return error;
    return Response.json(result);

  } catch (err: any) {
    return Response.json({ error: 'An unexpected error occurred.', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}