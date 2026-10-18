/**
 * generateCompanySopDraft — AI company SOP authoring.
 *
 * Exposes the SAME AI authoring architecture as the platform
 * generateMasterSopDraft to authorized company users, adapted safely for
 * company-owned SOPs (Job / JobSection / SectionContent entities).
 *
 * TWO actions:
 *   - "generate"         : full six-section draft from a prompt (+ optional
 *                          title/trade/category hints). Creates a DRAFT Job
 *                          (status "Draft", sourceType "company") + six
 *                          JobSections + SectionContent. Returns { jobId, job }.
 *   - "regenerate_section": generate content items for ONE section of an
 *                          existing company-created draft. Returns items only
 *                          (NO persistence) so the editor can replace just
 *                          that section after the user confirms. Never touches
 *                          provisioned Essential SOP jobs.
 *
 * HARD AI AUTHORITY LIMIT (same as the platform builder):
 *   - NEVER publishes a Job (status stays "Draft").
 *   - NEVER modifies an approved/published SOP.
 *   - NEVER creates or alters platform Master SOPs / Essential SOP records.
 *   - NEVER triggers provisioning, distribution, or sync.
 *
 * AUTHORIZATION (server-side, not just UI):
 *   - Authenticated user with an ACTIVE CompanyMembership for the companyId.
 *   - Role MUST be general_manager or project_manager (matches the existing
 *     canCustomizeCompanyJobs / validateJobMutation gate). project_lead and
 *     technician are rejected (403) — they use the edit-request workflow or
 *     read-only access respectively.
 *   - Company isolation: every read/write is scoped to the caller's companyId.
 *
 * Reuses shared aiSopContent (system prompt, schema, validation) so company
 * AI output is identical in structure/quality to the platform builder.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  SYSTEM_PROMPT,
  RESPONSE_SCHEMA,
  validateAndCleanAiSop,
  SECTION_META,
  SECTION_TYPES,
  buildSectionPrompt,
  SECTION_RESPONSE_SCHEMA,
  validateSectionItems,
} from '../../shared/aiSopContent.ts';

const COMPANY_ADMIN_ROLES = new Set(['general_manager', 'project_manager']);

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : 'generate';
    const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
    if (!companyId) {
      return Response.json({ error: 'companyId is required' }, { status: 400 });
    }

    // ── Authorization: active company membership + GM/PM role ───────────────
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id,
      companyId,
      status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const membership = memberships[0];
    if (!COMPANY_ADMIN_ROLES.has(membership.role)) {
      return Response.json({ error: 'Insufficient role to author company SOPs' }, { status: 403 });
    }

    const SR = base44.asServiceRole;

    // ── Action: generate full draft ─────────────────────────────────────────
    if (action === 'generate') {
      const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
      if (!prompt) {
        return Response.json({ code: 'INVALID_PROMPT', error: 'A non-empty prompt is required.' }, { status: 400 });
      }
      if (prompt.length > 4000) {
        return Response.json({ code: 'INVALID_PROMPT', error: 'Prompt is too long (max 4000 characters).' }, { status: 400 });
      }
      const titleHint = typeof body?.title === 'string' ? body.title.trim() : '';
      const tradeHint = typeof body?.trade === 'string' ? body.trade.trim() : '';
      const categoryHint = typeof body?.category === 'string' ? body.category.trim() : '';

      const hints: string[] = [];
      if (titleHint) hints.push(`TITLE HINT: ${titleHint}`);
      if (tradeHint) hints.push(`TRADE HINT: ${tradeHint}`);
      if (categoryHint) hints.push(`CATEGORY HINT: ${categoryHint}`);
      const fullPrompt = `${SYSTEM_PROMPT}\n\nUSER REQUEST:\n${prompt}${hints.length ? '\n' + hints.join('\n') : ''}`;

      let aiRaw: any;
      try {
        aiRaw = await base44.integrations.Core.InvokeLLM({
          prompt: fullPrompt,
          response_json_schema: RESPONSE_SCHEMA,
        });
      } catch (e: any) {
        return Response.json(
          { code: 'AI_ERROR', error: 'AI generation failed. Please try again.', detail: e?.message || 'unknown_error' },
          { status: 502 }
        );
      }
      if (typeof aiRaw === 'string') {
        try { aiRaw = JSON.parse(aiRaw); } catch (_) {
          return Response.json({ code: 'AI_OUTPUT_INVALID', error: 'AI returned a non-JSON response.' }, { status: 422 });
        }
      }

      const validation = validateAndCleanAiSop(aiRaw);
      if (!validation.ok) {
        return Response.json(
          { code: 'AI_OUTPUT_INVALID', error: 'AI output did not match the expected structure. No draft was created.', details: validation.errors },
          { status: 422 }
        );
      }
      const sop = validation.sop;

      // Create a DRAFT company Job (never published). sourceType 'company' so it
      // is editable through the normal company content path (not the Essential
      // SOP override system).
      const job = await SR.entities.Job.create({
        companyId,
        title: sop.title,
        shortDescription: sop.description || '',
        trade: sop.trade || tradeHint || '',
        category: sop.category || categoryHint || '',
        tags: sop.tags || [],
        status: 'Draft',
        isArchived: false,
        sourceType: 'company',
      });

      // Six JobSections (mirrors createJobWithSections).
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

      // SectionContent for every section the AI populated.
      const allContent: any[] = [];
      for (const sec of sections) {
        const items = sop.sections[sec.sectionType] || [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          allContent.push({
            companyId,
            sectionId: sec.id,
            jobId: job.id,
            sectionType: sec.sectionType,
            contentType: it.contentType,
            title: it.title,
            body: it.body || '',
            sortOrder: i,
            isRequired: !!it.isRequired,
            isCritical: !!it.isCritical,
            metadata: it.metadata || {},
          });
        }
      }
      if (allContent.length > 0) {
        try {
          await SR.entities.SectionContent.bulkCreate(allContent);
        } catch (e: any) {
          // Best-effort cleanup of the draft created by THIS request only.
          try { await SR.entities.SectionContent.deleteMany({ jobId: job.id }); } catch (_) {}
          try { await SR.entities.JobSection.deleteMany({ jobId: job.id }); } catch (_) {}
          try { await SR.entities.Job.delete(job.id); } catch (_) {}
          return Response.json(
            { code: 'CONTENT_PERSIST_FAILED', error: 'AI content could not be saved to the draft. Please try again.', detail: e?.message || '' },
            { status: 500 }
          );
        }
      }

      return Response.json({ jobId: job.id, job, source: 'AI_BUILDER' });
    }

    // ── Action: regenerate a single section (no persistence) ─────────────────
    if (action === 'regenerate_section') {
      const jobId = typeof body?.jobId === 'string' ? body.jobId : '';
      const sectionType = typeof body?.sectionType === 'string' ? body.sectionType : '';
      const instruction = typeof body?.instruction === 'string' ? body.instruction.trim().slice(0, 2000) : '';
      if (!jobId) return Response.json({ error: 'jobId is required' }, { status: 400 });
      if (!sectionType || !SECTION_TYPES.includes(sectionType as any)) {
        return Response.json({ error: 'Invalid sectionType' }, { status: 400 });
      }

      // Load the job and verify it belongs to this company and is company-owned.
      // Provisioned Essential SOP jobs are NEVER editable here (override system).
      const job: any = await SR.entities.Job.get(jobId).catch(() => null);
      if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
      if (job.companyId !== companyId) return Response.json({ error: 'Forbidden' }, { status: 403 });
      if (job.sourceType === 'essential_sop') {
        return Response.json({ error: 'Essential SOP jobs cannot be edited through company AI authoring.' }, { status: 403 });
      }

      // Existing items for refine/rewrite context.
      const existing: any[] = await SR.entities.SectionContent.filter(
        { jobId, sectionType }, 'sortOrder', 50
      ).catch(() => []);

      const prompt = buildSectionPrompt(
        sectionType,
        { title: job.title, trade: job.trade, category: job.category },
        instruction,
        existing || []
      );

      let aiRaw: any;
      try {
        aiRaw = await base44.integrations.Core.InvokeLLM({
          prompt,
          response_json_schema: SECTION_RESPONSE_SCHEMA,
        });
      } catch (e: any) {
        return Response.json(
          { code: 'AI_ERROR', error: 'AI generation failed. Please try again.', detail: e?.message || 'unknown_error' },
          { status: 502 }
        );
      }
      if (typeof aiRaw === 'string') {
        try { aiRaw = JSON.parse(aiRaw); } catch (_) {
          return Response.json({ code: 'AI_OUTPUT_INVALID', error: 'AI returned a non-JSON response.' }, { status: 422 });
        }
      }

      const v = validateSectionItems(aiRaw, sectionType);
      if (!v.ok) {
        return Response.json(
          { code: 'AI_OUTPUT_INVALID', error: 'AI output did not match the expected structure.', details: v.errors },
          { status: 422 }
        );
      }
      // Return items only — the editor applies them after user confirmation.
      return Response.json({ sectionType, items: v.items });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error: any) {
    return Response.json({ code: 'UNEXPECTED', error: error?.message || 'Unexpected error during AI generation.' }, { status: 500 });
  }
}