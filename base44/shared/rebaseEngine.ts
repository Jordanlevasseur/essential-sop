/**
 * rebaseEngine.ts — Single Authoritative Rebase Transformation
 *
 * This module is THE SINGLE SOURCE OF TRUTH for the override rebase transformation.
 * It is called by BOTH:
 *   - adoptionEngine.ts  (Phase 4, before the three-step write)
 *   - previewFromAnalysis/entry.ts (read-only, no writes)
 *
 * Guarantee: identical inputs → identical outputs in both callers.
 * Any change to rebase logic must be made here and only here.
 *
 * ── RULES ─────────────────────────────────────────────────────────────────────
 * SAFE             → preserve company override item as-is
 * NO_OP            → preserve company override item as-is
 * ORPHANED         → preserve company override item as-is
 * REVIEW_REQUIRED  → KEEP_COMPANY: preserve; USE_NEW_MASTER: drop; undecided: preserve
 * INVALID          → preserve (caller must gate on invalidCount > 0 before calling)
 * Company-only     → always preserved (no matching itemResult)
 *
 * Metadata fields (title, shortDescription):
 *   SAFE/NO_OP     → preserve existing override value
 *   REVIEW_REQUIRED → honour decision; fallback to preserve
 *   No itemResult   → preserve (company-only)
 *
 * ── PURE FUNCTION ─────────────────────────────────────────────────────────────
 * Performs NO database reads or writes.
 * Deterministic: same inputs always produce the same output.
 * Returns null if no override content survives the rebase.
 */

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'] as const;

const COMPATIBILITY = {
  SAFE: 'SAFE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  ORPHANED: 'ORPHANED',
  INVALID: 'INVALID',
  NO_OP: 'NO_OP',
} as const;

export interface RebaseInput {
  /** itemResults from CompanyVersionAnalysis */
  itemResults: any[];
  /**
   * Sanitized existing override data (overrideData from JobOverride after sanitization).
   * Pass null if there is no override — result will be null.
   */
  existingOverrideData: any | null;
  /** EssentialSOPSection[] for the target version (unused in rebase; kept for future extensibility) */
  targetSections: any[];
  /**
   * Per-item decisions.
   * Key: logicalItemId (or _itemId fallback).
   * Value: 'KEEP_COMPANY' | 'USE_NEW_MASTER'
   * Undecided items (key absent) are preserved (safe default for both preview and adoption).
   */
  reviewDecisions: Record<string, string>;
}

export interface RebaseOutput {
  /**
   * The complete rebased override data object ready for persistence.
   * null means the override is empty after rebase (no customizations survive).
   */
  rebasedOverrideData: any | null;
  /**
   * Item-level counts for adoption summary and audit.
   * Not used by preview, included for consistency so callers share the same output type.
   */
  counts: {
    safeApplied: number;
    reviewDecisionsKept: number;
    reviewDecisionsAccepted: number;
    orphanedPreserved: number;
    noOpPreserved: number;
    companyOnlyPreserved: number;
  };
}

/**
 * rebaseOverrideFromAnalysis — THE single transformation function.
 *
 * Called by adoptionEngine.ts and previewFromAnalysis.
 * Must never be duplicated. All callers import this export.
 */
export function rebaseOverrideFromAnalysis(input: RebaseInput): RebaseOutput {
  const { itemResults, existingOverrideData, reviewDecisions } = input;

  const counts = {
    safeApplied: 0,
    reviewDecisionsKept: 0,
    reviewDecisionsAccepted: 0,
    orphanedPreserved: 0,
    noOpPreserved: 0,
    companyOnlyPreserved: 0,
  };

  if (!existingOverrideData) {
    return { rebasedOverrideData: null, counts };
  }

  // Build a lookup: _itemId → itemResult
  const resultByItemId: Record<string, any> = {};
  for (const ir of itemResults) {
    if (ir.currentItemId) resultByItemId[ir.currentItemId] = ir;
    if (ir.companyOverrideValues?.item?._itemId) resultByItemId[ir.companyOverrideValues.item._itemId] = ir;
  }

  // ── Section content rebase ─────────────────────────────────────────────────
  const rebasedSectionOverrides: Record<string, any[]> = {};

  for (const st of SECTION_ORDER) {
    const existingItems: any[] = existingOverrideData?.sectionOverrides?.[st] || [];
    if (existingItems.length === 0) continue;

    const rebasedItems: any[] = [];

    for (const item of existingItems) {
      const itemId = item._itemId || '';
      const ir: any = itemId ? resultByItemId[itemId] : null;

      if (!ir) {
        // No matching analysis result → company-only item; always preserve
        rebasedItems.push({ ...item });
        counts.companyOnlyPreserved++;
        continue;
      }

      const compat = ir.compatibility;

      if (compat === COMPATIBILITY.SAFE) {
        rebasedItems.push({ ...item });
        counts.safeApplied++;
      } else if (compat === COMPATIBILITY.NO_OP) {
        rebasedItems.push({ ...item });
        counts.noOpPreserved++;
      } else if (compat === COMPATIBILITY.ORPHANED) {
        rebasedItems.push({ ...item });
        counts.orphanedPreserved++;
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const decisionKey = ir.logicalItemId || itemId;
        const decision = reviewDecisions[decisionKey];
        if (decision === 'USE_NEW_MASTER') {
          // Drop — company override discarded in favour of master
          counts.reviewDecisionsAccepted++;
        } else {
          // KEEP_COMPANY or undecided — preserve (safe default)
          rebasedItems.push({ ...item });
          if (decision === 'KEEP_COMPANY') {
            counts.reviewDecisionsKept++;
          } else {
            counts.companyOnlyPreserved++; // undecided treated as company-only
          }
        }
      } else {
        // INVALID or unknown — preserve (caller must gate on invalidCount)
        rebasedItems.push({ ...item });
        counts.companyOnlyPreserved++;
      }
    }

    if (rebasedItems.length > 0) {
      rebasedSectionOverrides[st] = rebasedItems;
    }
  }

  // ── Metadata field rebase (title, shortDescription) ───────────────────────
  let rebasedTitle: string | null = null;
  let rebasedDesc: string | null = null;

  const metaResults = itemResults.filter((r: any) => r.itemType === 'metadata_field');

  for (const mr of metaResults) {
    const fieldPath = (mr.logicalItemId || '').replace('metadata_', '');
    const compat = mr.compatibility;

    if (fieldPath.startsWith('title')) {
      if (compat === COMPATIBILITY.SAFE || compat === COMPATIBILITY.NO_OP) {
        if (existingOverrideData?.title) {
          rebasedTitle = existingOverrideData.title;
          counts.safeApplied++;
        }
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const decision = reviewDecisions[mr.logicalItemId || 'metadata_title'];
        if (decision === 'USE_NEW_MASTER') {
          counts.reviewDecisionsAccepted++;
        } else if (existingOverrideData?.title) {
          rebasedTitle = existingOverrideData.title;
          if (decision === 'KEEP_COMPANY') counts.reviewDecisionsKept++;
          else counts.companyOnlyPreserved++;
        }
      }
    } else if (fieldPath.startsWith('shortDescription')) {
      if (compat === COMPATIBILITY.SAFE || compat === COMPATIBILITY.NO_OP) {
        if (existingOverrideData?.shortDescription) {
          rebasedDesc = existingOverrideData.shortDescription;
          counts.safeApplied++;
        }
      } else if (compat === COMPATIBILITY.REVIEW_REQUIRED) {
        const decision = reviewDecisions[mr.logicalItemId || 'metadata_shortDescription'];
        if (decision === 'USE_NEW_MASTER') {
          counts.reviewDecisionsAccepted++;
        } else if (existingOverrideData?.shortDescription) {
          rebasedDesc = existingOverrideData.shortDescription;
          if (decision === 'KEEP_COMPANY') counts.reviewDecisionsKept++;
          else counts.companyOnlyPreserved++;
        }
      }
    }
  }

  // Company-only metadata: no itemResult covering these fields → preserve
  if (!rebasedTitle && existingOverrideData?.title) {
    if (!metaResults.some((r: any) => (r.logicalItemId || '').includes('title'))) {
      rebasedTitle = existingOverrideData.title;
      counts.companyOnlyPreserved++;
    }
  }
  if (!rebasedDesc && existingOverrideData?.shortDescription) {
    if (!metaResults.some((r: any) => (r.logicalItemId || '').includes('shortDescription'))) {
      rebasedDesc = existingOverrideData.shortDescription;
      counts.companyOnlyPreserved++;
    }
  }

  // ── Assemble final override data ───────────────────────────────────────────
  const rebasedOverrideData: any = {};
  if (rebasedTitle) rebasedOverrideData.title = rebasedTitle;
  if (rebasedDesc) rebasedOverrideData.shortDescription = rebasedDesc;
  if (Object.keys(rebasedSectionOverrides).length > 0) {
    rebasedOverrideData.sectionOverrides = rebasedSectionOverrides;
  }

  return {
    rebasedOverrideData: Object.keys(rebasedOverrideData).length === 0 ? null : rebasedOverrideData,
    counts,
  };
}