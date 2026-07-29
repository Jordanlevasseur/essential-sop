/**
 * versionDiff — Shared three-way diff and rebase engine for Master Version adoption.
 *
 * Used by BOTH previewMasterVersionAdoption (read) and adoptMasterVersionWithResolutions (write).
 * No diff or rebase logic may exist outside this module.
 *
 * THREE-WAY COMPARISON MODEL
 * --------------------------
 * BASE   = currently pinned published Master Version content
 * TARGET = target published Master Version content (what we're moving to)
 * COMPANY = existing JobOverride applied on top of BASE
 *
 * STABLE IDENTITY MODEL FOR MASTER ITEMS
 * ----------------------------------------
 * Master EssentialSOPSection records carry no persistent cross-version item IDs.
 * The stable identity key for a master item is: `${contentType}::${title}`.
 * Two items with the same key in BASE and TARGET are "the same item" — eligible for MASTER_MODIFIED.
 * An item in BASE with no matching key in TARGET → MASTER_REMOVED.
 * An item in TARGET with no matching key in BASE → MASTER_ADDED.
 * If multiple items share the same key in a section (duplicates), they are matched positionally
 * within that key group.
 *
 * Company override items reference BASE stable keys via their _itemId field
 * (format: `m_${baseSectionId}_${idx}`). The lookup from _itemId → base-item key is
 * built at diff time so company items can be matched to their corresponding logical item.
 *
 * CHANGE TYPES
 * ------------
 * MASTER_ADDED             — item exists in TARGET, not in BASE
 * MASTER_REMOVED           — item exists in BASE, not in TARGET
 * MASTER_MODIFIED          — same logical item changed from BASE to TARGET
 * COMPANY_ONLY_CUSTOMIZATION — COMPANY changed relative to BASE, TARGET did not change
 * AUTOMATICALLY_COMPATIBLE  — both changed to same result
 * CONFLICT                 — genuine three-way conflict requiring resolution
 *
 * CONFLICT SUBTYPES
 * -----------------
 * BOTH_MODIFIED_DIFFERENTLY  — TARGET modified, COMPANY modified, values differ
 * MASTER_REMOVED_COMPANY_MODIFIED — TARGET removed item, COMPANY overrode it
 */

export const CHANGE_TYPES = {
  MASTER_ADDED: 'MASTER_ADDED',
  MASTER_REMOVED: 'MASTER_REMOVED',
  MASTER_MODIFIED: 'MASTER_MODIFIED',
  COMPANY_ONLY_CUSTOMIZATION: 'COMPANY_ONLY_CUSTOMIZATION',
  AUTOMATICALLY_COMPATIBLE: 'AUTOMATICALLY_COMPATIBLE',
  CONFLICT: 'CONFLICT',
};

export const CONFLICT_SUBTYPES = {
  BOTH_MODIFIED_DIFFERENTLY: 'BOTH_MODIFIED_DIFFERENTLY',
  MASTER_REMOVED_COMPANY_MODIFIED: 'MASTER_REMOVED_COMPANY_MODIFIED',
};

const RESOLUTION_OPTIONS = ['KEEP_COMPANY', 'USE_NEW_ESSENTIAL_SOP'];

export const SECTION_LABELS: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
  metadata: 'Job Information',
};

// ── Content fingerprint (field-level comparison) ──────────────────────────────

function itemFingerprint(item: any): string {
  if (!item) return '';
  return JSON.stringify({
    contentType: item.contentType || '',
    title: item.title || '',
    body: item.body || '',
    isRequired: item.isRequired ?? false,
    isCritical: item.isCritical ?? false,
    metadata: item.metadata || {},
  });
}

// ── Logical identity key for master items (cross-version matching) ────────────
// Two master items are considered "the same item" if their identity key matches.

function itemIdentityKey(item: any): string {
  return `${item.contentType || ''}::${item.title || ''}`;
}

// ── Deterministic preview fingerprint ────────────────────────────────────────

export function computePreviewFingerprint(
  jobId: string, baseVersionId: string, targetVersionId: string,
  jobRevision: string, overrideRevision: number,
  changesBySection: Record<string, any[]>
): string {
  const changesSig = JSON.stringify(changesBySection);
  let hash = 0;
  const str = `${jobId}|${baseVersionId}|${targetVersionId}|${jobRevision}|${overrideRevision}|${changesSig}`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(36)}_${str.length}`;
}

// ── Three-way section diff (stable-ID based) ──────────────────────────────────
//
// Algorithm:
// 1. Build identity-key → item list maps for BASE and TARGET.
// 2. Match BASE items to TARGET items by identity key (positionally within key group).
// 3. Unmatched BASE items → MASTER_REMOVED.
// 4. Unmatched TARGET items → MASTER_ADDED.
// 5. Matched pairs → compare fingerprints; consult company override for three-way.

export function diffSection(
  sectionType: string,
  baseSectionId: string,
  targetSectionId: string,
  baseItems: any[],
  targetItems: any[],
  companyItems: any[] | null
): any[] {
  const hasCompanyOverride = companyItems !== null && companyItems !== undefined;
  const changes: any[] = [];

  // Augment each item with its stable index-based ID (for company override lookup)
  const baseArr = (baseItems || []).map((item: any, idx: number) => ({
    ...item,
    _stableId: `m_${baseSectionId}_${idx}`,
    _identityKey: itemIdentityKey(item),
  }));
  const targetArr = (targetItems || []).map((item: any, idx: number) => ({
    ...item,
    _stableId: `m_${targetSectionId}_${idx}`,
    _identityKey: itemIdentityKey(item),
  }));

  // Build company override map keyed by _itemId (which are BASE stable IDs)
  const companyMap: Record<string, any> = {};
  if (hasCompanyOverride && companyItems) {
    for (const item of companyItems) {
      if (item._itemId) companyMap[item._itemId] = item;
    }
  }

  // Group BASE and TARGET items by identity key
  const baseByKey: Record<string, any[]> = {};
  for (const item of baseArr) {
    if (!baseByKey[item._identityKey]) baseByKey[item._identityKey] = [];
    baseByKey[item._identityKey].push(item);
  }
  const targetByKey: Record<string, any[]> = {};
  for (const item of targetArr) {
    if (!targetByKey[item._identityKey]) targetByKey[item._identityKey] = [];
    targetByKey[item._identityKey].push(item);
  }

  const matchedBaseStableIds = new Set<string>();
  const matchedTargetStableIds = new Set<string>();
  const processedCompanyIds = new Set<string>();
  let changeCounter = 0;

  // ── Match BASE ↔ TARGET by identity key ──────────────────────────────────────
  for (const key of Object.keys(baseByKey)) {
    const baseGroup = baseByKey[key];
    const targetGroup = targetByKey[key] || [];
    const matchCount = Math.min(baseGroup.length, targetGroup.length);

    for (let i = 0; i < matchCount; i++) {
      const baseItem = baseGroup[i];
      const targetItem = targetGroup[i];
      matchedBaseStableIds.add(baseItem._stableId);
      matchedTargetStableIds.add(targetItem._stableId);

      const companyItem = companyMap[baseItem._stableId] || null;
      if (companyItem?._itemId) processedCompanyIds.add(companyItem._itemId);

      const changeId = `chg_${sectionType}_${changeCounter++}`;
      const baseFp = itemFingerprint(baseItem);
      const targetFp = itemFingerprint(targetItem);
      const companyFp = companyItem ? itemFingerprint(companyItem) : null;
      const masterChanged = baseFp !== targetFp;
      const companyChanged = companyItem ? (companyFp !== baseFp) : false;

      if (!masterChanged && !companyChanged) continue; // No change

      if (masterChanged && !companyChanged) {
        changes.push({
          changeId, sectionType,
          baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
          fieldLabel: targetItem.title || `Item ${changeCounter}`,
          changeType: CHANGE_TYPES.MASTER_MODIFIED,
          baseValue: { title: baseItem.title, body: baseItem.body },
          targetValue: { title: targetItem.title, body: targetItem.body },
          companyValue: null, conflictSubtype: null,
          resolutionRequired: false, resolutionOptions: [],
        });
      } else if (!masterChanged && companyChanged) {
        changes.push({
          changeId, sectionType,
          baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
          fieldLabel: companyItem?.title || baseItem?.title || `Item ${changeCounter}`,
          changeType: CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION,
          baseValue: { title: baseItem.title, body: baseItem.body },
          targetValue: { title: targetItem.title, body: targetItem.body },
          companyValue: { title: companyItem?.title, body: companyItem?.body, _itemId: companyItem?._itemId },
          conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
        });
      } else {
        // Both changed
        if (targetFp === companyFp) {
          changes.push({
            changeId, sectionType,
            baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
            fieldLabel: targetItem.title || `Item ${changeCounter}`,
            changeType: CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE,
            baseValue: { title: baseItem.title, body: baseItem.body },
            targetValue: { title: targetItem.title, body: targetItem.body },
            companyValue: { title: companyItem?.title, body: companyItem?.body },
            conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
          });
        } else {
          changes.push({
            changeId, sectionType,
            baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
            fieldLabel: `${baseItem.title || `Item ${changeCounter}`}`,
            changeType: CHANGE_TYPES.CONFLICT,
            baseValue: { title: baseItem.title, body: baseItem.body },
            targetValue: { title: targetItem.title, body: targetItem.body },
            companyValue: { title: companyItem?.title, body: companyItem?.body, _itemId: companyItem?._itemId },
            conflictSubtype: CONFLICT_SUBTYPES.BOTH_MODIFIED_DIFFERENTLY,
            resolutionRequired: true, resolutionOptions: RESOLUTION_OPTIONS,
          });
        }
      }
    }

    // Excess BASE items (more base than target for this key) → MASTER_REMOVED
    for (let i = matchCount; i < baseGroup.length; i++) {
      const baseItem = baseGroup[i];
      matchedBaseStableIds.add(baseItem._stableId);
      const companyItem = companyMap[baseItem._stableId] || null;
      if (companyItem?._itemId) processedCompanyIds.add(companyItem._itemId);
      const changeId = `chg_${sectionType}_${changeCounter++}`;

      if (companyItem) {
        const companyFp = itemFingerprint(companyItem);
        const baseFp = itemFingerprint(baseItem);
        if (companyFp !== baseFp) {
          changes.push({
            changeId, sectionType,
            baseItemId: baseItem._stableId, targetItemId: null,
            fieldLabel: companyItem.title || baseItem.title || `Item ${changeCounter}`,
            changeType: CHANGE_TYPES.CONFLICT,
            baseValue: { title: baseItem.title, body: baseItem.body },
            targetValue: null,
            companyValue: { title: companyItem.title, body: companyItem.body, _itemId: companyItem._itemId },
            conflictSubtype: CONFLICT_SUBTYPES.MASTER_REMOVED_COMPANY_MODIFIED,
            resolutionRequired: true, resolutionOptions: RESOLUTION_OPTIONS,
          });
        } else {
          changes.push({
            changeId, sectionType,
            baseItemId: baseItem._stableId, targetItemId: null,
            fieldLabel: baseItem.title || `Item ${changeCounter}`,
            changeType: CHANGE_TYPES.MASTER_REMOVED,
            baseValue: { title: baseItem.title, body: baseItem.body },
            targetValue: null, companyValue: null,
            conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
          });
        }
      } else {
        changes.push({
          changeId, sectionType,
          baseItemId: baseItem._stableId, targetItemId: null,
          fieldLabel: baseItem.title || `Item ${changeCounter}`,
          changeType: CHANGE_TYPES.MASTER_REMOVED,
          baseValue: { title: baseItem.title, body: baseItem.body },
          targetValue: null, companyValue: null,
          conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
        });
      }
    }
  }

  // ── Unmatched TARGET items → MASTER_ADDED ─────────────────────────────────
  for (const item of targetArr) {
    if (matchedTargetStableIds.has(item._stableId)) continue;
    const changeId = `chg_${sectionType}_${changeCounter++}`;
    changes.push({
      changeId, sectionType,
      baseItemId: null, targetItemId: item._stableId,
      fieldLabel: item.title || `New Item ${changeCounter}`,
      changeType: CHANGE_TYPES.MASTER_ADDED,
      baseValue: null,
      targetValue: { title: item.title, body: item.body },
      companyValue: null, conflictSubtype: null,
      resolutionRequired: false, resolutionOptions: [],
    });
  }

  // ── Company-added items (not anchored to any base item) → COMPANY_ONLY ────
  if (hasCompanyOverride) {
    for (const [cid, ci] of Object.entries(companyMap)) {
      if (processedCompanyIds.has(cid)) continue;
      const changeId = `chg_${sectionType}_company_${cid}`;
      changes.push({
        changeId, sectionType,
        baseItemId: null, targetItemId: null,
        fieldLabel: (ci as any).title || 'Company Added Item',
        changeType: CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION,
        baseValue: null, targetValue: null,
        companyValue: { title: (ci as any).title, body: (ci as any).body, _itemId: cid },
        conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
      });
    }
  }

  return changes;
}

// ── Three-way metadata diff ───────────────────────────────────────────────────

export function diffMetadata(
  baseTitle: string, targetTitle: string,
  baseDesc: string, targetDesc: string,
  companyTitle: string | null, companyDesc: string | null
): any[] {
  const changes: any[] = [];

  const masterTitleChanged = baseTitle !== targetTitle;
  const companyTitleChanged = companyTitle !== null && companyTitle !== undefined && companyTitle !== baseTitle;

  if (masterTitleChanged || companyTitleChanged) {
    if (masterTitleChanged && !companyTitleChanged) {
      changes.push({ changeId: 'chg_metadata_title', sectionType: 'metadata', fieldPath: 'title', fieldLabel: 'Job Title', changeType: CHANGE_TYPES.MASTER_MODIFIED, baseValue: baseTitle, targetValue: targetTitle, companyValue: null, conflictSubtype: null, resolutionRequired: false, resolutionOptions: [] });
    } else if (!masterTitleChanged && companyTitleChanged) {
      changes.push({ changeId: 'chg_metadata_title', sectionType: 'metadata', fieldPath: 'title', fieldLabel: 'Job Title', changeType: CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION, baseValue: baseTitle, targetValue: targetTitle, companyValue: companyTitle, conflictSubtype: null, resolutionRequired: false, resolutionOptions: [] });
    } else if (masterTitleChanged && companyTitleChanged) {
      if (targetTitle === companyTitle) {
        changes.push({ changeId: 'chg_metadata_title', sectionType: 'metadata', fieldPath: 'title', fieldLabel: 'Job Title', changeType: CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE, baseValue: baseTitle, targetValue: targetTitle, companyValue: companyTitle, conflictSubtype: null, resolutionRequired: false, resolutionOptions: [] });
      } else {
        changes.push({ changeId: 'chg_metadata_title', sectionType: 'metadata', fieldPath: 'title', fieldLabel: 'Job Title', changeType: CHANGE_TYPES.CONFLICT, baseValue: baseTitle, targetValue: targetTitle, companyValue: companyTitle, conflictSubtype: CONFLICT_SUBTYPES.BOTH_MODIFIED_DIFFERENTLY, resolutionRequired: true, resolutionOptions: RESOLUTION_OPTIONS });
      }
    }
  }

  const masterDescChanged = baseDesc !== targetDesc;
  const companyDescChanged = companyDesc !== null && companyDesc !== undefined && companyDesc !== baseDesc;

  if (masterDescChanged || companyDescChanged) {
    if (masterDescChanged && !companyDescChanged) {
      changes.push({ changeId: 'chg_metadata_shortDescription', sectionType: 'metadata', fieldPath: 'shortDescription', fieldLabel: 'Short Description', changeType: CHANGE_TYPES.MASTER_MODIFIED, baseValue: baseDesc, targetValue: targetDesc, companyValue: null, conflictSubtype: null, resolutionRequired: false, resolutionOptions: [] });
    } else if (!masterDescChanged && companyDescChanged) {
      changes.push({ changeId: 'chg_metadata_shortDescription', sectionType: 'metadata', fieldPath: 'shortDescription', fieldLabel: 'Short Description', changeType: CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION, baseValue: baseDesc, targetValue: targetDesc, companyValue: companyDesc, conflictSubtype: null, resolutionRequired: false, resolutionOptions: [] });
    } else if (masterDescChanged && companyDescChanged) {
      if (targetDesc === companyDesc) {
        changes.push({ changeId: 'chg_metadata_shortDescription', sectionType: 'metadata', fieldPath: 'shortDescription', fieldLabel: 'Short Description', changeType: CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE, baseValue: baseDesc, targetValue: targetDesc, companyValue: companyDesc, conflictSubtype: null, resolutionRequired: false, resolutionOptions: [] });
      } else {
        changes.push({ changeId: 'chg_metadata_shortDescription', sectionType: 'metadata', fieldPath: 'shortDescription', fieldLabel: 'Short Description', changeType: CHANGE_TYPES.CONFLICT, baseValue: baseDesc, targetValue: targetDesc, companyValue: companyDesc, conflictSubtype: CONFLICT_SUBTYPES.BOTH_MODIFIED_DIFFERENTLY, resolutionRequired: true, resolutionOptions: RESOLUTION_OPTIONS });
      }
    }
  }

  return changes;
}

// ── Validate resolutions ──────────────────────────────────────────────────────

export function validateResolutions(changesBySection: Record<string, any[]>, resolutions: Record<string, string>): string[] {
  const errors: string[] = [];
  const validIds = new Set<string>();
  const requiredIds = new Set<string>();

  for (const changes of Object.values(changesBySection)) {
    for (const change of changes) {
      validIds.add(change.changeId);
      if (change.resolutionRequired) requiredIds.add(change.changeId);
    }
  }

  for (const id of requiredIds) {
    if (!resolutions[id]) errors.push(`Missing resolution for conflict '${id}'`);
    else if (!RESOLUTION_OPTIONS.includes(resolutions[id])) errors.push(`Invalid resolution '${resolutions[id]}' for '${id}'`);
  }

  for (const id of Object.keys(resolutions)) {
    if (!validIds.has(id)) errors.push(`Unknown resolution ID '${id}'`);
  }

  return errors;
}

// ── Rebase override onto TARGET ───────────────────────────────────────────────

export function rebaseOverride(
  changesBySection: Record<string, any[]>,
  resolutions: Record<string, string>,
  existingOverrideData: any,
  targetSections: any[]
): any | null {
  const rebasedSectionOverrides: Record<string, any[]> = {};

  const allSectionTypes = new Set([
    ...Object.keys(existingOverrideData?.sectionOverrides || {}),
    ...Object.keys(changesBySection).filter(k => k !== 'metadata'),
  ]);

  for (const st of allSectionTypes) {
    const sectionChanges: any[] = changesBySection[st] || [];
    const existingItems: any[] | null = existingOverrideData?.sectionOverrides?.[st] || null;
    if (!existingItems) continue;

    const rebasedItems: any[] = [];

    for (const item of existingItems) {
      const itemId = item._itemId;
      if (!itemId) continue;

      const matchingChange = sectionChanges.find(c =>
        c.baseItemId === itemId || (c.companyValue && c.companyValue._itemId === itemId)
      );

      if (!matchingChange) {
        // No diff entry — company-added item; always preserve
        rebasedItems.push({ ...item });
        continue;
      }

      const changeType = matchingChange.changeType;
      const resolution = resolutions[matchingChange.changeId];

      if (changeType === CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION) {
        rebasedItems.push({ ...item });
      } else if (changeType === CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE) {
        continue; // inherit target
      } else if (changeType === CHANGE_TYPES.CONFLICT) {
        if (matchingChange.conflictSubtype === CONFLICT_SUBTYPES.MASTER_REMOVED_COMPANY_MODIFIED) {
          if (resolution === 'KEEP_COMPANY') rebasedItems.push({ ...item });
          // USE_NEW → removed from target; drop override
        } else if (resolution === 'KEEP_COMPANY') {
          rebasedItems.push({ ...item });
        }
        // USE_NEW → inherit target; drop override entry
      } else if (changeType === CHANGE_TYPES.MASTER_MODIFIED) {
        continue; // inherit updated target item
      } else if (changeType === CHANGE_TYPES.MASTER_REMOVED) {
        continue; // item gone in target
      }
    }

    if (rebasedItems.length > 0) rebasedSectionOverrides[st] = rebasedItems;
  }

  // Metadata rebase
  let rebasedTitle: string | null = null;
  let rebasedDesc: string | null = null;

  const metaChanges: any[] = changesBySection['metadata'] || [];

  const titleChange = metaChanges.find(c => c.fieldPath === 'title');
  if (titleChange) {
    if (titleChange.changeType === CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION) rebasedTitle = titleChange.companyValue;
    else if (titleChange.changeType === CHANGE_TYPES.CONFLICT && resolutions[titleChange.changeId] === 'KEEP_COMPANY') rebasedTitle = titleChange.companyValue;
  } else if (existingOverrideData?.title) {
    rebasedTitle = existingOverrideData.title;
  }

  const descChange = metaChanges.find(c => c.fieldPath === 'shortDescription');
  if (descChange) {
    if (descChange.changeType === CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION) rebasedDesc = descChange.companyValue;
    else if (descChange.changeType === CHANGE_TYPES.CONFLICT && resolutions[descChange.changeId] === 'KEEP_COMPANY') rebasedDesc = descChange.companyValue;
  } else if (existingOverrideData?.shortDescription) {
    rebasedDesc = existingOverrideData.shortDescription;
  }

  const rebasedOverrideData: any = {};
  if (rebasedTitle) rebasedOverrideData.title = rebasedTitle;
  if (rebasedDesc) rebasedOverrideData.shortDescription = rebasedDesc;
  if (Object.keys(rebasedSectionOverrides).length > 0) rebasedOverrideData.sectionOverrides = rebasedSectionOverrides;

  return Object.keys(rebasedOverrideData).length === 0 ? null : rebasedOverrideData;
}

// ── Build summary counts ──────────────────────────────────────────────────────

export function buildSummary(changesBySection: Record<string, any[]>): Record<string, number> {
  let additions = 0, removals = 0, modifications = 0, conflicts = 0, preserved = 0, autoCompatible = 0;

  for (const changes of Object.values(changesBySection)) {
    for (const change of changes) {
      switch (change.changeType) {
        case CHANGE_TYPES.MASTER_ADDED: additions++; break;
        case CHANGE_TYPES.MASTER_REMOVED: removals++; break;
        case CHANGE_TYPES.MASTER_MODIFIED: modifications++; break;
        case CHANGE_TYPES.CONFLICT: conflicts++; break;
        case CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION: preserved++; break;
        case CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE: autoCompatible++; break;
      }
    }
  }

  return { additions, removals, modifications, conflicts, preservedCustomizations: preserved, automaticallyCompatible: autoCompatible };
}