/**
 * masterSopDraftFactory.ts — Canonical helpers for creating an Essential SOP
 * Master draft and managing logicalItemId assignment for content items.
 *
 * SHARED between:
 *   - manageMasterSOP (create / update_draft / duplicate actions)
 *   - generateMasterSopDraft (AI builder)
 *
 * Extracting these here guarantees a single, deterministic implementation of:
 *   - slug generation
 *   - logicalItemId generation (stable cross-version identity)
 *   - master + six-section draft creation
 *
 * No publishing, distribution, provisioning, or version logic lives here.
 * This module is pure draft-content scaffolding.
 */

const SECTION_TYPES = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'] as const;
const SECTION_TITLES: Record<string, string> = {
  tools: 'Tools',
  materials: 'Materials',
  scope: 'Scope',
  procedure: 'Procedure',
  safety: 'Safety',
  quality: 'Quality Standards',
};

/**
 * slugify — URL-safe slug from a freeform title.
 */
export function slugify(text: string): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/**
 * generateLogicalItemId — assigns a stable cross-version identity to a master content item.
 * Called ONCE at item creation time. Never regenerated on edit, move, or snapshot.
 * Format: lid_<6-char masterId prefix>_<random base36>
 */
export function generateLogicalItemId(masterId: string): string {
  const prefix = (masterId || 'xx').slice(-6);
  const rand = Math.random().toString(36).slice(2, 10);
  return `lid_${prefix}_${rand}`;
}

/**
 * ensureLogicalItemIds — assign logicalItemId to any content items that lack one.
 * Idempotent: existing IDs are preserved verbatim. Used by update_draft and the AI builder.
 */
export function ensureLogicalItemIds(items: any[], masterId: string): any[] {
  return (items || []).map(item => {
    if (item && typeof item === 'object' && !item.logicalItemId) {
      return { ...item, logicalItemId: generateLogicalItemId(masterId) };
    }
    return item;
  });
}

/**
 * createMasterSopDraft — canonical creation of an Essential SOP Master draft.
 *
 * Creates:
 *   1. One EssentialSOPMaster record (status: 'draft', draftRevision: 0)
 *   2. Six EssentialSOPSection records (versionId: 'draft', empty contentItems)
 *
 * Does NOT publish, distribute, provision, or write audit — the caller owns audit.
 * Returns the created master record.
 *
 * Identical behavior to the original inline create in manageMasterSOP/create (behavior-preserving extraction).
 */
export async function createMasterSopDraft(
  SR: any,
  params: {
    title: string;
    category?: string;
    trade?: string;
    description?: string;
    tags?: string[];
    userId: string;
    now: string;
  }
): Promise<any> {
  const { title, category, trade, description, tags, userId, now } = params;

  if (!title || !String(title).trim()) {
    throw new Error('title is required');
  }

  const slug = slugify(title) + '-' + Date.now().toString(36);

  const master = await SR.entities.EssentialSOPMaster.create({
    title,
    slug,
    category: category || '',
    trade: trade || '',
    description: description || '',
    tags: Array.isArray(tags) ? tags : [],
    status: 'draft',
    currentPublishedVersionId: null,
    draftRevision: 0,
    draftLastSavedByUserId: userId,
    createdAt: now,
    updatedAt: now,
  });

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

  return master;
}

export { SECTION_TYPES, SECTION_TITLES };