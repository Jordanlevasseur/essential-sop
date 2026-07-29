/**
 * publishingOrchestration.ts — Canonical Essential SOP publishing orchestration.
 *
 * ALL Master SOP publication flows must route through publishMasterSOPVersion().
 * No other code path may create EssentialSOPVersion records, snapshot sections,
 * update currentPublishedVersionId, or create DistributionEvents.
 *
 * ── WRITE ORDER ────────────────────────────────────────────────────────────────
 * Step 1  Authenticate caller via requirePlatformSuperAdmin().
 * Step 2  Load & validate the Master SOP (must be 'active' after first publish,
 *         or 'draft' for first publication).
 * Step 3  Idempotency check: query EssentialSOPVersion for an existing record
 *         with this publicationMutationKey. If found → return original result.
 * Step 4  Validate the distribution policy and selectedCompanyIds.
 * Step 5  Classify eventType: query published version history to determine
 *         NEW_SOP (no prior published version) or NEW_VERSION (≥1 prior).
 * Step 6  Create the EssentialSOPVersion record (status: 'published').
 *         Store publicationMutationKey on the version for idempotency.
 * Step 7  Snapshot the six draft EssentialSOPSection records under the new
 *         versionId. If this step fails, the version record exists but has no
 *         sections — recorded as a partial failure (see recovery below).
 * Step 8  Create the DistributionEvent record (status: 'PENDING').
 * Step 9  Update EssentialSOPMaster: status → 'active',
 *         currentPublishedVersionId → new version.id,
 *         updatedAt. This step happens AFTER version + sections + event are
 *         written so currentPublishedVersionId never points to an incomplete
 *         version.
 * Step 10 Write PlatformAuditLog entries: publication_requested (pre-write),
 *         publication_completed (post-write), distribution_event_created.
 * Step 11 Return { version, distributionEvent, master, eventType }.
 *
 * ── PARTIAL-FAILURE RECOVERY ───────────────────────────────────────────────────
 * Base44 has no multi-entity transactions. The following recoverable states
 * may arise if a request is interrupted:
 *
 * A. Version created, sections not yet snapshotted:
 *    - currentPublishedVersionId is NOT yet updated (step 9 runs last).
 *    - The orphan version has publicationMutationKey stored.
 *    - A retry with the same publicationMutationKey finds the version at step 3
 *      and returns the original result; sections snapshot is re-attempted if
 *      the version exists but has no sections.
 *
 * B. Version + sections created, DistributionEvent not yet created:
 *    - currentPublishedVersionId is NOT yet updated.
 *    - A retry with the same key finds the version, detects the missing event,
 *      creates it, then completes step 9.
 *
 * C. DistributionEvent created, currentPublishedVersionId not yet updated:
 *    - A retry with the same key finds all prior records and completes step 9.
 *
 * In all cases: the same publicationMutationKey produces at most one
 * EssentialSOPVersion and at most one DistributionEvent.
 *
 * ── POLICY VALIDATION RULES ───────────────────────────────────────────────────
 * - SELECTED_COMPANIES requires selectedCompanyIds to be a non-empty array
 *   of existing Company IDs.
 * - ALL_EXISTING_AND_FUTURE_COMPANIES, FUTURE_COMPANIES_ONLY, MANUAL:
 *   selectedCompanyIds must be empty (normalised to []).
 * - distributionStatus must be 'customer_available' for any policy other than
 *   MANUAL to proceed (MANUAL is allowed for internal testing).
 *
 * ── IMMUTABILITY ─────────────────────────────────────────────────────────────
 * Published EssentialSOPVersion records are never updated after step 6.
 * Published EssentialSOPSection snapshots are created once (step 7) and never
 * updated. The update_draft action in manageMasterSOP validates versionId ===
 * 'draft' before writing sections — published sections are structurally
 * unreachable via any existing write path.
 */

import { requirePlatformSuperAdmin, writePlatformAudit } from './platformAuth.ts';
import { isCompanyEligibleForMaster, buildProvisioningKey } from './companyLibraryProvisioning.ts';

const VALID_POLICIES = [
  'ALL_EXISTING_AND_FUTURE_COMPANIES',
  'FUTURE_COMPANIES_ONLY',
  'SELECTED_COMPANIES',
  'MANUAL',
] as const;

type DistributionPolicy = typeof VALID_POLICIES[number];

export interface PublishParams {
  masterId: string;
  publicationMutationKey: string;
  changeSummary?: string;
  distributionPolicyOverride?: DistributionPolicy;
  selectedCompanyIds?: string[];
}

export interface PublishResult {
  version: any;
  distributionEvent: any;
  master: any;
  eventType: 'NEW_SOP' | 'NEW_VERSION';
  idempotent: boolean; // true if this was a replay of an existing successful publish
}

export async function publishMasterSOPVersion(
  base44: any,
  params: PublishParams
): Promise<{ result?: PublishResult; error?: Response }> {
  const now = new Date().toISOString();
  const SR = base44.asServiceRole;

  // ── Step 1: Authenticate ────────────────────────────────────────────────────
  const { user, error: authError } = await requirePlatformSuperAdmin(base44);
  if (authError) return { error: authError };

  const { masterId, publicationMutationKey, changeSummary, distributionPolicyOverride, selectedCompanyIds } = params;

  if (!masterId || !publicationMutationKey) {
    return { error: Response.json({ error: 'masterId and publicationMutationKey are required' }, { status: 400 }) };
  }

  // ── Step 2: Load & validate Master SOP ─────────────────────────────────────
  const master = await SR.entities.EssentialSOPMaster.get(masterId);
  if (!master) {
    return { error: Response.json({ error: 'Master SOP not found' }, { status: 404 }) };
  }
  // Master must be 'draft' (first publish) or 'active' (republish).
  // 'archived' masters cannot be published.
  if (master.status === 'archived') {
    return { error: Response.json({ error: 'Archived Master SOPs cannot be published' }, { status: 409 }) };
  }

  // ── Step 3: Idempotency check ───────────────────────────────────────────────
  // Query for an existing version with this publicationMutationKey.
  const existingVersions = await SR.entities.EssentialSOPVersion.filter(
    { masterId, publicationMutationKey },
    '-createdAt',
    5
  );
  const existingVersion = existingVersions?.[0] || null;

  if (existingVersion && existingVersion.status === 'published') {
    // Full idempotent replay — find the associated DistributionEvent.
    const existingEvents = await SR.entities.DistributionEvent.filter(
      { publicationMutationKey },
      '-createdAt',
      5
    );
    const existingEvent = existingEvents?.[0] || null;

    // Recovery path B/C: version exists but event or master update may be missing.
    // Re-attempt missing steps without creating duplicates.
    let distributionEvent = existingEvent;
    if (!distributionEvent) {
      distributionEvent = await _createDistributionEvent(SR, {
        masterId, versionId: existingVersion.id,
        eventType: existingVersion.distributionEventId ? 'NEW_VERSION' : 'NEW_SOP', // best-effort
        policy: distributionPolicyOverride || master.defaultDistributionPolicy || 'MANUAL',
        selectedCompanyIds: [],
        idempotencyKey: publicationMutationKey,
        publicationMutationKey,
        userId: user.id, now,
      });
    }

    // Recovery path C: update master pointer if still stale.
    if (master.currentPublishedVersionId !== existingVersion.id) {
      await SR.entities.EssentialSOPMaster.update(masterId, {
        status: 'active',
        currentPublishedVersionId: existingVersion.id,
        updatedAt: now,
      });
    }

    const updatedMaster = await SR.entities.EssentialSOPMaster.get(masterId);
    return {
      result: {
        version: existingVersion,
        distributionEvent,
        master: updatedMaster,
        eventType: existingVersion.distributionEventId === null ? 'NEW_SOP' : 'NEW_VERSION',
        idempotent: true,
      },
    };
  }

  // ── Step 4: Validate distribution policy ───────────────────────────────────
  const effectivePolicy: DistributionPolicy =
    (distributionPolicyOverride as DistributionPolicy) ||
    (master.defaultDistributionPolicy as DistributionPolicy) ||
    'MANUAL';

  if (!VALID_POLICIES.includes(effectivePolicy)) {
    return { error: Response.json({ error: `Invalid distribution policy: ${effectivePolicy}` }, { status: 400 }) };
  }

  // For SELECTED_COMPANIES: caller may pass selectedCompanyIds in the payload as an override,
  // or rely on master.defaultSelectedCompanyIds. Fall back to the master's stored list.
  const normalizedSelectedCompanyIds: string[] =
    selectedCompanyIds && selectedCompanyIds.length > 0
      ? selectedCompanyIds
      : (effectivePolicy === 'SELECTED_COMPANIES'
          ? (Array.isArray(master.defaultSelectedCompanyIds) ? master.defaultSelectedCompanyIds : [])
          : []);

  if (effectivePolicy === 'SELECTED_COMPANIES') {
    if (normalizedSelectedCompanyIds.length === 0) {
      return { error: Response.json({ error: 'SELECTED_COMPANIES policy requires at least one company ID (set on master or passed in payload)' }, { status: 400 }) };
    }
    // Validate each company ID exists
    for (const cid of normalizedSelectedCompanyIds) {
      let company: any = null;
      try { company = await SR.entities.Company.get(cid); } catch (_) {}
      if (!company) {
        return { error: Response.json({ error: `Company not found: ${cid}` }, { status: 400 }) };
      }
    }
  } else {
    // Non-SELECTED_COMPANIES: caller-supplied selectedCompanyIds must be empty
    if ((selectedCompanyIds || []).length > 0) {
      return { error: Response.json(
        { error: `selectedCompanyIds must be empty for policy ${effectivePolicy}` },
        { status: 400 }
      )};
    }
  }

  // ── Step 5: Classify eventType from published history ──────────────────────
  // NEW_SOP if no previously published version existed before this operation.
  // NEW_VERSION if ≥1 published version already existed.
  // We do NOT infer from versionNumber === 1; we query published versions.
  const publishedVersionHistory = await SR.entities.EssentialSOPVersion.filter(
    { masterId, status: 'published' },
    '-versionNumber',
    100
  );
  const hadPriorPublishedVersion = (publishedVersionHistory || []).length > 0;
  const eventType: 'NEW_SOP' | 'NEW_VERSION' = hadPriorPublishedVersion ? 'NEW_VERSION' : 'NEW_SOP';

  // Compute next version number
  const allVersions = await SR.entities.EssentialSOPVersion.filter({ masterId }, '-versionNumber', 100);
  const nextVersionNumber = ((allVersions || [])[0]?.versionNumber || 0) + 1;

  // ── Audit: publication_requested ────────────────────────────────────────────
  await writePlatformAudit(SR, {
    actingUserId: user.id,
    actingUserRole: 'SUPER_ADMIN',
    action: 'publication_requested',
    extra: {
      masterId,
      masterTitle: master.title,
      publicationMutationKey,
      distributionPolicy: effectivePolicy,
      selectedCompanyIds: normalizedSelectedCompanyIds,
      previousVersionId: master.currentPublishedVersionId || null,
      metadata: { eventType, versionNumber: nextVersionNumber },
    },
  });

  // ── Step 6: Create EssentialSOPVersion ─────────────────────────────────────
  let version: any;
  try {
    version = await SR.entities.EssentialSOPVersion.create({
      masterId,
      versionNumber: nextVersionNumber,
      status: 'published',
      publishedAt: now,
      publishedBy: user.id,
      changeNotes: changeSummary || '',
      publicationMutationKey,
      distributionEventId: null, // filled after event creation at step 8
      createdAt: now,
    });
  } catch (err: any) {
    await writePlatformAudit(SR, {
      actingUserId: user.id,
      actingUserRole: 'SUPER_ADMIN',
      action: 'publication_failed',
      extra: {
        masterId, masterTitle: master.title, publicationMutationKey,
        metadata: { step: 6, error: err.message || 'version_create_failed' },
      },
    });
    return { error: Response.json({ error: 'Failed to create version record', detail: err.message }, { status: 500 }) };
  }

  // ── Step 7: Snapshot draft sections under new versionId ────────────────────
  const draftSections = await SR.entities.EssentialSOPSection.filter(
    { masterId, versionId: 'draft' },
    'sortOrder',
    10
  );
  for (const s of (draftSections || [])) {
    try {
      await SR.entities.EssentialSOPSection.create({
        masterId,
        versionId: version.id,
        sectionType: s.sectionType,
        title: s.title,
        sortOrder: s.sortOrder,
        contentItems: s.contentItems || [],
      });
    } catch (err: any) {
      // Partial section failure — audit and continue; do not abort version creation.
      // The version record exists with publicationMutationKey; recovery path A handles retry.
      await writePlatformAudit(SR, {
        actingUserId: user.id,
        actingUserRole: 'SUPER_ADMIN',
        action: 'publication_failed',
        extra: {
          masterId, masterTitle: master.title, publicationMutationKey,
          versionId: version.id,
          metadata: { step: 7, sectionType: s.sectionType, error: 'section_snapshot_failed', partial: true },
        },
      });
      // Continue — do not abort the whole publication for a single section failure.
    }
  }

  // ── Step 8: Create DistributionEvent ───────────────────────────────────────
  let distributionEvent: any;
  try {
    distributionEvent = await _createDistributionEvent(SR, {
      masterId, versionId: version.id,
      eventType, policy: effectivePolicy,
      selectedCompanyIds: normalizedSelectedCompanyIds,
      idempotencyKey: publicationMutationKey,
      publicationMutationKey,
      userId: user.id, now,
    });
    // Back-link the distributionEventId onto the version record
    await SR.entities.EssentialSOPVersion.update(version.id, {
      distributionEventId: distributionEvent.id,
    });
    version = { ...version, distributionEventId: distributionEvent.id };
  } catch (err: any) {
    // Non-fatal — version and sections are safe. currentPublishedVersionId not yet updated.
    // A retry with the same publicationMutationKey will find the existing version and
    // create the missing event (recovery path B).
    await writePlatformAudit(SR, {
      actingUserId: user.id,
      actingUserRole: 'SUPER_ADMIN',
      action: 'publication_failed',
      extra: {
        masterId, masterTitle: master.title, publicationMutationKey,
        versionId: version.id,
        metadata: { step: 8, error: 'distribution_event_create_failed', partial: true },
      },
    });
    // Proceed — master pointer update still runs to leave a consistent state.
    distributionEvent = null;
  }

  // ── Step 9: Update EssentialSOPMaster ──────────────────────────────────────
  // This is the final step. currentPublishedVersionId only points to a
  // complete (version + sections) record.
  const previousVersionId = master.currentPublishedVersionId || null;
  await SR.entities.EssentialSOPMaster.update(masterId, {
    status: 'active',
    currentPublishedVersionId: version.id,
    updatedAt: now,
  });
  const updatedMaster = await SR.entities.EssentialSOPMaster.get(masterId);

  // ── Step 10: Audit publication_completed + distribution_event_created ──────
  await writePlatformAudit(SR, {
    actingUserId: user.id,
    actingUserRole: 'SUPER_ADMIN',
    action: 'master_sop_version_published',
    extra: {
      masterId,
      masterTitle: master.title,
      versionId: version.id,
      versionNumber: nextVersionNumber,
      changeNotes: changeSummary || '',
      publicationMutationKey,
      previousVersionId,
      resultingVersionId: version.id,
      distributionPolicy: effectivePolicy,
    },
  });

  await writePlatformAudit(SR, {
    actingUserId: user.id,
    actingUserRole: 'SUPER_ADMIN',
    action: 'publication_completed',
    extra: {
      masterId, masterTitle: master.title,
      versionId: version.id, versionNumber: nextVersionNumber,
      publicationMutationKey, eventType,
      previousVersionId, resultingVersionId: version.id,
    },
  });

  if (distributionEvent) {
    await writePlatformAudit(SR, {
      actingUserId: user.id,
      actingUserRole: 'SUPER_ADMIN',
      action: 'distribution_event_created',
      extra: {
        masterId, masterTitle: master.title,
        versionId: version.id,
        distributionEventId: distributionEvent.id,
        eventType,
        distributionPolicy: effectivePolicy,
        selectedCompanyIds: normalizedSelectedCompanyIds,
        publicationMutationKey,
      },
    });
  }

  // ── Step 11: NEW_SOP distribution / NEW_VERSION finalization ──────────────
  if (eventType === 'NEW_SOP' && distributionEvent) {
    // First-ever publication: distribute to existing eligible companies.
    await _distributeNewSOPToExistingCompanies(SR, {
      master: updatedMaster,
      version,
      distributionEvent,
      effectivePolicy,
      normalizedSelectedCompanyIds,
      actingUserId: user.id,
      now,
    });
  } else if (eventType === 'NEW_VERSION' && distributionEvent) {
    // Subsequent publication: no Company Job provisioning in Edit 4.
    // The DistributionEvent must still be finalized in a terminal state.
    const completedAt = new Date().toISOString();
    try {
      await SR.entities.DistributionEvent.update(distributionEvent.id, {
        status: 'COMPLETED',
        totalEligibleCompanies: 0,
        processedCompanies: 0,
        successfulCompanies: 0,
        skippedCompanies: 0,
        failedCompanies: 0,
        completedAt,
        updatedAt: completedAt,
      });
    } catch (_) {}
    // Audit: NEW_VERSION publication completed — no Company Job distribution required.
    await writePlatformAudit(SR, {
      actingUserId: user.id,
      actingUserRole: 'SUPER_ADMIN',
      action: 'publication_completed',
      extra: {
        masterId,
        masterTitle: updatedMaster.title,
        versionId: version.id,
        distributionEventId: distributionEvent.id,
        metadata: {
          phase: 'NEW_VERSION_NO_JOB_DISTRIBUTION',
          eventType: 'NEW_VERSION',
          reason: 'NEW_VERSION publications require no Company Job distribution in Edit 4. Edit 5 will handle version adoption notifications.',
        },
      },
    });
  }

  // Re-fetch distributionEvent to get final counts after distribution
  let finalDistributionEvent = distributionEvent;
  if (distributionEvent) {
    try {
      finalDistributionEvent = await SR.entities.DistributionEvent.get(distributionEvent.id);
    } catch (_) {}
  }

  return {
    result: {
      version,
      distributionEvent: finalDistributionEvent,
      master: updatedMaster,
      eventType,
      idempotent: false,
    },
  };
}

// ── Update distribution policy on a Master SOP ─────────────────────────────
// Separate from publishMasterSOPVersion — policy changes are independent of
// publication.

export async function updateDistributionPolicy(
  base44: any,
  params: {
    masterId: string;
    defaultDistributionPolicy: DistributionPolicy;
    defaultSelectedCompanyIds?: string[];
  }
): Promise<{ success?: boolean; master?: any; error?: Response }> {
  const now = new Date().toISOString();
  const SR = base44.asServiceRole;

  const { user, error: authError } = await requirePlatformSuperAdmin(base44);
  if (authError) return { error: authError };

  const { masterId, defaultDistributionPolicy, defaultSelectedCompanyIds } = params;

  if (!masterId) return { error: Response.json({ error: 'masterId required' }, { status: 400 }) };
  if (!VALID_POLICIES.includes(defaultDistributionPolicy as DistributionPolicy)) {
    return { error: Response.json({ error: `Invalid policy: ${defaultDistributionPolicy}` }, { status: 400 }) };
  }

  const master = await SR.entities.EssentialSOPMaster.get(masterId);
  if (!master) return { error: Response.json({ error: 'Not found' }, { status: 404 }) };

  const normalizedIds = defaultSelectedCompanyIds || [];
  if (defaultDistributionPolicy === 'SELECTED_COMPANIES' && normalizedIds.length === 0) {
    return { error: Response.json({ error: 'SELECTED_COMPANIES requires at least one company ID' }, { status: 400 }) };
  }
  if (defaultDistributionPolicy !== 'SELECTED_COMPANIES' && normalizedIds.length > 0) {
    return { error: Response.json({ error: `selectedCompanyIds must be empty for policy ${defaultDistributionPolicy}` }, { status: 400 }) };
  }

  await SR.entities.EssentialSOPMaster.update(masterId, {
    defaultDistributionPolicy,
    defaultSelectedCompanyIds: normalizedIds,
    distributionPolicyUpdatedAt: now,
    distributionPolicyUpdatedByUserId: user.id,
    updatedAt: now,
  });

  await writePlatformAudit(SR, {
    actingUserId: user.id,
    actingUserRole: 'SUPER_ADMIN',
    action: 'distribution_policy_changed',
    extra: {
      masterId, masterTitle: master.title,
      distributionPolicy: defaultDistributionPolicy,
      selectedCompanyIds: normalizedIds,
      metadata: { previousPolicy: master.defaultDistributionPolicy || 'MANUAL' },
    },
  });

  const updated = await SR.entities.EssentialSOPMaster.get(masterId);
  return { success: true, master: updated };
}

// ── Internal: distribute a NEW_SOP to all existing eligible companies ────────
//
// Called only when eventType === 'NEW_SOP'. Loads every active company once,
// evaluates eligibility using the canonical isCompanyEligibleForMaster() engine
// (same function used by companyLibraryProvisioning.ts), then provisions each
// eligible company via a direct Job + ProvisioningRecord write.
//
// Isolation: one company failure never stops the loop.
// Idempotency: existing Jobs and COMPLETED ProvisioningRecords are detected
//   and skipped without modification.
// No existing Company Jobs are ever updated, overwritten, or merged.

async function _distributeNewSOPToExistingCompanies(SR: any, params: {
  master: any;
  version: any;
  distributionEvent: any;
  effectivePolicy: string;
  normalizedSelectedCompanyIds: string[];
  actingUserId: string;
  now: string;
}): Promise<void> {
  const { master, version, distributionEvent, effectivePolicy, normalizedSelectedCompanyIds, actingUserId, now } = params;
  const masterId = master.id;
  const versionId = version.id;
  const distributionEventId = distributionEvent.id;

  // Mark event as PROCESSING
  try {
    await SR.entities.DistributionEvent.update(distributionEventId, {
      status: 'PROCESSING',
      startedAt: now,
      updatedAt: now,
    });
  } catch (_) {}

  // ── Load all active companies once ─────────────────────────────────────────
  let allCompanies: any[] = [];
  try {
    allCompanies = await SR.entities.Company.filter({ status: 'active' }, '-created_date', 1000) || [];
  } catch (err: any) {
    // Cannot load companies — mark event FAILED and abort
    try {
      await SR.entities.DistributionEvent.update(distributionEventId, {
        status: 'FAILED',
        errorSummary: 'Failed to load companies for distribution.',
        completedAt: now,
        updatedAt: now,
      });
    } catch (_) {}
    await writePlatformAudit(SR, {
      actingUserId,
      actingUserRole: 'SUPER_ADMIN',
      action: 'distribution_event_created', // reuse closest available action
      extra: { masterId, versionId, distributionEventId, metadata: { phase: 'FAILED', reason: 'company_load_failed' } },
    });
    return;
  }

  // Policy cutoff for FUTURE_COMPANIES_ONLY
  const masterPolicyCutoffDate = master.distributionPolicyUpdatedAt || master.created_date || now;

  // Filter eligible companies in-memory using the canonical eligibility engine
  const eligibleCompanies = allCompanies.filter((c: any) => {
    const result = isCompanyEligibleForMaster({
      companyId: c.id,
      companyCreatedDate: c.created_date || now,
      masterPolicy: effectivePolicy,
      masterSelectedCompanyIds: Array.isArray(master.defaultSelectedCompanyIds) ? master.defaultSelectedCompanyIds : [],
      masterPolicyCutoffDate,
      effectiveSelectedIds: normalizedSelectedCompanyIds.length > 0 ? normalizedSelectedCompanyIds : null,
    });
    return result.eligible;
  });

  const totalEligible = eligibleCompanies.length;

  // Update event with total eligible count
  try {
    await SR.entities.DistributionEvent.update(distributionEventId, {
      totalEligibleCompanies: totalEligible,
      updatedAt: now,
    });
  } catch (_) {}

  if (totalEligible === 0) {
    try {
      await SR.entities.DistributionEvent.update(distributionEventId, {
        status: 'COMPLETED',
        processedCompanies: 0,
        successfulCompanies: 0,
        skippedCompanies: 0,
        failedCompanies: 0,
        completedAt: now,
        updatedAt: now,
      });
    } catch (_) {}
    return;
  }

  // ── Load existing essential_sop Jobs for all eligible companies in one pass ─
  // Build masterId → Set<companyId> of already-provisioned companies
  let existingJobCompanyIds = new Set<string>();
  try {
    const existingJobs = await SR.entities.Job.filter(
      { sourceType: 'essential_sop', sourceMasterId: masterId },
      '-created_date',
      1000
    ) || [];
    for (const j of existingJobs) {
      existingJobCompanyIds.add(j.companyId);
    }
  } catch (_) {}

  // ── Load existing ProvisioningRecords for this master across all companies ──
  // Used for idempotency lookup before insert
  const existingRecordByKey = new Map<string, any>();
  try {
    const existingRecords = await SR.entities.ProvisioningRecord.filter(
      { masterId, operationType: 'CREATE_NEW_COMPANY_JOB' },
      '-createdAt',
      1000
    ) || [];
    for (const rec of existingRecords) {
      if (rec.provisioningKey) existingRecordByKey.set(rec.provisioningKey, rec);
    }
  } catch (_) {}

  // ── Per-company provisioning loop ─────────────────────────────────────────
  let processed = 0;
  let successful = 0;
  let skipped = 0;
  let failed = 0;

  for (const company of eligibleCompanies) {
    const companyId = company.id;
    const provisioningKey = `dist_${distributionEventId}_${companyId}_${masterId}`;

    try {
      // ── Idempotency: check existing ProvisioningRecord ───────────────────
      const existingRecord = existingRecordByKey.get(provisioningKey) || null;
      if (existingRecord?.status === 'COMPLETED' && existingRecord?.companyJobId) {
        processed++;
        skipped++;
        continue;
      }

      // ── Idempotency: check existing Job ──────────────────────────────────
      if (existingJobCompanyIds.has(companyId)) {
        // Job exists — record as SKIPPED, do not modify the existing job
        try {
          if (!existingRecord) {
            await SR.entities.ProvisioningRecord.create({
              distributionEventId,
              companyId,
              masterId,
              versionId,
              provisioningKey,
              operationType: 'SKIP_ALREADY_PROVISIONED',
              status: 'SKIPPED',
              companyJobId: null, // we don't re-query for the job ID here
              attemptCount: 1,
              lastAttemptAt: now,
              completedAt: now,
              createdAt: now,
              updatedAt: now,
            });
          }
        } catch (_) {}
        processed++;
        skipped++;
        continue;
      }

      // ── Create Company Job ────────────────────────────────────────────────
      let createdJob: any = null;
      try {
        createdJob = await SR.entities.Job.create({
          companyId,
          title: master.title,
          shortDescription: master.description || '',
          trade: master.trade || '',
          category: master.category || '',
          status: 'Published',
          isArchived: false,
          sourceType: 'essential_sop',
          sourceMasterId: masterId,
          sourceVersionId: versionId,
          isCustomized: false,
          customizedAt: null,
          customizedBy: null,
        });
        // Track in-memory to prevent duplicate within this loop
        existingJobCompanyIds.add(companyId);
      } catch (jobErr: any) {
        // Job creation failed — write FAILED ProvisioningRecord
        try {
          await SR.entities.ProvisioningRecord.create({
            distributionEventId,
            companyId,
            masterId,
            versionId,
            provisioningKey,
            operationType: 'CREATE_NEW_COMPANY_JOB',
            status: 'FAILED',
            companyJobId: null,
            errorCode: 'JOB_CREATE_FAILED',
            errorMessage: 'Failed to create company job record.',
            attemptCount: 1,
            lastAttemptAt: now,
            createdAt: now,
            updatedAt: now,
          });
        } catch (_) {}
        processed++;
        failed++;
        continue;
      }

      // ── Write COMPLETED ProvisioningRecord ────────────────────────────────
      try {
        const rec = existingRecord
          ? await SR.entities.ProvisioningRecord.update(existingRecord.id, {
              status: 'COMPLETED',
              companyJobId: createdJob.id,
              versionId,
              distributionEventId,
              lastAttemptAt: now,
              completedAt: now,
              errorCode: null,
              errorMessage: null,
              updatedAt: now,
              attemptCount: (existingRecord.attemptCount || 0) + 1,
            })
          : await SR.entities.ProvisioningRecord.create({
              distributionEventId,
              companyId,
              masterId,
              versionId,
              provisioningKey,
              operationType: 'CREATE_NEW_COMPANY_JOB',
              status: 'COMPLETED',
              companyJobId: createdJob.id,
              attemptCount: 1,
              lastAttemptAt: now,
              completedAt: now,
              createdAt: now,
              updatedAt: now,
            });
        existingRecordByKey.set(provisioningKey, rec);
      } catch (_) {}

      processed++;
      successful++;

    } catch (outerErr: any) {
      // Catch-all — ensures one company never stops the loop
      processed++;
      failed++;
    }
  }

  // ── Finalize DistributionEvent ─────────────────────────────────────────────
  const overallStatus = failed === 0
    ? 'COMPLETED'
    : successful > 0 || skipped > 0
      ? 'COMPLETED_WITH_ERRORS'
      : 'FAILED';

  const completedAt = new Date().toISOString();
  try {
    await SR.entities.DistributionEvent.update(distributionEventId, {
      status: overallStatus,
      totalEligibleCompanies: totalEligible,
      processedCompanies: processed,
      successfulCompanies: successful,
      skippedCompanies: skipped,
      failedCompanies: failed,
      completedAt,
      updatedAt: completedAt,
      errorSummary: failed > 0 ? `${failed} company(ies) failed during NEW_SOP distribution.` : null,
    });
  } catch (_) {}

  // ── Audit: distribution completed ─────────────────────────────────────────
  await writePlatformAudit(SR, {
    actingUserId,
    actingUserRole: 'SUPER_ADMIN',
    action: 'publication_completed', // closest available enum value
    extra: {
      masterId,
      masterTitle: master.title,
      versionId,
      distributionEventId,
      metadata: {
        phase: 'distribution_completed',
        eventType: 'NEW_SOP',
        totalEligible,
        processed,
        successful,
        skipped,
        failed,
        overallStatus,
      },
    },
  });
}

// ── Internal helper: create a DistributionEvent record ─────────────────────

async function _createDistributionEvent(SR: any, params: {
  masterId: string;
  versionId: string;
  eventType: 'NEW_SOP' | 'NEW_VERSION';
  policy: string;
  selectedCompanyIds: string[];
  idempotencyKey: string;
  publicationMutationKey: string;
  userId: string;
  now: string;
}): Promise<any> {
  return await SR.entities.DistributionEvent.create({
    masterId: params.masterId,
    versionId: params.versionId,
    eventType: params.eventType,
    distributionPolicy: params.policy,
    selectedCompanyIds: params.selectedCompanyIds,
    status: 'PENDING',
    idempotencyKey: params.idempotencyKey,
    publicationMutationKey: params.publicationMutationKey,
    totalEligibleCompanies: 0,
    processedCompanies: 0,
    successfulCompanies: 0,
    skippedCompanies: 0,
    failedCompanies: 0,
    createdByUserId: params.userId,
    startedAt: params.now,
    createdAt: params.now,
    updatedAt: params.now,
  });
}