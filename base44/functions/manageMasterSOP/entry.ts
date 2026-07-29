import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin, writePlatformAudit } from '../../shared/platformAuth.ts';
import { publishMasterSOPVersion, updateDistributionPolicy } from '../../shared/publishingOrchestration.ts';

/**
 * manageMasterSOP — All Essential SOP Master Library and platform role operations.
 *
 * Master Library actions (require esop_admin or admin):
 *   create          — Create a new Master SOP (Draft)
 *   update_draft    — Update fields on a Draft master or its sections
 *   delete_draft    — Delete a Draft master (and its sections)
 *   duplicate       — Duplicate a Master SOP as a new Draft
 *   publish         — Publish current Draft → immutable EssentialSOPVersion
 *   archive         — Archive a Master SOP
 *   get_history     — Return version history for a master
 *   get_version     — Return sections for a specific published version
 *   list            — List all masters (with optional status filter)
 *   get             — Get one master with its current draft sections
 *
 * Platform role actions (require admin only):
 *   manage_role     — Assign or remove platform roles (esop_admin, admin)
 *
 * Authorization is enforced server-side on every write operation.
 * Every write action produces an immutable PlatformAuditLog entry.
 * The platform is NOT represented as a company. Platform roles live on User only.
 */

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { action } = body;
    if (!action) return Response.json({ error: 'action is required' }, { status: 400 });

    const now = new Date().toISOString();
    const SR = base44.asServiceRole;

    // ── MANAGE ROLE (platform super admin only) ──────────────────────────────
    // Only an active PlatformMembership(SUPER_ADMIN) may grant or revoke
    // platform memberships. Users may never modify their own platform membership.
    if (action === 'manage_role') {
      const { user, error: authError } = await requirePlatformSuperAdmin(base44);
      if (authError) return authError;

      const { targetUserId, role, operation } = body; // operation: 'assign' | 'remove'

      // Input validation — 400 for missing or structurally invalid inputs
      if (!targetUserId || typeof targetUserId !== 'string' || !targetUserId.trim()) {
        return Response.json({ error: 'targetUserId is required' }, { status: 400 });
      }
      if (!role || typeof role !== 'string') {
        return Response.json({ error: 'role is required' }, { status: 400 });
      }
      if (!operation || !['assign', 'remove'].includes(operation)) {
        return Response.json({ error: 'operation must be assign or remove' }, { status: 400 });
      }
      // manage_role now operates on PlatformMembership, not User.role.
      // operation: 'assign' creates/reactivates a PlatformMembership(SUPER_ADMIN)
      // operation: 'remove' suspends the existing PlatformMembership

      // Self-modification guard
      if (targetUserId === user.id) {
        return Response.json({ error: 'Users may not modify their own platform membership' }, { status: 403 });
      }

      let targetUser;
      try { targetUser = await SR.entities.User.get(targetUserId); } catch (_) {}
      if (!targetUser) return Response.json({ error: 'Target user not found' }, { status: 404 });

      const existingMemberships = await SR.entities.PlatformMembership.filter({ userId: targetUserId });
      const existing = existingMemberships?.[0] || null;

      if (operation === 'assign') {
        if (existing) {
          // Reactivate if suspended
          if (existing.status === 'ACTIVE') {
            return Response.json({ success: true, alreadyActive: true, membershipId: existing.id });
          }
          await SR.entities.PlatformMembership.update(existing.id, {
            status: 'ACTIVE',
            grantedByUserId: user.id,
            grantedAt: now,
            suspendedAt: null,
            suspendedByUserId: null,
            suspensionReason: null,
            updatedAt: now,
          });
          await writePlatformAudit(SR, {
            actingUserId: user.id,
            actingUserRole: 'SUPER_ADMIN',
            action: 'platform_role_assigned',
            targetUserId,
            newPlatformRole: 'SUPER_ADMIN',
            newPlatformStatus: 'ACTIVE',
            previousPlatformStatus: 'SUSPENDED',
          });
          return Response.json({ success: true, membershipId: existing.id });
        }
        const membership = await SR.entities.PlatformMembership.create({
          userId: targetUserId,
          platformRole: 'SUPER_ADMIN',
          status: 'ACTIVE',
          grantedByUserId: user.id,
          grantedAt: now,
          createdAt: now,
          updatedAt: now,
        });
        await writePlatformAudit(SR, {
          actingUserId: user.id,
          actingUserRole: 'SUPER_ADMIN',
          action: 'platform_role_assigned',
          targetUserId,
          newPlatformRole: 'SUPER_ADMIN',
          newPlatformStatus: 'ACTIVE',
        });
        return Response.json({ success: true, membershipId: membership.id });
      }

      // operation === 'remove' — suspend
      if (!existing || existing.status === 'SUSPENDED') {
        return Response.json({ success: true, alreadySuspended: true });
      }
      await SR.entities.PlatformMembership.update(existing.id, {
        status: 'SUSPENDED',
        suspendedByUserId: user.id,
        suspendedAt: now,
        updatedAt: now,
      });
      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'platform_role_removed',
        targetUserId,
        previousPlatformRole: 'SUPER_ADMIN',
        previousPlatformStatus: 'ACTIVE',
        newPlatformStatus: 'SUSPENDED',
      });
      return Response.json({ success: true, suspended: true, membershipId: existing.id });
    }

    // ── All remaining actions require an active PlatformMembership(SUPER_ADMIN) ─
    const { user, error: authError } = await requirePlatformSuperAdmin(base44);
    if (authError) return authError;

    // ── LIST ────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const { statusFilter } = body;
      const query = statusFilter ? { status: statusFilter } : {};
      const masters = await SR.entities.EssentialSOPMaster.filter(query, '-updatedAt', 200);
      return Response.json({ masters: masters || [] });
    }

    // ── GET ─────────────────────────────────────────────────────────────────
    if (action === 'get') {
      const { masterId } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      const sections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
      return Response.json({ master, sections: sections || [] });
    }

    // ── CREATE ───────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { title, category, trade, description } = body;
      if (!title) return Response.json({ error: 'title is required' }, { status: 400 });
      const slug = slugify(title) + '-' + Date.now().toString(36);
      const master = await SR.entities.EssentialSOPMaster.create({
        title,
        slug,
        category: category || '',
        trade: trade || '',
        description: description || '',
        status: 'draft',
        currentPublishedVersionId: null,
        createdAt: now,
        updatedAt: now,
      });
      const SECTION_TYPES = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
      const SECTION_TITLES = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };
      for (let i = 0; i < SECTION_TYPES.length; i++) {
        const st = SECTION_TYPES[i];
        await SR.entities.EssentialSOPSection.create({
          masterId: master.id,
          versionId: 'draft',
          sectionType: st,
          title: SECTION_TITLES[st],
          sortOrder: i,
          contentItems: [],
        });
      }
      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'master_sop_created',
        extra: { masterId: master.id, masterTitle: master.title },
      });
      return Response.json({ master });
    }

    // ── UPDATE DRAFT ─────────────────────────────────────────────────────────
    if (action === 'update_draft') {
      const { masterId, fields, sectionId, contentItems } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      if (master.status !== 'draft') return Response.json({ error: 'Only Draft SOPs may be edited' }, { status: 409 });

      if (fields) {
        const allowed = ['title', 'category', 'trade', 'description'];
        const update = {};
        for (const k of allowed) { if (fields[k] !== undefined) update[k] = fields[k]; }
        if (fields.title) update.slug = slugify(fields.title) + '-' + Date.now().toString(36);
        update.updatedAt = now;
        await SR.entities.EssentialSOPMaster.update(masterId, update);
      }

      if (sectionId && contentItems !== undefined) {
        const section = await SR.entities.EssentialSOPSection.get(sectionId);
        if (!section || section.masterId !== masterId || section.versionId !== 'draft') {
          return Response.json({ error: 'Draft section not found' }, { status: 404 });
        }
        await SR.entities.EssentialSOPSection.update(sectionId, { contentItems });
        await SR.entities.EssentialSOPMaster.update(masterId, { updatedAt: now });
      }

      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'master_sop_draft_updated',
        extra: { masterId, masterTitle: master.title, metadata: { fieldsUpdated: !!fields, sectionUpdated: !!sectionId } },
      });

      const updated = await SR.entities.EssentialSOPMaster.get(masterId);
      return Response.json({ master: updated });
    }

    // ── DELETE DRAFT ─────────────────────────────────────────────────────────
    if (action === 'delete_draft') {
      const { masterId } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      if (master.status !== 'draft') return Response.json({ error: 'Only Draft SOPs may be deleted' }, { status: 409 });
      const sections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' });
      for (const s of (sections || [])) {
        await SR.entities.EssentialSOPSection.delete(s.id);
      }
      // Write audit BEFORE deletion so title is still available
      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'master_sop_deleted',
        extra: { masterId, masterTitle: master.title },
      });
      await SR.entities.EssentialSOPMaster.delete(masterId);
      return Response.json({ success: true });
    }

    // ── DUPLICATE ────────────────────────────────────────────────────────────
    if (action === 'duplicate') {
      const { masterId } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const source = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!source) return Response.json({ error: 'Not found' }, { status: 404 });
      const newSlug = slugify(source.title) + '-copy-' + Date.now().toString(36);
      const newMaster = await SR.entities.EssentialSOPMaster.create({
        title: source.title + ' (Copy)',
        slug: newSlug,
        category: source.category,
        trade: source.trade,
        description: source.description || '',
        status: 'draft',
        currentPublishedVersionId: null,
        createdAt: now,
        updatedAt: now,
      });
      const sourceSections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
      for (const s of (sourceSections || [])) {
        await SR.entities.EssentialSOPSection.create({
          masterId: newMaster.id,
          versionId: 'draft',
          sectionType: s.sectionType,
          title: s.title,
          sortOrder: s.sortOrder,
          contentItems: s.contentItems || [],
        });
      }
      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'master_sop_duplicated',
        extra: { masterId: newMaster.id, masterTitle: newMaster.title, metadata: { sourceMasterId: masterId } },
      });
      return Response.json({ master: newMaster });
    }

    // ── PUBLISH ──────────────────────────────────────────────────────────────
    // All publishing flows through the canonical publishMasterSOPVersion
    // orchestration in base44/shared/publishingOrchestration.ts.
    if (action === 'publish') {
      const {
        masterId,
        publicationMutationKey,
        changeSummary,
        changeNotes, // legacy alias — accepted for backwards compatibility
        distributionPolicyOverride,
        selectedCompanyIds,
        _forceFailCompanyIds, // TEST-ONLY
      } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      if (!publicationMutationKey) return Response.json({ error: 'publicationMutationKey is required' }, { status: 400 });

      const { result, error: publishError } = await publishMasterSOPVersion(base44, {
        masterId,
        publicationMutationKey,
        changeSummary: changeSummary || changeNotes || '',
        distributionPolicyOverride,
        selectedCompanyIds,
        _forceFailCompanyIds,
      });
      if (publishError) return publishError;
      return Response.json({
        master: result!.master,
        version: result!.version,
        distributionEvent: result!.distributionEvent,
        eventType: result!.eventType,
        idempotent: result!.idempotent,
      });
    }

    // ── UPDATE DISTRIBUTION POLICY ───────────────────────────────────────────
    if (action === 'update_distribution_policy') {
      const { masterId, defaultDistributionPolicy, defaultSelectedCompanyIds } = body;
      const { success, master: updatedMaster, error: policyError } = await updateDistributionPolicy(base44, {
        masterId,
        defaultDistributionPolicy,
        defaultSelectedCompanyIds,
      });
      if (policyError) return policyError;
      return Response.json({ success, master: updatedMaster });
    }

    // ── ARCHIVE ──────────────────────────────────────────────────────────────
    if (action === 'archive') {
      const { masterId } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      if (master.status === 'archived') return Response.json({ error: 'Already archived' }, { status: 409 });
      await SR.entities.EssentialSOPMaster.update(masterId, { status: 'archived', updatedAt: now });
      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'master_sop_archived',
        extra: { masterId, masterTitle: master.title },
      });
      return Response.json({ success: true });
    }

    // ── GET VERSION HISTORY ──────────────────────────────────────────────────
    if (action === 'get_history') {
      const { masterId } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const versions = await SR.entities.EssentialSOPVersion.filter({ masterId }, '-versionNumber', 100);
      return Response.json({ versions: versions || [] });
    }

    // ── GET PUBLISHED VERSION ────────────────────────────────────────────────
    if (action === 'get_version') {
      const { versionId } = body;
      if (!versionId) return Response.json({ error: 'versionId required' }, { status: 400 });
      const version = await SR.entities.EssentialSOPVersion.get(versionId);
      if (!version) return Response.json({ error: 'Not found' }, { status: 404 });
      const sections = await SR.entities.EssentialSOPSection.filter({ versionId }, 'sortOrder', 10);
      return Response.json({ version, sections: sections || [] });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}