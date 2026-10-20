/**
 * saveCompanyJob — Authorized company Job creation and editing.
 *
 * Replaces direct frontend Job.create / Job.update / JobSection.bulkCreate calls
 * from CreateJob.jsx and seedData.js (createJobWithSections).
 *
 * Actions:
 *   "create"      — Create a new company-owned Job (sourceType "company") with
 *                   six standard JobSections. Returns { job, sections }.
 *   "save_draft"  — Update an existing company Job with status "Draft".
 *                   Returns { job }.
 *   "publish"     — Update an existing company Job with status "Published".
 *                   Returns { job }.
 *
 * Authorization (server-side):
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId.
 *   - Role MUST be general_manager or project_manager.
 *   - For updates: the Job must belong to the caller's company and must NOT be
 *     a provisioned Essential SOP (sourceType === 'essential_sop'). Legacy
 *     Jobs with unset sourceType are treated as company-owned and are editable.
 *
 * Payload fields are whitelisted: companyId is verified from membership (not
 * trusted from the client for writes), and protected metadata fields
 * (sourceType, sourceMasterId, sourceVersionId, isCustomized, etc.) are never
 * accepted from the client.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { SECTION_TYPES, SECTION_META } from '../../shared/aiSopContent.ts';
import { getActiveMembership, isCompanyAdminRole } from '../../shared/companyAuth.ts';

const ALLOWED_JOB_FIELDS = [
  'title', 'shortDescription', 'trade', 'category', 'estimatedDuration', 'tags',
];

function sanitizeJobData(raw: any): any {
  const out: any = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of ALLOWED_JOB_FIELDS) {
    if (raw[k] !== undefined) {
      if (k === 'tags') {
        out[k] = Array.isArray(raw[k]) ? raw[k].filter((t: any) => typeof t === 'string').slice(0, 20) : [];
      } else if (typeof raw[k] === 'string') {
        out[k] = raw[k];
      }
    }
  }
  return out;
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { action, jobId, companyId, jobData } = body;

    if (!action || !['create', 'save_draft', 'publish'].includes(action)) {
      return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
    if (!companyId || typeof companyId !== 'string') {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Authorization: active membership + GM/PM role ───────────────────────
    const membership = await getActiveMembership(base44, user.id, companyId);
    if (!membership) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isCompanyAdminRole(membership.role)) {
      return Response.json({ error: 'Insufficient role to manage company jobs' }, { status: 403 });
    }

    const SR = base44.asServiceRole;
    const safeData = sanitizeJobData(jobData);

    if (!safeData.title || !safeData.title.trim()) {
      return Response.json({ error: 'Job title is required' }, { status: 400 });
    }

    const status = action === 'publish' ? 'Published' : 'Draft';

    // ── Action: create ──────────────────────────────────────────────────────
    if (action === 'create') {
      const job = await SR.entities.Job.create({
        companyId,
        title: safeData.title,
        shortDescription: safeData.shortDescription || '',
        trade: safeData.trade || '',
        category: safeData.category || '',
        estimatedDuration: safeData.estimatedDuration || '',
        tags: safeData.tags || [],
        status,
        isArchived: false,
        sourceType: 'company',
      });

      const sections = await SR.entities.JobSection.bulkCreate(
        SECTION_TYPES.map((st: string, i: number) => ({
          companyId,
          jobId: job.id,
          sectionType: st,
          title: SECTION_META[st].title,
          description: SECTION_META[st].description,
          sortOrder: i,
          completionStatus: 'Empty',
        }))
      );

      return Response.json({ job, sections });
    }

    // ── Action: save_draft / publish (update existing) ───────────────────────
    if (!jobId || typeof jobId !== 'string') {
      return Response.json({ error: 'jobId is required for updates' }, { status: 400 });
    }

    const job = await SR.entities.Job.get(jobId).catch(() => null);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });

    // Company isolation: the job must belong to the caller's verified company.
    if (job.companyId !== companyId) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Essential SOP jobs cannot be edited through this path (override system).
    // Legacy jobs with unset sourceType are treated as company-owned.
    if (job.sourceType === 'essential_sop') {
      return Response.json({ error: 'Essential SOP jobs must be customized through the override system.' }, { status: 403 });
    }

    const updated = await SR.entities.Job.update(jobId, { ...safeData, status });
    return Response.json({ job: updated });

  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}