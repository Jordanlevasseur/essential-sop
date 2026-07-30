/**
 * overrideSanitizer.ts — Single canonical override sanitization for Deno runtime.
 *
 * This module is the ONE place where override sanitization rules are defined.
 * It is imported by:
 *   - versionAnalysisService.ts  (analysis pipeline — Step 2)
 *
 * The JS-module version (overrideSchema.js) defines the same rules for
 * CommonJS callers (saveJobOverride, resolveJob). The two modules share
 * identical field lists; changes to allowed fields MUST be applied in both.
 *
 * WHY SEPARATE FROM overrideSchema.js?
 * overrideSchema.js uses ES module `export` syntax and a `new Set(...)` at
 * module scope. The Deno/Base44 runtime resolves .js imports but iterating
 * a Set exported from another .js module triggered intermittent
 * "value is not iterable" errors at runtime. Inlining was used as a workaround
 * but that created two maintenance copies. This .ts module avoids the problem
 * by declaring its constants inline — no cross-module Set import needed —
 * while being the one canonical Deno-compatible implementation.
 *
 * RULE: No other file may contain override sanitization logic.
 */

/** Fields the company is allowed to set in overrideData. */
const ALLOWED_OVERRIDE_FIELDS = ['title', 'shortDescription', 'sectionOverrides'] as const;

/** Valid section types for sectionOverrides. */
const VALID_SECTION_TYPES = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'] as const;

/** Fields allowed on each content item in sectionOverrides. */
const ALLOWED_CONTENT_ITEM_FIELDS = [
  'contentType', 'title', 'body', 'sortOrder', 'isRequired', 'isCritical', 'metadata', '_itemId'
] as const;

/**
 * sanitizeOverrideData — canonical sanitizer used at analysis time.
 *
 * Takes a raw overrideData object (from a stored JobOverride record) and returns
 * a clean version retaining only allowed fields and valid section types.
 * Never throws. Returns null if the input is wholly invalid.
 */
export function sanitizeOverrideData(overrideData: any, jobId?: string): any | null {
  if (!overrideData || typeof overrideData !== 'object' || Array.isArray(overrideData)) {
    return null;
  }

  const san: any = {};

  // title — must be a non-empty string
  if (typeof overrideData.title === 'string' && overrideData.title.trim()) {
    san.title = overrideData.title.trim();
  }

  // shortDescription — must be a string
  if (typeof overrideData.shortDescription === 'string') {
    san.shortDescription = overrideData.shortDescription;
  }

  // sectionOverrides — must be a plain object of arrays
  const so = overrideData.sectionOverrides;
  if (so && typeof so === 'object' && !Array.isArray(so)) {
    const cleanSections: any = {};
    for (const st of Object.keys(so)) {
      if (!(VALID_SECTION_TYPES as readonly string[]).includes(st)) continue;
      const items = so[st];
      if (!Array.isArray(items)) continue;
      const cleanItems = items.map((item: any) => {
        if (!item || typeof item !== 'object') return null;
        const ci: any = {};
        for (const k of Object.keys(item)) {
          if ((ALLOWED_CONTENT_ITEM_FIELDS as readonly string[]).includes(k)) {
            ci[k] = item[k];
          }
        }
        return ci;
      }).filter(Boolean);
      cleanSections[st] = cleanItems;
    }
    if (Object.keys(cleanSections).length > 0) {
      san.sectionOverrides = cleanSections;
    }
  }

  return Object.keys(san).length === 0 ? null : san;
}