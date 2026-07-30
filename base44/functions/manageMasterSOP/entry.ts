import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requirePlatformSuperAdmin, writePlatformAudit } from '../../shared/platformAuth.ts';
import { publishMasterSOPVersion, updateDistributionPolicy } from '../../shared/publishingOrchestration.ts';

/**
 * manageMasterSOP — All Essential SOP Master Library and platform role operations.
 *
 * update_draft concurrency:
 *   expectedDraftRevision is MANDATORY on every user-facing update_draft call.
 *   Omitting it returns REVISION_REQUIRED with zero writes.
 *   Mismatching it returns DRAFT_CONFLICT with zero writes.
 *   Only rollback_to_version internal draft writes bypass this — they use
 *   startingDraftRevision stored in the RollbackMutation record for concurrency.
 *
 * rollback_to_version staged recovery:
 *   Uses RollbackMutation entity as durable state machine.
 *   Status transitions: STARTED → PREPARED → PUBLISHING → PUBLISHED → AUDIT_PENDING → COMPLETED
 *   A retry inspects the record and performs only missing steps.
 *   The prepared snapshot is immutable after PREPARED — never re-read from historical sections.
 *
 * Audit idempotency:
 *   Rollback audit uses idempotencyKey = 'rollback_audit_{mutationKey}'.
 *   writePlatformAudit deduplicates on this key — exactly one audit entry per rollback.
 *
 * Legacy logicalItemId safety:
 *   Historical items without logicalItemId get deterministic IDs derived from
 *   sectionType + sortOrder + title, stored in RollbackMutation.legacyIdMap.
 *   Two retries of the same rollback produce identical IDs.
 */

// ── Server-side publish validation ────────────────────────────────────────────
function validateDraftForPublish(master: any, sections: any[]): string[] {
  const errors: string[] = [];

  if (!master.title || !master.title.trim()) {
    errors.push('SOP title is required.');
  }

  const REQUIRED_SECTION_TYPES = ['procedure', 'safety'];
  const logicalIds: string[] = [];
  let totalItems = 0;

  for (const section of sections) {
    const items: any[] = section.contentItems || [];
    totalItems += items.length;

    if (REQUIRED_SECTION_TYPES.includes(section.sectionType) && items.length === 0) {
      errors.push(`Section "${section.title || section.sectionType}" must have at least one item.`);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.title || !item.title.trim()) {
        errors.push(`Item ${i + 1} in "${section.title}" is missing a title.`);
      }
      const VALID_TYPES = ['tool', 'material', 'numberedStep', 'checklist', 'warning', 'qualityCheck', 'text', 'documentationRequirement'];
      if (item.contentType && !VALID_TYPES.includes(item.contentType)) {
        errors.push(`Item ${i + 1} in "${section.title}" has unsupported content type: ${item.contentType}.`);
      }
      if (item.logicalItemId) {
        if (logicalIds.includes(item.logicalItemId)) {
          errors.push(`Duplicate logicalItemId in "${section.title}" item ${i + 1}: ${item.logicalItemId}`);
        } else {
          logicalIds.push(item.logicalItemId);
        }
      }
    }
  }

  if (totalItems === 0) {
    errors.push('SOP has no content. Add at least one item before publishing.');
  }

  return errors;
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * generateLogicalItemId — assigns a stable cross-version identity to a new master content item.
 * Called ONCE at item creation time. Never regenerated on edit, move, or snapshot.
 * Format: lid_<6-char masterId prefix>_<random base36>
 */
function generateLogicalItemId(masterId: string): string {
  const prefix = (masterId || 'xx').slice(-6);
  const rand = Math.random().toString(36).slice(2, 10);
  return `lid_${prefix}_${rand}`;
}

/**
 * ensureLogicalItemIds — assigns logicalItemId to any content items that lack one.
 * Used when saving draft sections and when duplicating. Idempotent: existing IDs preserved.
 */
function ensureLogicalItemIds(items: any[], masterId: string): any[] {
  return (items || []).map(item => {
    if (item && typeof item === 'object' && !item.logicalItemId) {
      return { ...item, logicalItemId: generateLogicalItemId(masterId) };
    }
    return item;
  });
}

/**
 * deriveLegacyLogicalItemId — deterministic ID for historical items that lacked logicalItemId.
 *
 * Uses immutable historical identity data: sectionType + sortOrder + title.
 * This ensures two retries of the same rollback produce identical IDs for the same items.
 * The ID is prefixed 'llid_' (legacy logical item id) to distinguish from live-created items.
 *
 * The derived key is stored in RollbackMutation.legacyIdMap so the mapping is authoritative
 * and never re-computed from random data.
 */
function deriveLegacyLogicalItemId(sectionType: string, sortOrder: number, title: string): string {
  // Build a stable string from immutable historical data
  const raw = `${sectionType}::${sortOrder}::${(title || '').trim().toLowerCase()}`;
  // Simple deterministic hash: sum char codes into a base36 string
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  const hashStr = Math.abs(hash).toString(36).padStart(8, '0');
  return `llid_${hashStr}`;
}

/**
 * buildRollbackSnapshot — reads historical sections, assigns deterministic logicalItemIds
 * to any items that lack them, and returns the immutable prepared snapshot plus the
 * legacyIdMap and hasLegacyItems flag.
 *
 * The snapshot is built from historical sections, not live draft sections.
 * Once built it is persisted on RollbackMutation — retries use the stored snapshot.
 */
function buildRollbackSnapshot(targetSections: any[]): {
  snapshot: Array<{ sectionType: string; contentItems: any[] }>;
  legacyIdMap: Record<string, string>;
  hasLegacyItems: boolean;
} {
  const legacyIdMap: Record<string, string> = {};
  let hasLegacyItems = false;

  const snapshot = (targetSections || []).map(section => {
    const contentItems = (section.contentItems || []).map((item: any, sortOrder: number) => {
      if (item.logicalItemId) {
        // Already has an ID — preserve verbatim
        return { ...item };
      }
      // Legacy item — derive deterministic ID
      hasLegacyItems = true;
      const legacyKey = `${section.sectionType}::${sortOrder}::${(item.title || '').trim().toLowerCase()}`;
      const derivedId = deriveLegacyLogicalItemId(section.sectionType, sortOrder, item.title || '');
      legacyIdMap[legacyKey] = derivedId;
      return { ...item, logicalItemId: derivedId };
    });
    return { sectionType: section.sectionType, contentItems };
  });

  return { snapshot, legacyIdMap, hasLegacyItems };
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
    if (action === 'manage_role') {
      const { user, error: authError } = await requirePlatformSuperAdmin(base44);
      if (authError) return authError;

      const { targetUserId, role, operation } = body;

      if (!targetUserId || typeof targetUserId !== 'string' || !targetUserId.trim()) {
        return Response.json({ error: 'targetUserId is required' }, { status: 400 });
      }
      if (!role || typeof role !== 'string') {
        return Response.json({ error: 'role is required' }, { status: 400 });
      }
      if (!operation || !['assign', 'remove'].includes(operation)) {
        return Response.json({ error: 'operation must be assign or remove' }, { status: 400 });
      }
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
          if (existing.status === 'ACTIVE') {
            return Response.json({ success: true, alreadyActive: true, membershipId: existing.id });
          }
          await SR.entities.PlatformMembership.update(existing.id, {
            status: 'ACTIVE', grantedByUserId: user.id, grantedAt: now,
            suspendedAt: null, suspendedByUserId: null, suspensionReason: null, updatedAt: now,
          });
          await writePlatformAudit(SR, { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'platform_role_assigned', targetUserId, extra: { newPlatformRole: 'SUPER_ADMIN', newPlatformStatus: 'ACTIVE', previousPlatformStatus: 'SUSPENDED' } });
          return Response.json({ success: true, membershipId: existing.id });
        }
        const membership = await SR.entities.PlatformMembership.create({
          userId: targetUserId, platformRole: 'SUPER_ADMIN', status: 'ACTIVE',
          grantedByUserId: user.id, grantedAt: now, createdAt: now, updatedAt: now,
        });
        await writePlatformAudit(SR, { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'platform_role_assigned', targetUserId, extra: { newPlatformRole: 'SUPER_ADMIN', newPlatformStatus: 'ACTIVE' } });
        return Response.json({ success: true, membershipId: membership.id });
      }

      if (!existing || existing.status === 'SUSPENDED') {
        return Response.json({ success: true, alreadySuspended: true });
      }
      await SR.entities.PlatformMembership.update(existing.id, {
        status: 'SUSPENDED', suspendedByUserId: user.id, suspendedAt: now, updatedAt: now,
      });
      await writePlatformAudit(SR, { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'platform_role_removed', targetUserId, extra: { previousPlatformRole: 'SUPER_ADMIN', previousPlatformStatus: 'ACTIVE', newPlatformStatus: 'SUSPENDED' } });
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
      const { title, category, trade, description, tags } = body;
      if (!title) return Response.json({ error: 'title is required' }, { status: 400 });
      const slug = slugify(title) + '-' + Date.now().toString(36);
      const master = await SR.entities.EssentialSOPMaster.create({
        title, slug,
        category: category || '', trade: trade || '', description: description || '',
        tags: Array.isArray(tags) ? tags : [],
        status: 'draft', currentPublishedVersionId: null,
        draftRevision: 0, draftLastSavedByUserId: user.id,
        createdAt: now, updatedAt: now,
      });
      const SECTION_TYPES = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'];
      const SECTION_TITLES = { tools: 'Tools', materials: 'Materials', scope: 'Scope', procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards' };
      for (let i = 0; i < SECTION_TYPES.length; i++) {
        const st = SECTION_TYPES[i];
        await SR.entities.EssentialSOPSection.create({
          masterId: master.id, versionId: 'draft', sectionType: st,
          title: SECTION_TITLES[st], sortOrder: i, contentItems: [],
        });
      }
      await writePlatformAudit(SR, { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'master_sop_created', extra: { masterId: master.id, masterTitle: master.title } });
      return Response.json({ master });
    }

    // ── UPDATE DRAFT ─────────────────────────────────────────────────────────
    // expectedDraftRevision is MANDATORY for all user-facing draft writes.
    // Omitting returns REVISION_REQUIRED (zero writes).
    // Mismatch returns DRAFT_CONFLICT (zero writes).
    if (action === 'update_draft') {
      const { masterId, fields, sectionId, contentItems, expectedDraftRevision } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });

      // MANDATORY: reject immediately before any entity reads if revision is absent
      if (expectedDraftRevision === undefined || expectedDraftRevision === null) {
        return Response.json({
          code: 'REVISION_REQUIRED',
          error: 'expectedDraftRevision is required for all draft writes. Load the current draft revision from the server before saving.',
        }, { status: 428 });
      }

      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      if (master.status !== 'draft') return Response.json({ error: 'Only Draft SOPs may be edited' }, { status: 409 });

      // Optimistic concurrency check
      const serverRevision = master.draftRevision ?? 0;
      if (expectedDraftRevision !== serverRevision) {
        const currentSections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
        return Response.json({
          code: 'DRAFT_CONFLICT',
          error: 'This draft was modified by another session. Your changes were not saved.',
          expectedRevision: expectedDraftRevision,
          serverRevision,
          serverUpdatedAt: master.updatedAt,
          serverLastSavedByUserId: master.draftLastSavedByUserId || null,
          serverMaster: master,
          serverSections: currentSections || [],
        }, { status: 409 });
      }

      const newRevision = serverRevision + 1;

      if (fields) {
        const allowed = ['title', 'category', 'trade', 'description', 'tags'];
        const update: any = { draftRevision: newRevision, draftLastSavedByUserId: user.id, updatedAt: now };
        for (const k of allowed) { if (fields[k] !== undefined) update[k] = fields[k]; }
        if (fields.title) update.slug = slugify(fields.title) + '-' + Date.now().toString(36);
        await SR.entities.EssentialSOPMaster.update(masterId, update);
      }

      if (sectionId && contentItems !== undefined) {
        const section = await SR.entities.EssentialSOPSection.get(sectionId);
        if (!section || section.masterId !== masterId || section.versionId !== 'draft') {
          return Response.json({ error: 'Draft section not found' }, { status: 404 });
        }
        const itemsWithIds = ensureLogicalItemIds(contentItems, masterId);
        await SR.entities.EssentialSOPSection.update(sectionId, { contentItems: itemsWithIds });
        if (!fields) {
          await SR.entities.EssentialSOPMaster.update(masterId, {
            draftRevision: newRevision, draftLastSavedByUserId: user.id, updatedAt: now,
          });
        }
      }

      await writePlatformAudit(SR, {
        actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'master_sop_draft_updated',
        extra: { masterId, masterTitle: master.title, metadata: { fieldsUpdated: !!fields, sectionUpdated: !!sectionId, newRevision } },
      });

      const updated = await SR.entities.EssentialSOPMaster.get(masterId);
      return Response.json({ master: updated, draftRevision: updated.draftRevision ?? newRevision });
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
      await writePlatformAudit(SR, { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'master_sop_deleted', extra: { masterId, masterTitle: master.title } });
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
        title: source.title + ' (Copy)', slug: newSlug,
        category: source.category, trade: source.trade,
        description: source.description || '',
        tags: Array.isArray(source.tags) ? [...source.tags] : [],
        status: 'draft', currentPublishedVersionId: null,
        draftRevision: 0, draftLastSavedByUserId: user.id,
        createdAt: now, updatedAt: now,
      });
      const sourceSections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
      for (const s of (sourceSections || [])) {
        const freshItems = (s.contentItems || []).map((item: any) => ({
          ...item, logicalItemId: generateLogicalItemId(newMaster.id),
        }));
        await SR.entities.EssentialSOPSection.create({
          masterId: newMaster.id, versionId: 'draft',
          sectionType: s.sectionType, title: s.title,
          sortOrder: s.sortOrder, contentItems: freshItems,
        });
      }
      await writePlatformAudit(SR, { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'master_sop_duplicated', extra: { masterId: newMaster.id, masterTitle: newMaster.title, metadata: { sourceMasterId: masterId } } });
      return Response.json({ master: newMaster });
    }

    // ── PUBLISH ──────────────────────────────────────────────────────────────
    if (action === 'publish') {
      const { masterId, publicationMutationKey, changeSummary, changeNotes, distributionPolicyOverride, selectedCompanyIds } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      if (!publicationMutationKey) return Response.json({ error: 'publicationMutationKey is required' }, { status: 400 });

      const pubMaster = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!pubMaster) return Response.json({ error: 'Not found' }, { status: 404 });
      if (pubMaster.status !== 'draft') return Response.json({ error: 'Only Draft SOPs may be published' }, { status: 409 });

      const existingVersions = await SR.entities.EssentialSOPVersion.filter({ masterId, publicationMutationKey }, '-versionNumber', 1);
      if (existingVersions?.length > 0) {
        return Response.json({ master: pubMaster, version: existingVersions[0], idempotent: true, message: 'This publicationMutationKey was already used — returning existing result.' });
      }

      const draftSections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
      const validationErrors = validateDraftForPublish(pubMaster, draftSections || []);
      if (validationErrors.length > 0) {
        return Response.json({ code: 'VALIDATION_FAILED', error: 'Publication blocked by validation errors.', validationErrors }, { status: 422 });
      }

      const { result, error: publishError } = await publishMasterSOPVersion(base44, {
        masterId, publicationMutationKey,
        changeSummary: changeSummary || changeNotes || '',
        distributionPolicyOverride, selectedCompanyIds,
      });
      if (publishError) return publishError;
      return Response.json({ master: result!.master, version: result!.version, distributionEvent: result!.distributionEvent, eventType: result!.eventType, idempotent: result!.idempotent });
    }

    // ── UPDATE DISTRIBUTION POLICY ───────────────────────────────────────────
    if (action === 'update_distribution_policy') {
      const { masterId, defaultDistributionPolicy, defaultSelectedCompanyIds } = body;
      const { success, master: updatedMaster, error: policyError } = await updateDistributionPolicy(base44, { masterId, defaultDistributionPolicy, defaultSelectedCompanyIds });
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
      await writePlatformAudit(SR, { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', action: 'master_sop_archived', extra: { masterId, masterTitle: master.title } });
      return Response.json({ success: true });
    }

    // ── ROLLBACK TO VERSION ───────────────────────────────────────────────────
    //
    // Staged, recoverable process using RollbackMutation as durable state machine.
    // NOT atomic. A retry inspects the persisted record and performs only missing steps.
    //
    // Status transitions:
    //   STARTED → PREPARED → PUBLISHING → PUBLISHED → AUDIT_PENDING → COMPLETED
    //
    // Recovery cases (keyed by publicationMutationKey):
    //   A. No record / STARTED:         build snapshot, persist to PREPARED, then continue
    //   B. PREPARED:                     check for concurrent modification, apply snapshot, publish
    //   C. PUBLISHING / PUBLISHED:       publication may be in-flight; check for existing version
    //   D. AUDIT_PENDING:                audit only (no draft writes, no publish)
    //   E. COMPLETED:                    return existing result, zero writes
    //   F. FAILED_RECOVERABLE:           re-enter from STARTED
    //   Concurrent modification:         return ROLLBACK_CONCURRENT_MODIFICATION, zero writes
    //
    if (action === 'rollback_to_version') {
      const { masterId, targetVersionId, publicationMutationKey } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      if (!targetVersionId) return Response.json({ error: 'targetVersionId required' }, { status: 400 });
      if (!publicationMutationKey) return Response.json({ error: 'publicationMutationKey is required' }, { status: 400 });

      // ── Authorization + basic guards ────────────────────────────────────────
      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      if (master.status === 'archived') return Response.json({ error: 'Archived SOPs cannot be rolled back' }, { status: 409 });

      const targetVersion = await SR.entities.EssentialSOPVersion.get(targetVersionId);
      if (!targetVersion || targetVersion.masterId !== masterId) {
        return Response.json({ error: 'Target version not found or does not belong to this master' }, { status: 404 });
      }
      if (targetVersion.status !== 'published') {
        return Response.json({ error: 'Can only roll back to a published version' }, { status: 409 });
      }

      const changeSummary = body.changeSummary || `Rollback to v${targetVersion.versionNumber}`;
      const auditIdempotencyKey = `rollback_audit_${publicationMutationKey}`;

      // ── Load or create the RollbackMutation record ──────────────────────────
      let mutation: any = null;
      const existingMutations = await SR.entities.RollbackMutation.filter({ mutationKey: publicationMutationKey }, '-createdAt', 1);
      if (existingMutations && existingMutations.length > 0) {
        mutation = existingMutations[0];
      }

      // ── Case E: Already COMPLETED ──────────────────────────────────────────
      if (mutation?.status === 'COMPLETED') {
        const completedVersion = await SR.entities.EssentialSOPVersion.get(mutation.publishedVersionId).catch(() => null);
        return Response.json({
          success: true,
          master: await SR.entities.EssentialSOPMaster.get(masterId),
          version: completedVersion,
          rolledBackFromVersionNumber: targetVersion.versionNumber,
          idempotent: true,
        });
      }

      // ── Case D: AUDIT_PENDING — audit only ─────────────────────────────────
      if (mutation?.status === 'AUDIT_PENDING') {
        const publishedVersion = await SR.entities.EssentialSOPVersion.get(mutation.publishedVersionId).catch(() => null);
        await writePlatformAudit(SR, {
          actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
          action: 'master_sop_rollback_completed',
          idempotencyKey: auditIdempotencyKey,
          extra: {
            masterId, masterTitle: master.title,
            versionId: mutation.publishedVersionId,
            versionNumber: mutation.publishedVersionNumber,
            changeNotes: changeSummary,
            publicationMutationKey,
            metadata: { rollbackMutationId: mutation.id, sourceVersionId: targetVersionId, sourceVersionNumber: targetVersion.versionNumber },
          },
        });
        await SR.entities.RollbackMutation.update(mutation.id, {
          status: 'COMPLETED', auditCompleted: true, completedAt: now, updatedAt: now,
        });
        const updatedMaster = await SR.entities.EssentialSOPMaster.get(masterId);
        return Response.json({
          success: true, master: updatedMaster, version: publishedVersion,
          rolledBackFromVersionNumber: targetVersion.versionNumber,
          idempotent: true,
        });
      }

      // ── Cases C: PUBLISHING or PUBLISHED — check if version already exists ──
      if (mutation?.status === 'PUBLISHING' || mutation?.status === 'PUBLISHED') {
        const existingVersions = await SR.entities.EssentialSOPVersion.filter({ masterId, publicationMutationKey }, '-versionNumber', 1);
        if (existingVersions?.length > 0) {
          const existingVersion = existingVersions[0];
          // Version exists — write audit if not done, then COMPLETE
          await writePlatformAudit(SR, {
            actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
            action: 'master_sop_rollback_completed',
            idempotencyKey: auditIdempotencyKey,
            extra: {
              masterId, masterTitle: master.title,
              versionId: existingVersion.id, versionNumber: existingVersion.versionNumber,
              changeNotes: changeSummary, publicationMutationKey,
              metadata: { rollbackMutationId: mutation.id, sourceVersionId: targetVersionId, sourceVersionNumber: targetVersion.versionNumber },
            },
          });
          await SR.entities.RollbackMutation.update(mutation.id, {
            status: 'COMPLETED', publishedVersionId: existingVersion.id,
            publishedVersionNumber: existingVersion.versionNumber,
            auditCompleted: true, completedAt: now, updatedAt: now,
          });
          const updatedMaster = await SR.entities.EssentialSOPMaster.get(masterId);
          return Response.json({
            success: true, master: updatedMaster, version: existingVersion,
            rolledBackFromVersionNumber: targetVersion.versionNumber, idempotent: true,
          });
        }
        // Version not yet created — fall through to PREPARED path
        if (mutation?.status !== 'PREPARED') {
          await SR.entities.RollbackMutation.update(mutation.id, { status: 'PREPARED', updatedAt: now });
          mutation = { ...mutation, status: 'PREPARED' };
        }
      }

      // ── Case A: No record or STARTED/FAILED_RECOVERABLE — build snapshot ────
      if (!mutation || mutation.status === 'STARTED' || mutation.status === 'FAILED_RECOVERABLE') {
        // Read historical sections to build snapshot
        const historicalSections = await SR.entities.EssentialSOPSection.filter(
          { masterId, versionId: targetVersionId }, 'sortOrder', 10
        );
        const { snapshot, legacyIdMap, hasLegacyItems } = buildRollbackSnapshot(historicalSections || []);

        // Capture starting draft revision for concurrent-modification detection
        const startingDraftRevision = master.draftRevision ?? 0;

        const mutationRecord = {
          mutationKey: publicationMutationKey,
          masterSOPId: masterId,
          requestedByUserId: user.id,
          sourceVersionId: targetVersionId,
          sourceVersionNumber: targetVersion.versionNumber,
          startingDraftRevision,
          // Store as JSON strings to avoid entity schema coercion on nested objects
          preparedSnapshotJson: JSON.stringify(snapshot),
          legacyIdMapJson: Object.keys(legacyIdMap).length > 0 ? JSON.stringify(legacyIdMap) : null,
          hasLegacyItems,
          auditIdempotencyKey,
          status: 'PREPARED',
          preparedAt: now,
          createdAt: now,
          updatedAt: now,
        };

        if (mutation) {
          // Update existing record
          await SR.entities.RollbackMutation.update(mutation.id, {
            ...mutationRecord,
            createdAt: mutation.createdAt, // preserve original creation time
          });
          mutation = { ...mutation, ...mutationRecord };
        } else {
          // Create new record
          mutation = await SR.entities.RollbackMutation.create(mutationRecord);
        }

        // Write rollback_started audit (non-idempotent — once per mutation creation)
        await writePlatformAudit(SR, {
          actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
          action: 'master_sop_rollback_started',
          extra: {
            masterId, masterTitle: master.title,
            metadata: {
              rollbackMutationId: mutation.id,
              sourceVersionId: targetVersionId, sourceVersionNumber: targetVersion.versionNumber,
              startingDraftRevision, hasLegacyItems,
            },
          },
        });
      }

      // ── Case B: PREPARED — apply snapshot to live draft and publish ─────────
      if (mutation?.status === 'PREPARED') {
        // Re-read current master to detect concurrent modifications since preparation
        const currentMaster = await SR.entities.EssentialSOPMaster.get(masterId);
        const currentRevision = currentMaster.draftRevision ?? 0;

        if (currentRevision !== mutation.startingDraftRevision) {
          // Another session wrote to the draft after preparation — block with zero destructive writes
          await SR.entities.RollbackMutation.update(mutation.id, {
            status: 'FAILED_RECOVERABLE',
            errorCode: 'ROLLBACK_CONCURRENT_MODIFICATION',
            errorDetails: `Draft was modified after rollback preparation. startingDraftRevision=${mutation.startingDraftRevision}, currentRevision=${currentRevision}. Retry will rebuild the snapshot from the historical version.`,
            updatedAt: now,
          });
          return Response.json({
            code: 'ROLLBACK_CONCURRENT_MODIFICATION',
            error: 'The draft was modified by another session after this rollback was prepared. No changes have been made. Retry the rollback.',
            startingDraftRevision: mutation.startingDraftRevision,
            currentRevision,
          }, { status: 409 });
        }

        // Apply the immutable prepared snapshot to live draft sections
        const draftSections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
        // Deserialize the immutable snapshot — never re-read from historical sections on retry
        let preparedSnapshot: any[] = [];
        try {
          preparedSnapshot = mutation.preparedSnapshotJson ? JSON.parse(mutation.preparedSnapshotJson) : [];
        } catch (_) {
          preparedSnapshot = [];
        }

        await SR.entities.RollbackMutation.update(mutation.id, { status: 'PUBLISHING', updatedAt: now });

        for (const draftSection of (draftSections || [])) {
          const snapSection = preparedSnapshot.find((s: any) => s.sectionType === draftSection.sectionType);
          await SR.entities.EssentialSOPSection.update(draftSection.id, {
            contentItems: snapSection ? [...snapSection.contentItems] : [],
          });
        }
        await SR.entities.EssentialSOPMaster.update(masterId, { status: 'draft', updatedAt: now });

        // Validate the rollback content before publishing
        const rolledBackSections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
        const validationErrors = validateDraftForPublish(currentMaster, rolledBackSections || []);
        if (validationErrors.length > 0) {
          // Restore active status — the draft sections were written but validation failed
          await SR.entities.EssentialSOPMaster.update(masterId, { status: 'active', updatedAt: now }).catch(() => {});
          await SR.entities.RollbackMutation.update(mutation.id, {
            status: 'FAILED_TERMINAL',
            errorCode: 'VALIDATION_FAILED',
            errorDetails: validationErrors.join('; '),
            updatedAt: now,
          });
          return Response.json({
            code: 'VALIDATION_FAILED',
            error: 'Rollback content failed server-side validation.',
            validationErrors,
          }, { status: 422 });
        }

        // Publish via the canonical publisher
        const { result, error: publishError } = await publishMasterSOPVersion(base44, {
          masterId, publicationMutationKey, changeSummary,
        });
        if (publishError) {
          await SR.entities.RollbackMutation.update(mutation.id, {
            status: 'FAILED_RECOVERABLE',
            errorCode: 'PUBLISH_FAILED',
            errorDetails: 'publishMasterSOPVersion returned an error response.',
            updatedAt: now,
          });
          return publishError;
        }

        // Mark PUBLISHED
        await SR.entities.RollbackMutation.update(mutation.id, {
          status: 'AUDIT_PENDING',
          publishedVersionId: result!.version.id,
          publishedVersionNumber: result!.version.versionNumber,
          publishedAt: now,
          updatedAt: now,
        });

        // Write the exactly-once rollback_completed audit
        await writePlatformAudit(SR, {
          actingUserId: user.id, actingUserRole: 'SUPER_ADMIN',
          action: 'master_sop_rollback_completed',
          idempotencyKey: auditIdempotencyKey,
          extra: {
            masterId, masterTitle: master.title,
            versionId: result!.version.id, versionNumber: result!.version.versionNumber,
            changeNotes: changeSummary, publicationMutationKey,
            metadata: { rollbackMutationId: mutation.id, sourceVersionId: targetVersionId, sourceVersionNumber: targetVersion.versionNumber },
          },
        });

        // Mark COMPLETED
        await SR.entities.RollbackMutation.update(mutation.id, {
          status: 'COMPLETED', auditCompleted: true, completedAt: now, updatedAt: now,
        });

        return Response.json({
          success: true,
          master: result!.master,
          version: result!.version,
          rolledBackFromVersionNumber: targetVersion.versionNumber,
          rollbackMutationId: mutation.id,
        });
      }

      // Should not reach here — all states handled above
      return Response.json({ error: 'Unexpected rollback state', status: mutation?.status }, { status: 500 });
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