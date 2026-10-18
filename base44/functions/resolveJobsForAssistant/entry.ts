import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveAssistantContext } from '../../shared/assistantRetrieval.ts';

/**
 * resolveJobsForAssistant — Resolver-backed search service for the Assistant.
 *
 * Returns company Jobs + resolved content for search — including provisioned
 * Essential SOP content merged with company overrides. Retrieval logic lives
 * in the shared `assistantRetrieval` module so the AI assistant reuses it
 * rather than duplicating merge logic.
 *
 * Request:  { companyId: string }
 * Response: { jobs: JobSummary[], contentIndex: ContentIndexEntry[] }
 */
export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { companyId } = body;
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // Verify caller is an active member of this company (company data isolation)
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { jobs, contentIndex } = await resolveAssistantContext(base44.asServiceRole, companyId);
    return Response.json({ jobs, contentIndex });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}