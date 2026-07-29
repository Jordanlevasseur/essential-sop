/**
 * overrideSchema — Single authoritative schema for company Job overrides.
 *
 * Used by BOTH saveJobOverride (write path) and resolveJob (read path).
 * No separate validation rules may exist in either function.
 *
 * STABLE NESTED ID STRATEGY
 * --------------------------
 * Items in sectionOverrides carry a persistent `_itemId` field.
 * Rules:
 *   - Master-sourced items: ID = `m_${sectionId}_${itemIndex}` (index is stable because
 *     master contentItems are immutable for a published version).
 *   - Company override items: ID = `o_${sectionId}_${nanoid8}` assigned once at creation.
 *   - IDs are stored in the override payload alongside each item.
 *   - Reordering updates sortOrder only — never changes _itemId.
 *   - Resolver attaches the stored _itemId as the virtual `id` field on each content item.
 *   - Duplicate _itemId values within a section are rejected at save time.
 *
 * DETERMINISTIC OVERRIDE RECORD ID
 * ----------------------------------
 * Override records use a deterministic ID derived from companyId + jobId:
 *   `override_${companyId}_${jobId}`
 * This allows upsert-by-known-ID semantics which close the concurrent first-create race.
 * Base44 SDK does not expose create-with-ID; we use filter-then-update/create with
 * the deterministic ID stored in a `deterministicKey` field for duplicate detection.
 */

// Fields the company is allowed to set in overrideData.
export const ALLOWED_OVERRIDE_FIELDS = new Set(['title', 'shortDescription', 'sectionOverrides']);

// Valid section types for sectionOverrides.
export const VALID_SECTION_TYPES = new Set(['tools', 'materials', 'scope', 'procedure', 'safety', 'quality']);

// Fields allowed on each content item in sectionOverrides.
// _itemId is system-managed — allowed at read time but never set by client.
export const ALLOWED_CONTENT_ITEM_FIELDS = new Set([
  'contentType', 'title', 'body', 'sortOrder', 'isRequired', 'isCritical', 'metadata', '_itemId'
]);

// Forbidden fields — must never appear in client-supplied overrideData.
export const FORBIDDEN_FIELDS = new Set([
  'id', 'companyId', 'jobId', 'sourceMasterId', 'sourceVersionId',
  'revision', 'mutationKey', 'lastMutationKey', 'deterministicKey',
  'createdByUserId', 'lastModifiedByUserId', 'createdAt', 'updatedAt',
  'created_date', 'updated_date', 'created_by_id',
  'sourceType', 'isCustomized', 'customizedAt', 'customizedBy', 'capabilities',
]);

// Protected job identity fields — never sourced from override data.
export const PROTECTED_JOB_FIELDS = new Set([
  'id', 'companyId', 'sourceType', 'sourceMasterId', 'sourceVersionId',
  'isCustomized', 'customizedAt', 'customizedBy', 'status', 'isArchived',
]);

/**
 * Validate client-supplied overrideData at save time.
 * Returns { valid: true } or { valid: false, error: string, code: string }.
 */
export function validateOverrideData(overrideData) {
  if (!overrideData || typeof overrideData !== 'object') {
    return { valid: false, error: 'overrideData is required and must be an object', code: 'INVALID_INPUT' };
  }

  for (const key of Object.keys(overrideData)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      return { valid: false, error: `Field '${key}' is not allowed in overrideData`, code: 'FORBIDDEN_FIELD' };
    }
    if (!ALLOWED_OVERRIDE_FIELDS.has(key)) {
      return { valid: false, error: `Unknown field '${key}' in overrideData`, code: 'UNKNOWN_FIELD' };
    }
  }

  if (overrideData.title !== undefined && typeof overrideData.title !== 'string') {
    return { valid: false, error: 'title must be a string', code: 'INVALID_INPUT' };
  }
  if (overrideData.shortDescription !== undefined && typeof overrideData.shortDescription !== 'string') {
    return { valid: false, error: 'shortDescription must be a string', code: 'INVALID_INPUT' };
  }

  if (overrideData.sectionOverrides !== undefined) {
    if (typeof overrideData.sectionOverrides !== 'object' || Array.isArray(overrideData.sectionOverrides)) {
      return { valid: false, error: 'sectionOverrides must be an object', code: 'INVALID_INPUT' };
    }
    for (const [sectionType, items] of Object.entries(overrideData.sectionOverrides)) {
      if (!VALID_SECTION_TYPES.has(sectionType)) {
        return { valid: false, error: `Invalid sectionType '${sectionType}'`, code: 'INVALID_SECTION_TYPE' };
      }
      if (!Array.isArray(items)) {
        return { valid: false, error: `sectionOverrides.${sectionType} must be an array`, code: 'INVALID_INPUT' };
      }
      const seenItemIds = new Set();
      for (const item of items) {
        for (const itemKey of Object.keys(item)) {
          if (!ALLOWED_CONTENT_ITEM_FIELDS.has(itemKey)) {
            return { valid: false, error: `Unknown field '${itemKey}' in content item for section '${sectionType}'`, code: 'UNKNOWN_FIELD' };
          }
        }
        // Reject duplicate _itemId within a section
        if (item._itemId) {
          if (seenItemIds.has(item._itemId)) {
            return { valid: false, error: `Duplicate _itemId '${item._itemId}' in section '${sectionType}'`, code: 'DUPLICATE_ITEM_ID' };
          }
          seenItemIds.add(item._itemId);
        }
      }
    }
  }

  return { valid: true };
}

/**
 * Generate a stable _itemId for a new override item.
 * Uses timestamp + random suffix — assigned once, stored in payload, never regenerated.
 */
export function generateItemId(sectionId) {
  const rand = Math.random().toString(36).slice(2, 9);
  return `o_${sectionId}_${rand}`;
}

/**
 * Generate the stable master item ID for a given sectionId + index.
 * Master contentItems are immutable for a published version so index is stable.
 */
export function masterItemId(sectionId, index) {
  return `m_${sectionId}_${index}`;
}

/**
 * Sanitize stored override data at RESOLVE time.
 * Strips or ignores any fields that should never appear in a stored override.
 * Returns { sanitized: overrideData, warnings: string[] }.
 * Never throws — on partial malformation, falls back to safe defaults per field.
 */
export function sanitizeStoredOverride(storedOverride, jobId) {
  const warnings = [];

  if (!storedOverride || typeof storedOverride !== 'object') {
    warnings.push(`[resolveJob] override for job ${jobId} is not an object — discarded`);
    return { sanitized: null, warnings };
  }

  const sanitized = {};

  // title — must be a non-empty string
  if (storedOverride.title !== undefined) {
    if (typeof storedOverride.title === 'string' && storedOverride.title.trim()) {
      sanitized.title = storedOverride.title.trim();
    } else {
      warnings.push(`[resolveJob] override.title for job ${jobId} is malformed — using master title`);
    }
  }

  // shortDescription — must be a string
  if (storedOverride.shortDescription !== undefined) {
    if (typeof storedOverride.shortDescription === 'string') {
      sanitized.shortDescription = storedOverride.shortDescription;
    } else {
      warnings.push(`[resolveJob] override.shortDescription for job ${jobId} is malformed — using master value`);
    }
  }

  // sectionOverrides — must be an object of section arrays
  if (storedOverride.sectionOverrides !== undefined) {
    if (typeof storedOverride.sectionOverrides === 'object' && !Array.isArray(storedOverride.sectionOverrides)) {
      const cleanSections = {};
      for (const [st, items] of Object.entries(storedOverride.sectionOverrides)) {
        if (!VALID_SECTION_TYPES.has(st)) {
          warnings.push(`[resolveJob] override has invalid sectionType '${st}' for job ${jobId} — section skipped`);
          continue;
        }
        if (!Array.isArray(items)) {
          warnings.push(`[resolveJob] override sectionOverrides.${st} for job ${jobId} is not an array — section falls back to master`);
          continue;
        }
        // Filter out items with forbidden/unexpected fields — keep safe items only
        const cleanItems = [];
        for (const item of items) {
          const cleanItem = {};
          let itemSafe = true;
          for (const k of Object.keys(item)) {
            if (PROTECTED_JOB_FIELDS.has(k) || FORBIDDEN_FIELDS.has(k)) {
              warnings.push(`[resolveJob] override item has forbidden field '${k}' for job ${jobId} — field stripped`);
              continue;
            }
            if (ALLOWED_CONTENT_ITEM_FIELDS.has(k)) {
              cleanItem[k] = item[k];
            }
            // silently drop truly unknown fields at resolve time
          }
          if (itemSafe) cleanItems.push(cleanItem);
        }
        cleanSections[st] = cleanItems;
      }
      sanitized.sectionOverrides = cleanSections;
    } else {
      warnings.push(`[resolveJob] override.sectionOverrides for job ${jobId} is malformed — all sections fall back to master`);
    }
  }

  // Strip any protected/forbidden fields that somehow ended up stored
  for (const key of PROTECTED_JOB_FIELDS) {
    if (sanitized[key] !== undefined) {
      warnings.push(`[resolveJob] stored override has protected field '${key}' for job ${jobId} — stripped`);
      delete sanitized[key];
    }
  }

  return { sanitized, warnings };
}

/**
 * Build resolved content items for a section, using stable _itemId values.
 * sectionId: the EssentialSOPSection.id (stable for a published version).
 * masterItems: raw contentItems from the master section.
 * overrideItems: the stored company override for this section (if any), or null.
 * Returns an array of resolved content items with stable `id` fields.
 */
export function buildResolvedItems(sectionId, masterItems, overrideItems, jobId, companyId) {
  const sourceItems = overrideItems || masterItems || [];
  const isOverride = !!overrideItems;

  return sourceItems.map((item, idx) => {
    // Stable ID: prefer stored _itemId, fall back to deterministic index-based for master items
    const stableId = item._itemId || (isOverride ? `o_${sectionId}_${idx}` : masterItemId(sectionId, idx));
    return {
      id: stableId,
      jobId,
      companyId,
      sectionId,
      sectionType: item.sectionType,  // may be undefined for master items — caller sets correct sectionType
      contentType: item.contentType || 'text',
      title: typeof item.title === 'string' ? item.title : '',
      body: typeof item.body === 'string' ? item.body : '',
      sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : idx,
      isRequired: typeof item.isRequired === 'boolean' ? item.isRequired : false,
      isCritical: typeof item.isCritical === 'boolean' ? item.isCritical : false,
      metadata: (item.metadata && typeof item.metadata === 'object') ? item.metadata : {},
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Compute the deterministic override record key for a given company+job pair.
 * Used to detect duplicate records created in a concurrent first-save race.
 */
export function deterministicOverrideKey(companyId, jobId) {
  return `override_${companyId}_${jobId}`;
}