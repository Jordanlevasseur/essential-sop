/**
 * generateMasterSopDraft — AI Master SOP Builder (Stage 1).
 *
 * Takes a natural-language prompt from a Platform Super Admin, calls the
 * built-in Core.InvokeLLM integration with a strict JSON schema, validates
 * the structured output, and — only if validation passes — creates an
 * Essential SOP Master DRAFT (master + six sections with contentItems).
 *
 * HARD AI AUTHORITY LIMIT:
 *   This function may ONLY create draft master content. It must NEVER:
 *     - publish a Master SOP
 *     - create a published version
 *     - trigger distribution
 *     - assign companies
 *     - create or modify ProvisioningRecords
 *     - trigger synchronization
 *     - create or modify Company Jobs
 *   It calls createMasterSopDraft (master + 6 empty sections) and writes
 *   contentItems onto the draft sections. Publishing remains an explicit
 *   human action through the existing manageMasterSOP/publish flow.
 *
 * AUTHORIZATION:
 *   requirePlatformSuperAdmin — only users holding an active PlatformMembership
 *   with platformRole SUPER_ADMIN may call. Enforced server-side, not just UI.
 *
 * VALIDATION:
 *   - The AI response must be an object.
 *   - title must be a non-empty string.
 *   - sections must be an object; each is coerced to an array; malformed items
 *     are dropped; invalid contentType is coerced to the section default.
 *   - Must yield >= 1 usable content item total, else 422 with zero writes.
 *   - On any validation or AI failure, returns an error and creates NO entities.
 *
 * DRAFT PERSISTENCE:
 *   Reuses the existing early-draft architecture: a draft master + six draft
 *   sections are created immediately (same as manageMasterSOP/create). The
 *   contentItems are written onto the draft sections. The user then reviews
 *   and edits in the normal MasterSOPEditor (autosave + publish flow).
 *   No separate AI persistence system exists.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin, writePlatformAudit } from '../../shared/platformAuth.ts';
import {
  createMasterSopDraft,
  ensureLogicalItemIds,
} from '../../shared/masterSopDraftFactory.ts';
import {
  SYSTEM_PROMPT,
  RESPONSE_SCHEMA,
  validateAndCleanAiSop,
} from '../../shared/aiSopContent.ts';

/**
 * cleanupAiDraft — best-effort cleanup of a draft Master SOP created by THIS
 * AI generation request only. Deletes the master's six draft sections, then
 * the master record itself. NEVER touches any other master. Returns true if
 * the master record was deleted, false if deletion failed (orphan remains).
 */
async function cleanupAiDraft(SR: any, masterId: string): Promise<boolean> {
  try {
    await SR.entities.EssentialSOPSection.deleteMany({ masterId, versionId: 'draft' });
  } catch (_) {
    // best-effort; continue to attempt master deletion
  }
  try {
    await SR.entities.EssentialSOPMaster.delete(masterId);
    return true;
  } catch (_) {
    return false;
  }
}

export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    // ── Authorization: Platform Super Admin only ────────────────────────────
    const { user, error: authError } = await requirePlatformSuperAdmin(base44);
    if (authError) return authError;

    // ── Parse + validate prompt ─────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      return Response.json(
        { code: 'INVALID_PROMPT', error: 'A non-empty prompt is required.' },
        { status: 400 }
      );
    }
    if (prompt.length > 4000) {
      return Response.json(
        { code: 'INVALID_PROMPT', error: 'Prompt is too long (max 4000 characters).' },
        { status: 400 }
      );
    }

    const SR = base44.asServiceRole;
    const now = new Date().toISOString();

    // ── Call the AI — Core.InvokeLLM with a JSON schema ─────────────────────
    // Using the default ('automatic') model. response_json_schema returns a dict.
    let aiRaw: any;
    try {
      aiRaw = await base44.integrations.Core.InvokeLLM({
        prompt: `${SYSTEM_PROMPT}\n\nUSER REQUEST:\n${prompt}`,
        response_json_schema: RESPONSE_SCHEMA,
      });
    } catch (e: any) {
      return Response.json(
        {
          code: 'AI_ERROR',
          error: 'AI generation failed. Please try again.',
          detail: e?.message || 'unknown_error',
        },
        { status: 502 }
      );
    }

    // InvokeLLM with a schema returns a dict; guard against a string fallback
    if (typeof aiRaw === 'string') {
      try { aiRaw = JSON.parse(aiRaw); } catch (_) {
        return Response.json(
          { code: 'AI_OUTPUT_INVALID', error: 'AI returned a non-JSON response.' },
          { status: 422 }
        );
      }
    }

    // ── Validate the AI output (no entity writes before validation passes) ─
    const validation = validateAndCleanAiSop(aiRaw);
    if (!validation.ok) {
      return Response.json(
        {
          code: 'AI_OUTPUT_INVALID',
          error: 'AI output did not match the expected structure. No draft was created.',
          details: validation.errors,
        },
        { status: 422 }
      );
    }
    const sop = validation.sop;

    // ── Create the draft master + six empty sections (canonical factory) ────
    // This is the SAME early-draft architecture as manual manageMasterSOP/create.
    // The factory creates the master first, then six sections. If it throws
    // during section scaffolding the master.id is not returned to us, so cleanup
    // is not possible here — we report the scaffolding failure explicitly. (This
    // matches manual creation's failure mode and is not introduced by the AI flow.)
    let master: any;
    try {
      master = await createMasterSopDraft(SR, {
        title: sop.title,
        category: sop.category || '',
        trade: sop.trade || '',
        description: sop.description || '',
        tags: sop.tags || [],
        userId: user.id,
        now,
      });
    } catch (e: any) {
      return Response.json(
        {
          code: 'CREATE_FAILED',
          error: 'Failed to create the draft Master SOP scaffolding (master + sections). No AI content was written.',
          detail: e?.message || '',
        },
        { status: 500 }
      );
    }

    // ── Prepare ALL six section content payloads BEFORE any content write ──
    // All AI content is already validated. We map every section that has AI items
    // into a single bulk-update payload, so content persistence is ONE batch write
    // rather than six independent writes. This eliminates the silent partial-
    // population failure mode: either ALL validated AI content is stored, or the
    // failure is reported and the draft created by THIS request is cleaned up.
    let draftSections: any[] = [];
    try {
      draftSections = await SR.entities.EssentialSOPSection.filter(
        { masterId: master.id, versionId: 'draft' },
        'sortOrder',
        10
      ) || [];
    } catch (e: any) {
      const cleaned = await cleanupAiDraft(SR, master.id);
      return Response.json(
        {
          code: 'SECTION_READ_FAILED',
          error: cleaned
            ? 'Draft was created but its sections could not be read back for content persistence. The partial draft was cleaned up. Please try again.'
            : 'Draft was created but its sections could not be read back, AND automatic cleanup failed. A partial draft remains and must be deleted manually from the Master Library.',
          masterId: master.id,
          cleanedUp: cleaned,
        },
        { status: 500 }
      );
    }

    const bulkPayload: any[] = [];
    for (const sec of draftSections) {
      const rawItems = sop.sections[sec.sectionType] || [];
      if (!Array.isArray(rawItems) || rawItems.length === 0) continue;
      const mapped = rawItems.map((it: any, i: number) => ({
        contentType: it.contentType,
        title: it.title,
        body: it.body || '',
        sortOrder: i,
        isRequired: !!it.isRequired,
        isCritical: !!it.isCritical,
        metadata: it.metadata || {},
      }));
      const withIds = ensureLogicalItemIds(mapped, master.id);
      bulkPayload.push({ id: sec.id, contentItems: withIds });
    }

    // ── Persist all section content in ONE supported batch operation ────────
    // bulkUpdate is the platform's existing batch write for multiple records — a
    // single call that either completes for all entries or throws, with no silent
    // per-section swallowing. draftRevision stays 0 (the editor loads revision 0
    // and the first user edit sends expected 0, matching the server).
    if (bulkPayload.length > 0) {
      try {
        await SR.entities.EssentialSOPSection.bulkUpdate(bulkPayload);
      } catch (e: any) {
        // Content persistence failed AFTER the master draft was created. Clean up
        // the EXACT draft created by this request (its six draft sections + the
        // master record). We never touch any pre-existing master.
        const cleaned = await cleanupAiDraft(SR, master.id);
        if (cleaned) {
          return Response.json(
            {
              code: 'SECTION_CONTENT_PERSIST_FAILED',
              error: 'AI content could not be saved to the draft sections. The partial draft created by this request was cleaned up. Please try again.',
              masterId: master.id,
              cleanedUp: true,
              detail: e?.message || '',
            },
            { status: 500 }
          );
        }
        // Cleanup itself failed — surface the orphaned draft id explicitly so the
        // admin can delete it manually. Do NOT report a generic generation failure.
        return Response.json(
          {
            code: 'SECTION_CONTENT_PERSIST_FAILED_CLEANUP_FAILED',
            error: 'AI content could not be saved AND automatic cleanup failed. A partial draft remains and must be deleted manually from the Master Library.',
            masterId: master.id,
            cleanedUp: false,
            detail: e?.message || '',
          },
          { status: 500 }
        );
      }
    }

    // ── Audit (best-effort; a failed audit must NOT mask the successful draft) ─
    try {
      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'master_sop_created',
        extra: {
          masterId: master.id,
          masterTitle: master.title,
          metadata: {
            source: 'AI_BUILDER',
            promptLength: prompt.length,
            promptSnippet: prompt.slice(0, 200),
          },
        },
      });
    } catch (_) {
      // Draft is complete and usable. Audit failure is non-fatal.
    }

    return Response.json({
      masterId: master.id,
      master,
      source: 'AI_BUILDER',
    });
  } catch (error: any) {
    return Response.json(
      { code: 'UNEXPECTED', error: error?.message || 'Unexpected error during AI generation.' },
      { status: 500 }
    );
  }
}