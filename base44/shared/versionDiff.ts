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
  /**
   * AMBIGUOUS_IDENTITY — emitted when an item is matched via legacy text-based
   * fallback (contentType::title) rather than by logicalItemId. This occurs only
   * for historical items that pre-date the logicalItemId field.
   * Treatment: always classified REVIEW_REQUIRED so the company admin can confirm
   * the match is correct. Never silently adopted as a confident match.
   */
  AMBIGUOUS_IDENTITY: 'AMBIGUOUS_IDENTITY',
};

export const CONFLICT_SUBTYPES = {
  BOTH_MODIFIED_DIFFERENTLY: 'BOTH_MODIFIED_DIFFERENTLY',
  MASTER_REMOVED_COMPANY_MODIFIED: 'MASTER_REMOVED_COMPANY_MODIFIED',
  /** Legacy text-only match — cannot be confirmed as the same logical item. */
  LEGACY_TEXT_MATCH: 'LEGACY_TEXT_MATCH',
};

const RESOLUTION_OPTIONS = ['KEEP_COMPANY', 'USE_NEW_ESSENTIAL_SOP'];

export const SECTION_LABELS: Record<string, string> = {
  tools: 'Tools', materials: 'Materials', scope: 'Scope',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
  metadata: 'Job Information',
};

// ── Content fingerprint (whole-item, used for identity equality checks) ──────

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

// ── Per-field changed-set extraction ──────────────────────────────────────────
// Returns the set of field names that differ between two items.
// Used to determine whether master and company changes are on OVERLAPPING fields
// (true conflict) vs INDEPENDENT fields (SAFE — both changes can coexist).
const COMPARABLE_FIELDS = ['contentType', 'title', 'body', 'isRequired', 'isCritical', 'metadata'];

function changedFields(from: any, to: any): Set<string> {
  const changed = new Set<string>();
  if (!from || !to) return changed;
  for (const f of COMPARABLE_FIELDS) {
    const fv = from[f] ?? (f === 'isRequired' || f === 'isCritical' ? false : f === 'metadata' ? {} : '');
    const tv = to[f] ?? (f === 'isRequired' || f === 'isCritical' ? false : f === 'metadata' ? {} : '');
    if (JSON.stringify(fv) !== JSON.stringify(tv)) changed.add(f);
  }
  return changed;
}

// Returns true if two changed-field sets have any overlap.
function setsOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) { if (b.has(x)) return true; }
  return false;
}

// ── Logical identity key for master items — LEGACY TEXT-BASED FALLBACK ONLY ──
// Used ONLY when an item lacks a logicalItemId.
// A match via this key is NOT authoritative — it is emitted as AMBIGUOUS_IDENTITY.
// Never use this as the primary matching mechanism.

function _legacyTextKey(item: any): string {
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

/**
 * diffSection — Three-way section diff engine.
 *
 * MATCHING PRIORITY:
 * 1. PRIMARY: logicalItemId (stable, assigned once at item creation, never changes)
 *    When both base and target items have a matching logicalItemId → same logical item.
 *
 * 2. LEGACY FALLBACK: contentType::title text key
 *    Used ONLY for items lacking logicalItemId on either side.
 *    A match via this path is ALWAYS emitted as AMBIGUOUS_IDENTITY with
 *    conflictSubtype=LEGACY_TEXT_MATCH so the company admin must confirm.
 *    Items unmatched by either path → MASTER_ADDED or MASTER_REMOVED.
 *
 * This ensures a renamed Master item (same logicalItemId, different title) is
 * classified as MASTER_MODIFIED, not REMOVED + ADDED.
 * Duplicate visible titles do not cause incorrect cross-item matching because
 * logicalItemIds are unique.
 */
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

  // Augment with stable per-section index IDs for company override lookup (_itemId uses these)
  const baseArr = (baseItems || []).map((item: any, idx: number) => ({
    ...item,
    _stableId: `m_${baseSectionId}_${idx}`,
  }));
  const targetArr = (targetItems || []).map((item: any, idx: number) => ({
    ...item,
    _stableId: `m_${targetSectionId}_${idx}`,
  }));

  // Build company override map keyed by _itemId (BASE stable IDs)
  const companyMap: Record<string, any> = {};
  if (hasCompanyOverride && companyItems) {
    for (const item of companyItems) {
      if (item._itemId) companyMap[item._itemId] = item;
    }
  }

  const matchedBaseStableIds = new Set<string>();
  const matchedTargetStableIds = new Set<string>();
  const processedCompanyIds = new Set<string>();
  let changeCounter = 0;

  // ── PASS 1: Match by logicalItemId (primary, authoritative) ──────────────
  // Build logicalItemId → item maps for both sides.
  const baseByLid: Record<string, any> = {};
  for (const item of baseArr) {
    if (item.logicalItemId) baseByLid[item.logicalItemId] = item;
  }
  const targetByLid: Record<string, any> = {};
  for (const item of targetArr) {
    if (item.logicalItemId) targetByLid[item.logicalItemId] = item;
  }

  // Match items that exist in BOTH base and target by logicalItemId
  for (const lid of Object.keys(baseByLid)) {
    const baseItem = baseByLid[lid];
    const targetItem = targetByLid[lid];
    if (!targetItem) continue; // will be handled as MASTER_REMOVED below

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

    if (!masterChanged && !companyChanged) continue; // no change

    if (masterChanged && !companyChanged) {
      changes.push({
        changeId, sectionType,
        baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
        logicalItemId: lid,
        fieldLabel: targetItem.title || baseItem.title || `Item ${changeCounter}`,
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
        logicalItemId: lid,
        fieldLabel: companyItem?.title || baseItem?.title || `Item ${changeCounter}`,
        changeType: CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION,
        baseValue: { title: baseItem.title, body: baseItem.body },
        targetValue: { title: targetItem.title, body: targetItem.body },
        companyValue: { title: companyItem?.title, body: companyItem?.body, _itemId: companyItem?._itemId },
        conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
      });
    } else {
      // Both changed — check convergence first, then field overlap
      if (targetFp === companyFp) {
        // Both changed to identical result — AUTOMATICALLY_COMPATIBLE
        changes.push({
          changeId, sectionType,
          baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
          logicalItemId: lid,
          fieldLabel: targetItem.title || `Item ${changeCounter}`,
          changeType: CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE,
          baseValue: { title: baseItem.title, body: baseItem.body },
          targetValue: { title: targetItem.title, body: targetItem.body },
          companyValue: { title: companyItem?.title, body: companyItem?.body },
          conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
        });
      } else {
        // Check whether master and company changed OVERLAPPING fields.
        // If the changed field sets are disjoint (e.g. master changed body, company changed isCritical),
        // both changes can coexist — emit MASTER_MODIFIED so the analysis classifies this as SAFE
        // rather than triggering a false BOTH_MODIFIED_DIFFERENTLY conflict.
        const masterChangedFields = changedFields(baseItem, targetItem);
        const companyChangedFields = changedFields(baseItem, companyItem);
        if (!setsOverlap(masterChangedFields, companyChangedFields)) {
          // Independent field changes — no genuine conflict.
          // Emit as MASTER_MODIFIED (company override is on different fields and will be preserved).
          changes.push({
            changeId, sectionType,
            baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
            logicalItemId: lid,
            fieldLabel: targetItem.title || baseItem.title || `Item ${changeCounter}`,
            changeType: CHANGE_TYPES.MASTER_MODIFIED,
            baseValue: { title: baseItem.title, body: baseItem.body },
            targetValue: { title: targetItem.title, body: targetItem.body },
            companyValue: { title: companyItem?.title, body: companyItem?.body, _itemId: companyItem?._itemId },
            conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
          });
        } else {
          // Overlapping fields — genuine conflict
          changes.push({
            changeId, sectionType,
            baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
            logicalItemId: lid,
            fieldLabel: baseItem.title || `Item ${changeCounter}`,
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
  }

  // ── PASS 1b: logicalItemId-matched MASTER_REMOVED (in base, not in target) ─
  for (const lid of Object.keys(baseByLid)) {
    const baseItem = baseByLid[lid];
    if (matchedBaseStableIds.has(baseItem._stableId)) continue; // already matched

    matchedBaseStableIds.add(baseItem._stableId);
    const companyItem = companyMap[baseItem._stableId] || null;
    if (companyItem?._itemId) processedCompanyIds.add(companyItem._itemId);
    const changeId = `chg_${sectionType}_${changeCounter++}`;

    if (companyItem && itemFingerprint(companyItem) !== itemFingerprint(baseItem)) {
      changes.push({
        changeId, sectionType,
        baseItemId: baseItem._stableId, targetItemId: null,
        logicalItemId: lid,
        fieldLabel: companyItem.title || baseItem.title || `Item ${changeCounter}`,
        changeType: CHANGE_TYPES.CONFLICT,
        baseValue: { title: baseItem.title, body: baseItem.body },
        targetValue: null,
        companyValue: { title: companyItem.title, body: companyItem.body, _itemId: companyItem._itemId },
        conflictSubtype: CONFLICT_SUBTYPES.MASTER_REMOVED_COMPANY_MODIFIED,
        resolutionRequired: true, resolutionOptions: RESOLUTION_OPTIONS,
      });
    } else {
      // Item removed from master. Company may still have an override entry for it (unmodified copy).
      // Expose companyValue so the ORPHANED classification path in versionAnalysisService is reachable.
      const orphanedCompanyValue = companyItem
        ? { title: companyItem.title, body: companyItem.body, _itemId: companyItem._itemId }
        : null;
      changes.push({
        changeId, sectionType,
        baseItemId: baseItem._stableId, targetItemId: null,
        logicalItemId: lid,
        fieldLabel: baseItem.title || `Item ${changeCounter}`,
        changeType: CHANGE_TYPES.MASTER_REMOVED,
        baseValue: { title: baseItem.title, body: baseItem.body },
        targetValue: null, companyValue: orphanedCompanyValue,
        conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
      });
    }
  }

  // ── PASS 1c: logicalItemId-matched MASTER_ADDED (in target, not in base) ──
  for (const lid of Object.keys(targetByLid)) {
    const targetItem = targetByLid[lid];
    if (matchedTargetStableIds.has(targetItem._stableId)) continue;
    matchedTargetStableIds.add(targetItem._stableId);
    const changeId = `chg_${sectionType}_${changeCounter++}`;
    changes.push({
      changeId, sectionType,
      baseItemId: null, targetItemId: targetItem._stableId,
      logicalItemId: lid,
      fieldLabel: targetItem.title || `New Item ${changeCounter}`,
      changeType: CHANGE_TYPES.MASTER_ADDED,
      baseValue: null,
      targetValue: { title: targetItem.title, body: targetItem.body },
      companyValue: null, conflictSubtype: null,
      resolutionRequired: false, resolutionOptions: [],
    });
  }

  // ── PASS 2: Legacy text-based fallback for items WITHOUT logicalItemId ──────
  // Collect unmatched items from both sides that lack logicalItemId.
  const unmatchedBase = baseArr.filter(
    item => !matchedBaseStableIds.has(item._stableId) && !item.logicalItemId
  );
  const unmatchedTarget = targetArr.filter(
    item => !matchedTargetStableIds.has(item._stableId) && !item.logicalItemId
  );

  // Group by legacy text key for positional matching within key group
  const legacyBaseByKey: Record<string, any[]> = {};
  for (const item of unmatchedBase) {
    const k = _legacyTextKey(item);
    if (!legacyBaseByKey[k]) legacyBaseByKey[k] = [];
    legacyBaseByKey[k].push(item);
  }
  const legacyTargetByKey: Record<string, any[]> = {};
  for (const item of unmatchedTarget) {
    const k = _legacyTextKey(item);
    if (!legacyTargetByKey[k]) legacyTargetByKey[k] = [];
    legacyTargetByKey[k].push(item);
  }

  for (const key of Object.keys(legacyBaseByKey)) {
    const baseGroup = legacyBaseByKey[key];
    const targetGroup = legacyTargetByKey[key] || [];
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
      const masterChanged = baseFp !== targetFp;
      const companyChanged = companyItem ? (itemFingerprint(companyItem) !== baseFp) : false;

      // Legacy match — always AMBIGUOUS_IDENTITY requiring admin review
      // even when content appears unchanged, because the match itself is uncertain.
      changes.push({
        changeId, sectionType,
        baseItemId: baseItem._stableId, targetItemId: targetItem._stableId,
        logicalItemId: null,
        fieldLabel: baseItem.title || `Item ${changeCounter}`,
        changeType: CHANGE_TYPES.AMBIGUOUS_IDENTITY,
        baseValue: { title: baseItem.title, body: baseItem.body },
        targetValue: { title: targetItem.title, body: targetItem.body },
        companyValue: companyItem
          ? { title: companyItem.title, body: companyItem.body, _itemId: companyItem._itemId }
          : null,
        conflictSubtype: CONFLICT_SUBTYPES.LEGACY_TEXT_MATCH,
        resolutionRequired: true, resolutionOptions: RESOLUTION_OPTIONS,
        isLegacyFallback: true,
      });
    }

    // Excess base items → MASTER_REMOVED
    for (let i = matchCount; i < baseGroup.length; i++) {
      const baseItem = baseGroup[i];
      matchedBaseStableIds.add(baseItem._stableId);
      const companyItem = companyMap[baseItem._stableId] || null;
      if (companyItem?._itemId) processedCompanyIds.add(companyItem._itemId);
      const changeId = `chg_${sectionType}_${changeCounter++}`;
      if (companyItem && itemFingerprint(companyItem) !== itemFingerprint(baseItem)) {
        changes.push({
          changeId, sectionType,
          baseItemId: baseItem._stableId, targetItemId: null,
          logicalItemId: null,
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
          logicalItemId: null,
          fieldLabel: baseItem.title || `Item ${changeCounter}`,
          changeType: CHANGE_TYPES.MASTER_REMOVED,
          baseValue: { title: baseItem.title, body: baseItem.body },
          targetValue: null, companyValue: null,
          conflictSubtype: null, resolutionRequired: false, resolutionOptions: [],
        });
      }
    }
  }

  // ── Unmatched TARGET items with no logicalItemId → MASTER_ADDED ───────────
  for (const item of unmatchedTarget) {
    if (matchedTargetStableIds.has(item._stableId)) continue;
    const changeId = `chg_${sectionType}_${changeCounter++}`;
    changes.push({
      changeId, sectionType,
      baseItemId: null, targetItemId: item._stableId,
      logicalItemId: null,
      fieldLabel: item.title || `New Item ${changeCounter}`,
      changeType: CHANGE_TYPES.MASTER_ADDED,
      baseValue: null,
      targetValue: { title: item.title, body: item.body },
      companyValue: null, conflictSubtype: null,
      resolutionRequired: false, resolutionOptions: [],
    });
  }

  // ── PASS 3: Also flag unmatched items that HAVE logicalItemId on one side ─
  // These were items with logicalItemId not found on the other side (already handled above
  // in PASS 1b and 1c). No additional work needed here.

  // ── Company-added items not anchored to any base item → COMPANY_ONLY ──────
  if (hasCompanyOverride) {
    for (const [cid, ci] of Object.entries(companyMap)) {
      if (processedCompanyIds.has(cid)) continue;
      const changeId = `chg_${sectionType}_company_${cid}`;
      changes.push({
        changeId, sectionType,
        baseItemId: null, targetItemId: null,
        logicalItemId: null,
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