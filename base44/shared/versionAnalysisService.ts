/**
 * versionAnalysisService.ts — Canonical Version Compatibility Analysis Service
 *
 * THE SINGLE AUTHORITATIVE IMPLEMENTATION for analyzing whether a Company Job's
 * existing overrides are compatible with a target Master SOP version.
 *
 * ── ENTRY POINT ────────────────────────────────────────────────────────────────
 * analyzeCompanyJobVersionUpdate() is the ONLY code path that may:
 *   - Compute override compatibility classifications.
 *   - Produce CompanyVersionAnalysis records.
 *   - Write version_analysis_* audit entries.
 *
 * ── ANALYSIS ONLY ──────────────────────────────────────────────────────────────
 * This service MUST NOT:
 *   - Change Job.sourceVersionId
 *   - Change CompanyVersionDecision status
 *   - Create, modify, or delete JobOverride records
 *   - Adopt a version
 *   - Create notifications
 *
 * ── EXISTING DIFF ENGINE ───────────────────────────────────────────────────────
 * versionDiff.ts already implements three-way diff (diffSection, diffMetadata).
 * This service REUSES that engine and maps its CHANGE_TYPES to Edit 5B
 * classifications. No duplicate comparison logic exists.
 *
 * ── OVERRIDE SCOPE ─────────────────────────────────────────────────────────────
 * The override system supports two levels:
 *   1. SOP-level fields: title, shortDescription (stored as overrideData.title / shortDescription)
 *   2. Section-level: sectionOverrides map of sectionType → full item array replacement
 *
 * The override is a FULL SECTION REPLACEMENT — not per-item. So a section
 * override affects ALL items in that section. The diff engine (versionDiff.ts)
 * identifies individual item-level changes within overridden sections.
 *
 * ── STABLE IDENTITY MODEL ──────────────────────────────────────────────────────
 * Cross-version item identity uses `${contentType}::${title}` as the canonical
 * logical identity key (from versionDiff.ts). This is the same key used by the
 * existing previewMasterVersionAdoption and adoptMasterVersionWithResolutions flows.
 * It is text-based with positional disambiguation for duplicate keys within a section.
 *
 * Items in overrides carry `_itemId` which encodes the BASE section ID and index:
 *   `m_${baseSectionId}_${idx}` — for master-sourced items
 *   `o_${sectionId}_${rand}` — for company-added items
 *
 * ── COMPATIBILITY CLASSIFICATIONS ──────────────────────────────────────────────
 * SAFE          — Override can be applied to target without ambiguity
 * REVIEW_REQUIRED — Override may be usable but requires admin confirmation
 * ORPHANED      — Override target no longer exists in the target version
 * INVALID       — Override record is malformed or internally inconsistent
 * NO_OP         — Override is redundant (same as master value)
 *
 * ── CHANGE TYPE MAPPING ────────────────────────────────────────────────────────
 * versionDiff CHANGE_TYPE → Edit 5B master change classification:
 *   MASTER_ADDED             → ADDED
 *   MASTER_REMOVED           → REMOVED
 *   MASTER_MODIFIED          → MODIFIED
 *   COMPANY_ONLY_CUSTOMIZATION → UNCHANGED (master didn't change)
 *   AUTOMATICALLY_COMPATIBLE → MODIFIED (master changed, both converge)
 *   CONFLICT                 → MODIFIED (both changed, values differ)
 *
 * ── DETERMINISTIC ANALYSIS KEY ─────────────────────────────────────────────────
 * analysisKey = `VERSION_ANALYSIS:{companyJobId}:{fromVersionId}:{toVersionId}:{overrideStateFingerprint}:{schemaVersion}`
 *
 * ── OVERRIDE STATE FINGERPRINT ─────────────────────────────────────────────────
 * Deterministic fingerprint of the override's content-affecting fields.
 * Computed from: overrideData (title, shortDescription, sectionOverrides), revision.
 * Volatile fields excluded: updatedAt, lastModifiedByUserId, auditPending, etc.
 *
 * ── IDEMPOTENCY ────────────────────────────────────────────────────────────────
 * Repeated calls with identical (companyJobId, fromVersionId, toVersionId,
 * overrideStateFingerprint, schemaVersion) return the existing COMPLETED result.
 * Failed analyses are re-attempted.
 *
 * ── STALENESS ──────────────────────────────────────────────────────────────────
 * A COMPLETED analysis becomes stale when the override state fingerprint changes.
 * Staleness is detected at call time via fingerprint comparison.
 * Previous analyses are marked STALE when a new one succeeds.
 * No scattered staleness writes are added to other files.
 *
 * ── AUTHORIZATION ──────────────────────────────────────────────────────────────
 * Two authorized paths:
 *   1. Platform Super Admin (via requirePlatformSuperAdmin)
 *   2. Company Admin (via requireCompanyAdmin) — restricted to their own company's jobs
 *
 * ── CONCURRENCY LIMITATION ─────────────────────────────────────────────────────
 * Base44 has no database-level unique constraints. Concurrent analysis requests
 * for the same (companyJobId, toVersionId) may produce two records before the
 * idempotency key check runs. Application-level deterministic key deduplication
 * reduces but cannot eliminate this window.
 *
 * ── SCHEMA VERSION ─────────────────────────────────────────────────────────────
 * Current schema version: "1.0"
 * Bump when output structure or classification rules change.
 */

import { writePlatformAudit, requirePlatformSuperAdmin, getActiveCompanyMembership } from './platformAuth.ts';
// NOTE: sanitizeStoredOverride not imported — inlined below to avoid cross-module Set iteration issues
import { diffSection, diffMetadata, CHANGE_TYPES, CONFLICT_SUBTYPES } from './versionDiff.ts';

// ── Constants ──────────────────────────────────────────────────────────────────

export const ANALYSIS_SCHEMA_VERSION = '1.0';

const SECTION_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality'] as const;

// ── Compatibility classifications ─────────────────────────────────────────────
export const COMPATIBILITY = {
  SAFE: 'SAFE',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  ORPHANED: 'ORPHANED',
  INVALID: 'INVALID',
  NO_OP: 'NO_OP',
} as const;

// ── Master change types (Edit 5B surface) ─────────────────────────────────────
export const MASTER_CHANGE = {
  UNCHANGED: 'UNCHANGED',
  ADDED: 'ADDED',
  MODIFIED: 'MODIFIED',
  REMOVED: 'REMOVED',
  REORDERED: 'REORDERED',
} as const;

// ── Reason codes ──────────────────────────────────────────────────────────────
export const REASON_CODE = {
  MASTER_UNCHANGED: 'MASTER_UNCHANGED',
  MASTER_FIELD_CHANGED: 'MASTER_FIELD_CHANGED',
  COMPANY_ONLY_FIELD_CHANGE: 'COMPANY_ONLY_FIELD_CHANGE',
  BOTH_CHANGED_SAME_FIELD: 'BOTH_CHANGED_SAME_FIELD',
  TARGET_ITEM_REMOVED: 'TARGET_ITEM_REMOVED',
  TARGET_ITEM_REORDERED: 'TARGET_ITEM_REORDERED',
  STABLE_ID_MATCH: 'STABLE_ID_MATCH',
  MISSING_CURRENT_TARGET: 'MISSING_CURRENT_TARGET',
  MALFORMED_OVERRIDE: 'MALFORMED_OVERRIDE',
  REDUNDANT_OVERRIDE: 'REDUNDANT_OVERRIDE',
  UNSUPPORTED_OVERRIDE_TYPE: 'UNSUPPORTED_OVERRIDE_TYPE',
  MASTER_ADDED_NO_OVERRIDE: 'MASTER_ADDED_NO_OVERRIDE',
  NO_OVERRIDE_EXISTS: 'NO_OVERRIDE_EXISTS',
} as const;

// ── Deterministic override state fingerprint ──────────────────────────────────
// ONE canonical implementation. Computes a stable string from content-affecting
// override fields only. Volatile fields (updatedAt, auditPending, lastModifiedByUserId,
// deterministicKey, mutationKey) are deliberately excluded.
export function computeOverrideStateFingerprint(override: any): string {
  if (!override) return 'no_override';

  // Extract only content-affecting fields
  const payload = {
    revision: override.revision ?? 0,
    overrideData: _canonicalizeOverrideData(override.overrideData),
  };

  // Deterministic hash: stable sort + serialize
  const str = JSON.stringify(payload);
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return `ofp_${Math.abs(h).toString(36)}_${str.length}`;
}

// Canonical serialization of overrideData for fingerprinting.
// Sorts sectionOverrides by sectionType, items within sections by _itemId.
function _canonicalizeOverrideData(overrideData: any): any {
  if (!overrideData || typeof overrideData !== 'object') return null;

  const canonical: any = {};
  if (overrideData.title !== undefined) canonical.title = overrideData.title;
  if (overrideData.shortDescription !== undefined) canonical.shortDescription = overrideData.shortDescription;

  const so = overrideData.sectionOverrides;
  if (so && typeof so === 'object' && !Array.isArray(so)) {
    const sectionKeys = Object.keys(so).sort();
    canonical.sectionOverrides = {};
    for (const key of sectionKeys) {
      const items = Array.isArray(so[key])
        ? [...so[key]].sort((a: any, b: any) => (a._itemId || '').localeCompare(b._itemId || ''))
        : so[key];
      canonical.sectionOverrides[key] = items;
    }
  }

  return canonical;
}

// ── Deterministic analysis key ────────────────────────────────────────────────
// ONE canonical implementation.
export function buildAnalysisKey(
  companyJobId: string,
  fromVersionId: string,
  toVersionId: string,
  overrideStateFingerprint: string,
  schemaVersion: string = ANALYSIS_SCHEMA_VERSION
): string {
  return `VERSION_ANALYSIS:${companyJobId}:${fromVersionId}:${toVersionId}:${overrideStateFingerprint}:${schemaVersion}`;
}

// ── Analysis params ────────────────────────────────────────────────────────────
export interface AnalyzeParams {
  companyJobId: string;
  targetVersionId: string;
  companyVersionDecisionId?: string | null;
}

// ── Analysis result ────────────────────────────────────────────────────────────
export interface AnalysisResult {
  analysisId: string | null;
  analysisKey: string;
  status: string;
  companyId: string;
  companyJobId: string;
  masterId: string;
  fromVersionId: string;
  toVersionId: string;
  companyVersionDecisionId?: string | null;
  masterChangeSummary: {
    additions: number;
    removals: number;
    modifications: number;
    reorders: number;
  };
  overrideCompatibilitySummary: {
    safe: number;
    reviewRequired: number;
    orphaned: number;
    invalid: number;
    noOp: number;
  };
  safeCount: number;
  reviewRequiredCount: number;
  orphanedCount: number;
  invalidCount: number;
  noOpCount: number;
  canAutoAdopt: boolean;
  itemResults: any[];
  errorCode?: string | null;
  errorMessage?: string | null;
  overrideStateFingerprint: string;
  idempotent?: boolean;
}

// ── Authorization helper for analysis ─────────────────────────────────────────
// Accepts Platform Super Admin OR Company Admin for the job's company.
// Returns { actingUserId, actingUserRole, error? }
async function _authorizeAnalysis(base44: any, SR: any, job: any): Promise<{
  actingUserId: string;
  actingUserRole: string;
  error: Response | null;
}> {
  const user = await base44.auth.me().catch(() => null);
  if (!user) {
    return {
      actingUserId: '',
      actingUserRole: '',
      error: Response.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 }),
    };
  }

  // Check platform super admin first
  const platformMemberships = await SR.entities.PlatformMembership.filter({ userId: user.id, status: 'ACTIVE' });
  if (platformMemberships && platformMemberships.length > 0) {
    return { actingUserId: user.id, actingUserRole: 'SUPER_ADMIN', error: null };
  }

  // Check company admin membership for this specific company
  const companyMembership = await getActiveCompanyMembership(base44, user.id, job.companyId);
  if (!companyMembership) {
    return {
      actingUserId: user.id,
      actingUserRole: '',
      error: Response.json({ error: 'Forbidden: not a member of this company', code: 'FORBIDDEN' }, { status: 403 }),
    };
  }
  const role = companyMembership.role;
  const isCompanyAdmin = role === 'general_manager' || role === 'project_manager';
  if (!isCompanyAdmin) {
    return {
      actingUserId: user.id,
      actingUserRole: role,
      error: Response.json({ error: 'Insufficient role: company admin required to perform version analysis', code: 'INSUFFICIENT_ROLE' }, { status: 403 }),
    };
  }

  return { actingUserId: user.id, actingUserRole: role, error: null };
}

// ── Compatibility classification (ONE canonical implementation) ────────────────
// Maps a versionDiff change entry + override state → Edit 5B compatibility.
//
// Three-value comparison (field-level):
//   masterUnchanged && !companyChanged → SAFE (MASTER_UNCHANGED)
//   !masterUnchanged && !companyChanged → SAFE (MASTER_FIELD_CHANGED, no company stake)
//   !masterUnchanged && companyChanged && targetValue === companyValue → SAFE (converge)
//   !masterUnchanged && companyChanged && targetValue !== companyValue → REVIEW_REQUIRED
//   masterRemoved && companyChanged → REVIEW_REQUIRED (MASTER_REMOVED_COMPANY_MODIFIED)
//   masterRemoved && !companyChanged → SAFE (MASTER_FIELD_CHANGED, company not invested)
//   logicalItemMissing (orphaned) → ORPHANED
//
function _classifyChangeEntry(change: any): {
  compatibility: string;
  reasonCode: string;
  reasonMessage: string;
  masterChangeTypes: string[];
  requiresAdminAction: boolean;
  recommendedDefaultAction: string;
} {
  const { changeType, conflictSubtype } = change;

  switch (changeType) {
    case CHANGE_TYPES.MASTER_ADDED:
      // New item in target — no existing override can reference it
      return {
        compatibility: COMPATIBILITY.SAFE,
        reasonCode: REASON_CODE.MASTER_ADDED_NO_OVERRIDE,
        reasonMessage: 'New item added in target version. No existing company override.',
        masterChangeTypes: [MASTER_CHANGE.ADDED],
        requiresAdminAction: false,
        recommendedDefaultAction: 'ACCEPT_NEW_MASTER_CONTENT',
      };

    case CHANGE_TYPES.MASTER_REMOVED:
      if (change.companyValue) {
        // Company had overridden this item but master removed it → ORPHANED
        return {
          compatibility: COMPATIBILITY.ORPHANED,
          reasonCode: REASON_CODE.TARGET_ITEM_REMOVED,
          reasonMessage: 'Master removed this item. Company override targeting it is now orphaned.',
          masterChangeTypes: [MASTER_CHANGE.REMOVED],
          requiresAdminAction: true,
          recommendedDefaultAction: 'DISCARD_ORPHANED_OVERRIDE',
        };
      }
      // Master removed, no company override → SAFE
      return {
        compatibility: COMPATIBILITY.SAFE,
        reasonCode: REASON_CODE.TARGET_ITEM_REMOVED,
        reasonMessage: 'Master removed this item. No company override affected.',
        masterChangeTypes: [MASTER_CHANGE.REMOVED],
        requiresAdminAction: false,
        recommendedDefaultAction: 'ACCEPT_REMOVAL',
      };

    case CHANGE_TYPES.MASTER_MODIFIED:
      // Master changed, company did not override → SAFE
      return {
        compatibility: COMPATIBILITY.SAFE,
        reasonCode: REASON_CODE.MASTER_FIELD_CHANGED,
        reasonMessage: 'Master modified this item. Company has no override for it.',
        masterChangeTypes: [MASTER_CHANGE.MODIFIED],
        requiresAdminAction: false,
        recommendedDefaultAction: 'ACCEPT_MASTER_CHANGE',
      };

    case CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION:
      // Master unchanged, company changed → SAFE
      return {
        compatibility: COMPATIBILITY.SAFE,
        reasonCode: REASON_CODE.COMPANY_ONLY_FIELD_CHANGE,
        reasonMessage: 'Company customized this item. Master did not change it in the target version.',
        masterChangeTypes: [MASTER_CHANGE.UNCHANGED],
        requiresAdminAction: false,
        recommendedDefaultAction: 'PRESERVE_COMPANY_OVERRIDE',
      };

    case CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE:
      // Both changed to same value → SAFE (no-op effectively)
      return {
        compatibility: COMPATIBILITY.SAFE,
        reasonCode: REASON_CODE.REDUNDANT_OVERRIDE,
        reasonMessage: 'Company override and master target value are identical. Override is effectively a no-op.',
        masterChangeTypes: [MASTER_CHANGE.MODIFIED],
        requiresAdminAction: false,
        recommendedDefaultAction: 'PRESERVE_OR_DISCARD',
      };

    case CHANGE_TYPES.CONFLICT:
      if (conflictSubtype === CONFLICT_SUBTYPES.MASTER_REMOVED_COMPANY_MODIFIED) {
        return {
          compatibility: COMPATIBILITY.REVIEW_REQUIRED,
          reasonCode: REASON_CODE.TARGET_ITEM_REMOVED,
          reasonMessage: 'Master removed this item but company has a modified override for it. Admin must decide whether to keep or discard.',
          masterChangeTypes: [MASTER_CHANGE.REMOVED],
          requiresAdminAction: true,
          recommendedDefaultAction: 'REVIEW_BEFORE_ADOPTING',
        };
      }
      // BOTH_MODIFIED_DIFFERENTLY
      return {
        compatibility: COMPATIBILITY.REVIEW_REQUIRED,
        reasonCode: REASON_CODE.BOTH_CHANGED_SAME_FIELD,
        reasonMessage: 'Both master and company modified this item differently. Admin must choose which version to keep.',
        masterChangeTypes: [MASTER_CHANGE.MODIFIED],
        requiresAdminAction: true,
        recommendedDefaultAction: 'REVIEW_BEFORE_ADOPTING',
      };

    default:
      return {
        compatibility: COMPATIBILITY.REVIEW_REQUIRED,
        reasonCode: REASON_CODE.MISSING_CURRENT_TARGET,
        reasonMessage: `Unknown change type: ${changeType}`,
        masterChangeTypes: [],
        requiresAdminAction: true,
        recommendedDefaultAction: 'REVIEW_BEFORE_ADOPTING',
      };
  }
}

// ── Classify a section-level override (has company override for this section) ──
// A section override replaces ALL items in the section.
// We examine the diffSection changes for this section to determine if the
// override is SAFE, REVIEW_REQUIRED, or ORPHANED.
function _classifySectionOverride(
  sectionType: string,
  sectionChanges: any[],
  overrideItems: any[]
): {
  compatibility: string;
  reasonCode: string;
  reasonMessage: string;
  requiresAdminAction: boolean;
} {
  // If no diff changes for this section — section is identical, override is safe
  if (!sectionChanges || sectionChanges.length === 0) {
    return {
      compatibility: COMPATIBILITY.SAFE,
      reasonCode: REASON_CODE.MASTER_UNCHANGED,
      reasonMessage: `Section '${sectionType}' is identical in both versions. Company override can be safely preserved.`,
      requiresAdminAction: false,
    };
  }

  // Check for conflicts or removals affecting company-overridden items
  const hasConflicts = sectionChanges.some(c =>
    c.changeType === CHANGE_TYPES.CONFLICT
  );
  const hasMasterRemovedCompanyModified = sectionChanges.some(c =>
    c.changeType === CHANGE_TYPES.CONFLICT &&
    c.conflictSubtype === CONFLICT_SUBTYPES.MASTER_REMOVED_COMPANY_MODIFIED
  );

  if (hasConflicts) {
    return {
      compatibility: COMPATIBILITY.REVIEW_REQUIRED,
      reasonCode: REASON_CODE.BOTH_CHANGED_SAME_FIELD,
      reasonMessage: `Section '${sectionType}': master changed items that company also overrode. Review required.`,
      requiresAdminAction: true,
    };
  }

  // Master-only changes to items the company overrode — company "wins" the section
  // but master also changed items → REVIEW_REQUIRED (company override masks master change)
  const hasMasterModifiedItems = sectionChanges.some(c =>
    c.changeType === CHANGE_TYPES.MASTER_MODIFIED ||
    c.changeType === CHANGE_TYPES.MASTER_ADDED ||
    c.changeType === CHANGE_TYPES.MASTER_REMOVED
  );

  if (hasMasterModifiedItems) {
    return {
      compatibility: COMPATIBILITY.REVIEW_REQUIRED,
      reasonCode: REASON_CODE.MASTER_FIELD_CHANGED,
      reasonMessage: `Section '${sectionType}': master changed content in this section but company has a full section override. The company override may mask master changes.`,
      requiresAdminAction: true,
    };
  }

  // Only company-only changes — safe
  return {
    compatibility: COMPATIBILITY.SAFE,
    reasonCode: REASON_CODE.COMPANY_ONLY_FIELD_CHANGE,
    reasonMessage: `Section '${sectionType}': company customized this section. Master did not change it in the target version.`,
    requiresAdminAction: false,
  };
}

// ── Validate override structural integrity ─────────────────────────────────────
function _validateOverrideIntegrity(override: any, job: any): {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
} {
  if (!override) return { valid: true }; // No override is valid

  if (!override.companyId || override.companyId !== job.companyId) {
    return { valid: false, errorCode: 'OVERRIDE_COMPANY_MISMATCH', errorMessage: 'Override companyId does not match job companyId.' };
  }
  if (!override.jobId || override.jobId !== job.id) {
    return { valid: false, errorCode: 'OVERRIDE_JOB_MISMATCH', errorMessage: 'Override jobId does not match job id.' };
  }
  if (!override.sourceMasterId || override.sourceMasterId !== job.sourceMasterId) {
    return { valid: false, errorCode: 'OVERRIDE_MASTER_MISMATCH', errorMessage: 'Override sourceMasterId does not match job sourceMasterId.' };
  }

  // overrideData must be an object if present
  if (override.overrideData !== undefined && override.overrideData !== null) {
    if (typeof override.overrideData !== 'object' || Array.isArray(override.overrideData)) {
      return { valid: false, errorCode: 'MALFORMED_OVERRIDE_DATA', errorMessage: 'overrideData is not an object.' };
    }
    // Validate sectionOverrides if present
    const so = override.overrideData.sectionOverrides;
    if (so !== undefined && so !== null) {
      if (typeof so !== 'object' || Array.isArray(so)) {
        return { valid: false, errorCode: 'MALFORMED_SECTION_OVERRIDES', errorMessage: 'sectionOverrides is not an object.' };
      }
      const _validSectionTypes = new Set(['tools', 'materials', 'scope', 'procedure', 'safety', 'quality']);
      for (const [st, items] of Object.entries(so)) {
        if (!_validSectionTypes.has(st)) {
          return { valid: false, errorCode: 'UNSUPPORTED_OVERRIDE_TYPE', errorMessage: `Unknown sectionType '${st}' in sectionOverrides.` };
        }
        if (!Array.isArray(items)) {
          return { valid: false, errorCode: 'MALFORMED_SECTION_OVERRIDES', errorMessage: `sectionOverrides.${st} is not an array.` };
        }
      }
    }
  }

  return { valid: true };
}

// ── Main canonical analysis function ──────────────────────────────────────────
export async function analyzeCompanyJobVersionUpdate(
  base44: any,
  params: AnalyzeParams
): Promise<{ result?: AnalysisResult; error?: Response }> {
  const now = new Date().toISOString();
  const SR = base44.asServiceRole;
  const { companyJobId, targetVersionId, companyVersionDecisionId } = params;

  // ── Input validation ───────────────────────────────────────────────────────
  if (!companyJobId || typeof companyJobId !== 'string') {
    return { error: Response.json({ error: 'companyJobId is required', code: 'INVALID_INPUT' }, { status: 400 }) };
  }
  if (!targetVersionId || typeof targetVersionId !== 'string') {
    return { error: Response.json({ error: 'targetVersionId is required', code: 'INVALID_INPUT' }, { status: 400 }) };
  }

  // ── Load Company Job ───────────────────────────────────────────────────────
  let job: any = null;
  try { job = await SR.entities.Job.get(companyJobId); } catch (_) {}
  if (!job) {
    return { error: Response.json({ error: 'Company Job not found', code: 'JOB_NOT_FOUND' }, { status: 404 }) };
  }

  // ── Authorization ──────────────────────────────────────────────────────────
  const { actingUserId, actingUserRole, error: authError } = await _authorizeAnalysis(base44, SR, job);
  if (authError) return { error: authError };

  // ── Validate job is essential_sop ─────────────────────────────────────────
  if (job.sourceType !== 'essential_sop') {
    return { error: Response.json({ error: 'Version analysis only applies to provisioned Essential SOP Jobs', code: 'NOT_ESSENTIAL_SOP' }, { status: 409 }) };
  }
  if (!job.sourceMasterId) {
    return { error: Response.json({ error: 'Company Job is missing sourceMasterId', code: 'MISSING_MASTER_ID' }, { status: 409 }) };
  }
  if (!job.sourceVersionId) {
    return { error: Response.json({ error: 'Company Job is missing sourceVersionId', code: 'MISSING_VERSION_ID' }, { status: 409 }) };
  }

  const companyId = job.companyId;
  const masterId = job.sourceMasterId;
  const fromVersionId = job.sourceVersionId;

  // ── Validate target version ────────────────────────────────────────────────
  let targetVersion: any = null;
  try { targetVersion = await SR.entities.EssentialSOPVersion.get(targetVersionId); } catch (_) {}
  if (!targetVersion) {
    return { error: Response.json({ error: 'Target version not found', code: 'TARGET_VERSION_NOT_FOUND' }, { status: 404 }) };
  }
  if (targetVersion.masterId !== masterId) {
    return { error: Response.json({ error: 'Target version belongs to a different Master SOP', code: 'VERSION_MASTER_MISMATCH' }, { status: 409 }) };
  }
  if (targetVersion.status !== 'published') {
    return { error: Response.json({ error: 'Target version is not published', code: 'TARGET_VERSION_NOT_PUBLISHED' }, { status: 409 }) };
  }
  if (targetVersionId === fromVersionId) {
    return { error: Response.json({ error: 'Job is already on this version', code: 'ALREADY_CURRENT' }, { status: 409 }) };
  }

  // Validate target is newer than current (by versionNumber)
  let fromVersion: any = null;
  try { fromVersion = await SR.entities.EssentialSOPVersion.get(fromVersionId); } catch (_) {}
  if (!fromVersion || fromVersion.status !== 'published') {
    return { error: Response.json({ error: 'Current (base) version is not available', code: 'BASE_VERSION_UNAVAILABLE' }, { status: 409 }) };
  }
  if (targetVersion.versionNumber <= fromVersion.versionNumber) {
    return { error: Response.json({ error: 'Target version is not newer than the current version', code: 'TARGET_NOT_NEWER' }, { status: 409 }) };
  }

  // ── Validate CompanyVersionDecision if provided ────────────────────────────
  if (companyVersionDecisionId) {
    let decision: any = null;
    try { decision = await SR.entities.CompanyVersionDecision.get(companyVersionDecisionId); } catch (_) {}
    if (!decision) {
      return { error: Response.json({ error: 'CompanyVersionDecision not found', code: 'DECISION_NOT_FOUND' }, { status: 404 }) };
    }
    if (decision.companyId !== companyId || decision.companyJobId !== companyJobId ||
        decision.masterId !== masterId || decision.fromVersionId !== fromVersionId ||
        decision.toVersionId !== targetVersionId) {
      return { error: Response.json({ error: 'CompanyVersionDecision does not match this analysis request', code: 'DECISION_MISMATCH' }, { status: 409 }) };
    }
  }

  // ── Load company override ──────────────────────────────────────────────────
  const overrideRecords = await SR.entities.JobOverride.filter({ companyId, jobId: companyJobId });
  const override: any = overrideRecords?.[0] || null;

  // ── Compute override state fingerprint ────────────────────────────────────
  let overrideStateFingerprint: string;
  try {
    overrideStateFingerprint = computeOverrideStateFingerprint(override);
  } catch (fpErr: any) {
    return { error: Response.json({ error: `Fingerprint failed: ${fpErr.message}`, code: 'FINGERPRINT_ERROR' }, { status: 500 }) };
  }

  // ── Build analysis key ─────────────────────────────────────────────────────
  const analysisKey = buildAnalysisKey(companyJobId, fromVersionId, targetVersionId, overrideStateFingerprint);

  // ── Idempotency: check for existing COMPLETED analysis ────────────────────
  let existingAnalyses: any[] = [];
  try {
    existingAnalyses = await SR.entities.CompanyVersionAnalysis.filter(
      { companyJobId, fromVersionId, toVersionId: targetVersionId },
      '-createdAt',
      20
    ) || [];
  } catch (_) {}

  const existingCompleted = existingAnalyses.find(a =>
    a.analysisKey === analysisKey &&
    a.status === 'COMPLETED' &&
    a.analysisSchemaVersion === ANALYSIS_SCHEMA_VERSION
  );

  if (existingCompleted) {
    // Idempotent return
    await writePlatformAudit(SR, {
      actingUserId,
      actingUserRole: actingUserRole || 'UNKNOWN',
      action: 'version_analysis_reused',
      extra: {
        companyId, companyJobId, masterId, fromVersionId, toVersionId: targetVersionId,
        companyVersionDecisionId: companyVersionDecisionId || null,
        analysisId: existingCompleted.id,
        analysisKey,
        safeCount: existingCompleted.safeCount,
        reviewRequiredCount: existingCompleted.reviewRequiredCount,
        orphanedCount: existingCompleted.orphanedCount,
        invalidCount: existingCompleted.invalidCount,
        canAutoAdopt: existingCompleted.canAutoAdopt,
        metadata: { idempotent: true },
      },
    });

    return {
      result: {
        analysisId: existingCompleted.id,
        analysisKey,
        status: 'COMPLETED',
        companyId,
        companyJobId,
        masterId,
        fromVersionId,
        toVersionId: targetVersionId,
        companyVersionDecisionId: companyVersionDecisionId || null,
        masterChangeSummary: existingCompleted.masterChangeSummary || { additions: 0, removals: 0, modifications: 0, reorders: 0 },
        overrideCompatibilitySummary: existingCompleted.overrideCompatibilitySummary || { safe: 0, reviewRequired: 0, orphaned: 0, invalid: 0, noOp: 0 },
        safeCount: existingCompleted.safeCount ?? 0,
        reviewRequiredCount: existingCompleted.reviewRequiredCount ?? 0,
        orphanedCount: existingCompleted.orphanedCount ?? 0,
        invalidCount: existingCompleted.invalidCount ?? 0,
        noOpCount: existingCompleted.noOpCount ?? 0,
        canAutoAdopt: existingCompleted.canAutoAdopt ?? false,
        itemResults: existingCompleted.itemResults || [],
        overrideStateFingerprint,
        idempotent: true,
      },
    };
  }

  // ── Create PENDING analysis record ─────────────────────────────────────────
  let analysisRecord: any = null;
  try {
    analysisRecord = await SR.entities.CompanyVersionAnalysis.create({
      companyId, companyJobId, masterId,
      fromVersionId, toVersionId: targetVersionId,
      companyVersionDecisionId: companyVersionDecisionId || null,
      analysisKey,
      analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
      status: 'ANALYZING',
      overrideStateFingerprint,
      safeCount: 0, reviewRequiredCount: 0, orphanedCount: 0, invalidCount: 0, noOpCount: 0,
      canAutoAdopt: false,
      itemResults: [],
      requestedByUserId: actingUserId,
      requestedByRole: actingUserRole,
      createdAt: now,
      updatedAt: now,
    });
  } catch (createErr: any) {
    return { error: Response.json({ error: 'Failed to initialize analysis record', code: 'ANALYSIS_CREATE_FAILED' }, { status: 500 }) };
  }

  // ── Audit: started ─────────────────────────────────────────────────────────
  try {
    await writePlatformAudit(SR, {
      actingUserId,
      actingUserRole: actingUserRole || 'UNKNOWN',
      action: 'version_analysis_started',
      extra: {
        companyId, companyJobId, masterId, fromVersionId, toVersionId: targetVersionId,
        companyVersionDecisionId: companyVersionDecisionId || null,
        analysisId: analysisRecord.id, analysisKey,
        metadata: { overrideStateFingerprint },
      },
    });
  } catch (_) {}

  // ── Run the analysis pipeline ──────────────────────────────────────────────
  try {
    const analysisResult = await _runAnalysisPipeline({
      SR, job, override, fromVersion, targetVersion,
      masterId, companyId, companyJobId, fromVersionId, targetVersionId,
      analysisKey, companyVersionDecisionId,
      actingUserId, actingUserRole, now,
    });

    // ── Persist result ─────────────────────────────────────────────────────
    const completedAt = new Date().toISOString();
    try {
      await SR.entities.CompanyVersionAnalysis.update(analysisRecord.id, {
        status: 'COMPLETED',
        masterChangeSummary: analysisResult.masterChangeSummary,
        overrideCompatibilitySummary: analysisResult.overrideCompatibilitySummary,
        safeCount: analysisResult.safeCount,
        reviewRequiredCount: analysisResult.reviewRequiredCount,
        orphanedCount: analysisResult.orphanedCount,
        invalidCount: analysisResult.invalidCount,
        noOpCount: analysisResult.noOpCount,
        canAutoAdopt: analysisResult.canAutoAdopt,
        itemResults: analysisResult.itemResults,
        completedAt,
        updatedAt: completedAt,
      });
    } catch (_) {}

    // ── Mark older completed analyses for this job as STALE ────────────────
    for (const older of existingAnalyses) {
      if (older.id !== analysisRecord.id && older.status === 'COMPLETED') {
        try {
          await SR.entities.CompanyVersionAnalysis.update(older.id, {
            status: 'STALE', updatedAt: completedAt,
          });
          await writePlatformAudit(SR, {
            actingUserId,
            actingUserRole: actingUserRole || 'UNKNOWN',
            action: 'version_analysis_marked_stale',
            extra: {
              companyId, companyJobId, masterId, fromVersionId, toVersionId: targetVersionId,
              analysisId: older.id,
              supersededByAnalysisId: analysisRecord.id,
              metadata: {},
            },
          });
        } catch (_) {}
      }
    }

    // ── Audit: completed ───────────────────────────────────────────────────
    try {
      await writePlatformAudit(SR, {
        actingUserId,
        actingUserRole: actingUserRole || 'UNKNOWN',
        action: 'version_analysis_completed',
        extra: {
          companyId, companyJobId, masterId, fromVersionId, toVersionId: targetVersionId,
          companyVersionDecisionId: companyVersionDecisionId || null,
          analysisId: analysisRecord.id, analysisKey,
          safeCount: analysisResult.safeCount,
          reviewRequiredCount: analysisResult.reviewRequiredCount,
          orphanedCount: analysisResult.orphanedCount,
          invalidCount: analysisResult.invalidCount,
          canAutoAdopt: analysisResult.canAutoAdopt,
          metadata: { overrideStateFingerprint },
        },
      });
    } catch (_) {}

    return {
      result: {
        ...analysisResult,
        analysisId: analysisRecord.id,
        analysisKey,
        status: 'COMPLETED',
        overrideStateFingerprint,
        idempotent: false,
      },
    };

  } catch (pipelineErr: any) {
    // ── Analysis failed ────────────────────────────────────────────────────
    const failedAt = new Date().toISOString();
    const errorCode = pipelineErr.code || 'ANALYSIS_PIPELINE_FAILED';
    const errorMessage = pipelineErr.message || 'Analysis pipeline encountered an unexpected error.';

    try {
      await SR.entities.CompanyVersionAnalysis.update(analysisRecord.id, {
        status: 'FAILED',
        errorCode,
        errorMessage,
        completedAt: failedAt,
        updatedAt: failedAt,
      });
    } catch (_) {}

    try {
      await writePlatformAudit(SR, {
        actingUserId,
        actingUserRole: actingUserRole || 'UNKNOWN',
        action: 'version_analysis_failed',
        extra: {
          companyId, companyJobId, masterId, fromVersionId, toVersionId: targetVersionId,
          analysisId: analysisRecord.id, analysisKey,
          metadata: { errorCode, errorMessage },
        },
      });
    } catch (_) {}

    return {
      error: Response.json({
        error: 'Analysis pipeline failed',
        code: errorCode,
        detail: errorMessage,
        analysisId: analysisRecord.id,
      }, { status: 500 }),
    };
  }
}

// ── Internal: run the full analysis pipeline ──────────────────────────────────
async function _runAnalysisPipeline(params: {
  SR: any;
  job: any;
  override: any;
  fromVersion: any;
  targetVersion: any;
  masterId: string;
  companyId: string;
  companyJobId: string;
  fromVersionId: string;
  targetVersionId: string;
  analysisKey: string;
  companyVersionDecisionId?: string | null;
  actingUserId: string;
  actingUserRole: string;
  now: string;
}): Promise<Omit<AnalysisResult, 'analysisId' | 'analysisKey' | 'status' | 'overrideStateFingerprint' | 'idempotent'>> {
  const {
    SR, job, override, fromVersion, targetVersion,
    masterId, companyId, companyJobId, fromVersionId, targetVersionId,
    companyVersionDecisionId,
  } = params;

  // ── Step 1: Validate override structural integrity ─────────────────────────
  const overrideIntegrity = _validateOverrideIntegrity(override, job);
  // Store integrity result for later — invalid override is classified but doesn't crash the pipeline

  // ── Step 2: Sanitize override data (inlined — avoids cross-module Set issues) ─
  let sanitizedOverrideData: any = null;
  if (override?.overrideData && typeof override.overrideData === 'object' &&
      !Array.isArray(override.overrideData) && overrideIntegrity.valid) {
    try {
      const raw = override.overrideData;
      const san: any = {};
      if (typeof raw.title === 'string' && raw.title.trim()) san.title = raw.title.trim();
      if (typeof raw.shortDescription === 'string') san.shortDescription = raw.shortDescription;
      const validST = ['tools','materials','scope','procedure','safety','quality'];
      if (raw.sectionOverrides && typeof raw.sectionOverrides === 'object' && !Array.isArray(raw.sectionOverrides)) {
        const cleanSections: any = {};
        const soEntries = Object.keys(raw.sectionOverrides);
        for (const st of soEntries) {
          if (!validST.includes(st)) continue;
          const items = raw.sectionOverrides[st];
          if (!Array.isArray(items)) continue;
          const allowedItemFields = ['contentType','title','body','sortOrder','isRequired','isCritical','metadata','_itemId'];
          const cleanItems = items.map((item: any) => {
            const ci: any = {};
            for (const k of Object.keys(item)) {
              if (allowedItemFields.includes(k)) ci[k] = item[k];
            }
            return ci;
          });
          cleanSections[st] = cleanItems;
        }
        if (Object.keys(cleanSections).length > 0) san.sectionOverrides = cleanSections;
      }
      sanitizedOverrideData = san;
    } catch (sanErr: any) {
      sanitizedOverrideData = null; // fallback — treat as no override
    }
  }

  // ── Step 3: Load BASE and TARGET sections in parallel ─────────────────────
  let baseSections: any[] = [], targetSections: any[] = [];
  try {
    [baseSections, targetSections] = await Promise.all([
      SR.entities.EssentialSOPSection.filter({ masterId, versionId: fromVersionId }, 'sortOrder', 10),
      SR.entities.EssentialSOPSection.filter({ masterId, versionId: targetVersionId }, 'sortOrder', 10),
    ]);
    baseSections = baseSections || [];
    targetSections = targetSections || [];
  } catch (secErr: any) {
    throw new Error(`STEP3_SECTION_LOAD_FAILED: ${secErr.message}`);
  }

  // ── Step 4: Load master record for metadata comparison ────────────────────
  let masterRecord: any = null;
  try { masterRecord = await SR.entities.EssentialSOPMaster.get(masterId); } catch (_) {}

  // ── Step 5: Run three-way diff via existing canonical versionDiff engine ──
  const changesBySection: Record<string, any[]> = {};
  let _step5Section = 'init';

  for (const st of SECTION_ORDER) {
    const baseSection = (baseSections || []).find((s: any) => s.sectionType === st);
    const targetSection = (targetSections || []).find((s: any) => s.sectionType === st);
    const companyItems = sanitizedOverrideData?.sectionOverrides?.[st] ?? null;
    const baseItems = baseSection?.contentItems || [];
    const targetItems = targetSection?.contentItems || [];
    const baseSectionId = baseSection?.id || `missing_${st}`;
    const targetSectionId = targetSection?.id || `missing_${st}`;

    _step5Section = st;
    const changes = diffSection(st, baseSectionId, targetSectionId, baseItems, targetItems, companyItems);
    if (changes.length > 0) changesBySection[st] = changes;
  }

  // Metadata diff
  const baseTitle = job.title || '';
  const targetTitle = masterRecord?.title || job.title || '';
  const baseDesc = job.shortDescription || '';
  const targetDesc = baseDesc; // shortDescription not tracked per-version on master
  const companyTitle = sanitizedOverrideData?.title || null;
  const companyDesc = sanitizedOverrideData?.shortDescription || null;
  let metadataChanges: any[] = [];
  try {
    metadataChanges = diffMetadata(baseTitle, targetTitle, baseDesc, targetDesc, companyTitle, companyDesc) || [];
  } catch (mdErr: any) {
    throw new Error(`STEP5_METADATA_DIFF_FAILED after section=${_step5Section}: ${mdErr.message}`);
  }
  if (metadataChanges.length > 0) changesBySection['metadata'] = metadataChanges;

  // ── Step 6: Master change summary ─────────────────────────────────────────
  let masterAdditions = 0, masterRemovals = 0, masterModifications = 0, masterReorders = 0;
  for (const changes of Object.values(changesBySection)) {
    for (const c of changes) {
      if (c.changeType === CHANGE_TYPES.MASTER_ADDED) masterAdditions++;
      else if (c.changeType === CHANGE_TYPES.MASTER_REMOVED) masterRemovals++;
      else if (c.changeType === CHANGE_TYPES.MASTER_MODIFIED) masterModifications++;
      else if (c.changeType === CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE) masterModifications++;
      else if (c.changeType === CHANGE_TYPES.CONFLICT) masterModifications++;
    }
  }

  // ── Step 7: Per-item analysis results ─────────────────────────────────────
  const itemResults: any[] = [];

  // If override is structurally INVALID — classify the whole override as invalid
  if (override && !overrideIntegrity.valid) {
    itemResults.push({
      logicalItemId: `override_record_${override.id || 'unknown'}`,
      currentItemId: override.id || null,
      targetItemId: null,
      parentLogicalItemId: null,
      itemType: 'override_record',
      masterChangeTypes: [],
      overrideId: override.id || null,
      overriddenFields: [],
      compatibility: COMPATIBILITY.INVALID,
      reasonCode: overrideIntegrity.errorCode || 'MALFORMED_OVERRIDE',
      reasonMessage: overrideIntegrity.errorMessage || 'Override record is malformed.',
      currentMasterValues: {},
      companyOverrideValues: {},
      targetMasterValues: {},
      requiresAdminAction: true,
      recommendedDefaultAction: 'FIX_OR_DISCARD_OVERRIDE',
    });
  } else {
    // ── Process diff change entries → per-item results ─────────────────────
    for (const [sectionType, changes] of Object.entries(changesBySection)) {
      if (sectionType === 'metadata') {
        // Handle metadata overrides (title / shortDescription)
        for (const change of changes) {
          const classification = _classifyChangeEntry(change);
          const isNoOp = change.changeType === CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE;
          itemResults.push({
            logicalItemId: `metadata_${change.fieldPath || change.changeId}`,
            currentItemId: null,
            targetItemId: null,
            parentLogicalItemId: null,
            itemType: 'metadata_field',
            masterChangeTypes: classification.masterChangeTypes,
            overrideId: override?.id || null,
            overriddenFields: [change.fieldPath || sectionType],
            compatibility: isNoOp ? COMPATIBILITY.NO_OP : classification.compatibility,
            reasonCode: isNoOp ? REASON_CODE.REDUNDANT_OVERRIDE : classification.reasonCode,
            reasonMessage: isNoOp
              ? 'Override value matches target master value — effectively a no-op.'
              : classification.reasonMessage,
            currentMasterValues: { [change.fieldPath || 'field']: change.baseValue },
            companyOverrideValues: change.companyValue !== null && change.companyValue !== undefined
              ? { [change.fieldPath || 'field']: change.companyValue }
              : {},
            targetMasterValues: { [change.fieldPath || 'field']: change.targetValue },
            requiresAdminAction: isNoOp ? false : classification.requiresAdminAction,
            recommendedDefaultAction: isNoOp ? 'PRESERVE_OR_DISCARD' : classification.recommendedDefaultAction,
          });
        }
        continue;
      }

      // Section changes
      for (const change of changes) {
        const hasCompanyOverride = change.companyValue !== null && change.companyValue !== undefined ||
          change.changeType === CHANGE_TYPES.COMPANY_ONLY_CUSTOMIZATION;

        // Only emit items with a company override component OR master changes affecting all consumers
        const classification = _classifyChangeEntry(change);
        const isNoOp = change.changeType === CHANGE_TYPES.AUTOMATICALLY_COMPATIBLE;

        itemResults.push({
          logicalItemId: change.changeId,
          currentItemId: change.baseItemId || null,
          targetItemId: change.targetItemId || null,
          parentLogicalItemId: sectionType,
          itemType: 'section_content_item',
          masterChangeTypes: classification.masterChangeTypes,
          overrideId: hasCompanyOverride ? (override?.id || null) : null,
          overriddenFields: hasCompanyOverride ? ['contentItem'] : [],
          compatibility: isNoOp ? COMPATIBILITY.NO_OP : classification.compatibility,
          reasonCode: isNoOp ? REASON_CODE.REDUNDANT_OVERRIDE : classification.reasonCode,
          reasonMessage: isNoOp
            ? 'Override value matches target master value — effectively a no-op.'
            : classification.reasonMessage,
          currentMasterValues: change.baseValue ? { item: change.baseValue } : {},
          companyOverrideValues: change.companyValue ? { item: change.companyValue } : {},
          targetMasterValues: change.targetValue ? { item: change.targetValue } : {},
          requiresAdminAction: isNoOp ? false : classification.requiresAdminAction,
          recommendedDefaultAction: isNoOp ? 'PRESERVE_OR_DISCARD' : classification.recommendedDefaultAction,
        });
      }
    }

    // ── Section-level override summary items (for sections with company overrides) ──
    // When a company has overridden an entire section, we emit a section-level result
    // in addition to per-item results.
    const _validST = new Set(['tools', 'materials', 'scope', 'procedure', 'safety', 'quality']);
    const sectionOverridesMap = sanitizedOverrideData?.sectionOverrides || {};
    if (Object.keys(sectionOverridesMap).length > 0) {
      for (const [st, overrideItems] of Object.entries(sectionOverridesMap as Record<string, any[]>)) {
        if (!_validST.has(st)) {
          // Unsupported section type in override → INVALID
          itemResults.push({
            logicalItemId: `section_override_${st}`,
            currentItemId: null, targetItemId: null, parentLogicalItemId: st,
            itemType: 'section_override',
            masterChangeTypes: [],
            overrideId: override?.id || null,
            overriddenFields: [`section:${st}`],
            compatibility: COMPATIBILITY.INVALID,
            reasonCode: REASON_CODE.UNSUPPORTED_OVERRIDE_TYPE,
            reasonMessage: `Section type '${st}' is not a supported override target.`,
            currentMasterValues: {}, companyOverrideValues: {}, targetMasterValues: {},
            requiresAdminAction: true,
            recommendedDefaultAction: 'REMOVE_UNSUPPORTED_OVERRIDE',
          });
        }
      }
    }

    // ── Metadata field overrides not captured in diff (no master change) ───
    if (sanitizedOverrideData?.title && !changesBySection['metadata']?.find(c => c.fieldPath === 'title')) {
      // Title override exists but master title didn't change → SAFE
      itemResults.push({
        logicalItemId: 'metadata_title_no_master_change',
        currentItemId: null, targetItemId: null, parentLogicalItemId: null,
        itemType: 'metadata_field',
        masterChangeTypes: [MASTER_CHANGE.UNCHANGED],
        overrideId: override?.id || null,
        overriddenFields: ['title'],
        compatibility: COMPATIBILITY.SAFE,
        reasonCode: REASON_CODE.COMPANY_ONLY_FIELD_CHANGE,
        reasonMessage: 'Company has a title override. Master title did not change between versions.',
        currentMasterValues: { title: job.title },
        companyOverrideValues: { title: sanitizedOverrideData.title },
        targetMasterValues: { title: job.title },
        requiresAdminAction: false,
        recommendedDefaultAction: 'PRESERVE_COMPANY_OVERRIDE',
      });
    }
    if (sanitizedOverrideData?.shortDescription && !changesBySection['metadata']?.find(c => c.fieldPath === 'shortDescription')) {
      itemResults.push({
        logicalItemId: 'metadata_shortDescription_no_master_change',
        currentItemId: null, targetItemId: null, parentLogicalItemId: null,
        itemType: 'metadata_field',
        masterChangeTypes: [MASTER_CHANGE.UNCHANGED],
        overrideId: override?.id || null,
        overriddenFields: ['shortDescription'],
        compatibility: COMPATIBILITY.SAFE,
        reasonCode: REASON_CODE.COMPANY_ONLY_FIELD_CHANGE,
        reasonMessage: 'Company has a shortDescription override. Master shortDescription did not change between versions.',
        currentMasterValues: { shortDescription: job.shortDescription },
        companyOverrideValues: { shortDescription: sanitizedOverrideData.shortDescription },
        targetMasterValues: { shortDescription: job.shortDescription },
        requiresAdminAction: false,
        recommendedDefaultAction: 'PRESERVE_COMPANY_OVERRIDE',
      });
    }
  }

  // ── Step 8: Count classifications ─────────────────────────────────────────
  let safeCount = 0, reviewRequiredCount = 0, orphanedCount = 0, invalidCount = 0, noOpCount = 0;

  for (const item of itemResults) {
    // Only count items that actually have an override (company stake)
    if (!item.overrideId && item.masterChangeTypes.length > 0 &&
        !item.overriddenFields.length) continue;
    // Still count all items that have a classification
    switch (item.compatibility) {
      case COMPATIBILITY.SAFE: safeCount++; break;
      case COMPATIBILITY.REVIEW_REQUIRED: reviewRequiredCount++; break;
      case COMPATIBILITY.ORPHANED: orphanedCount++; break;
      case COMPATIBILITY.INVALID: invalidCount++; break;
      case COMPATIBILITY.NO_OP: noOpCount++; break;
    }
  }

  // ── Step 9: Determine canAutoAdopt ────────────────────────────────────────
  const canAutoAdopt = (
    invalidCount === 0 &&
    orphanedCount === 0 &&
    reviewRequiredCount === 0
  );

  // ── Step 10: Build summaries ───────────────────────────────────────────────
  const masterChangeSummary = {
    additions: masterAdditions,
    removals: masterRemovals,
    modifications: masterModifications,
    reorders: masterReorders,
  };
  const overrideCompatibilitySummary = {
    safe: safeCount,
    reviewRequired: reviewRequiredCount,
    orphaned: orphanedCount,
    invalid: invalidCount,
    noOp: noOpCount,
  };

  return {
    companyId,
    companyJobId,
    masterId,
    fromVersionId,
    toVersionId: targetVersionId,
    companyVersionDecisionId: companyVersionDecisionId || null,
    masterChangeSummary,
    overrideCompatibilitySummary,
    safeCount,
    reviewRequiredCount,
    orphanedCount,
    invalidCount,
    noOpCount,
    canAutoAdopt,
    itemResults,
  };
}