import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { requireEsopAdmin } from '../../shared/esopAdminAuth.js';

/**
 * manageMasterSOP — All Essential SOP Master Library operations in one function.
 *
 * Actions:
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
 * All actions require esop_admin or admin role.
 */

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const { user, error: authError } = await requireEsopAdmin(base44);
    if (authError) return authError;

    const body = await req.json().catch(() => ({}));
    const { action } = body;
    if (!action) return Response.json({ error: 'action is required' }, { status: 400 });

    const now = new Date().toISOString();
    const SR = base44.asServiceRole;

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
      // Load current draft sections (versionId = null means draft)
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
      // Scaffold the six draft sections
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
      // Delete draft sections
      const sections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' });
      for (const s of (sections || [])) {
        await SR.entities.EssentialSOPSection.delete(s.id);
      }
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
      // Copy draft sections from source (use source's current draft sections)
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
      return Response.json({ master: newMaster });
    }

    // ── PUBLISH ──────────────────────────────────────────────────────────────
    if (action === 'publish') {
      const { masterId, changeNotes } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      if (master.status !== 'draft') return Response.json({ error: 'Only Draft SOPs may be published' }, { status: 409 });

      // Determine next version number
      const existingVersions = await SR.entities.EssentialSOPVersion.filter({ masterId }, '-versionNumber', 100);
      const nextVersionNumber = ((existingVersions || [])[0]?.versionNumber || 0) + 1;

      // Create immutable version record
      const version = await SR.entities.EssentialSOPVersion.create({
        masterId,
        versionNumber: nextVersionNumber,
        status: 'published',
        publishedAt: now,
        publishedBy: user.id,
        changeNotes: changeNotes || '',
        createdAt: now,
      });

      // Snapshot draft sections as published sections (versionId = version.id)
      const draftSections = await SR.entities.EssentialSOPSection.filter({ masterId, versionId: 'draft' }, 'sortOrder', 10);
      for (const s of (draftSections || [])) {
        await SR.entities.EssentialSOPSection.create({
          masterId,
          versionId: version.id,
          sectionType: s.sectionType,
          title: s.title,
          sortOrder: s.sortOrder,
          contentItems: s.contentItems || [],
        });
      }

      // Promote master to active, record published version
      await SR.entities.EssentialSOPMaster.update(masterId, {
        status: 'active',
        currentPublishedVersionId: version.id,
        updatedAt: now,
      });

      return Response.json({ master: await SR.entities.EssentialSOPMaster.get(masterId), version });
    }

    // ── ARCHIVE ──────────────────────────────────────────────────────────────
    if (action === 'archive') {
      const { masterId } = body;
      if (!masterId) return Response.json({ error: 'masterId required' }, { status: 400 });
      const master = await SR.entities.EssentialSOPMaster.get(masterId);
      if (!master) return Response.json({ error: 'Not found' }, { status: 404 });
      if (master.status === 'archived') return Response.json({ error: 'Already archived' }, { status: 409 });
      await SR.entities.EssentialSOPMaster.update(masterId, { status: 'archived', updatedAt: now });
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