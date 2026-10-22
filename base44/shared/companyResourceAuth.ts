/**
 * companyResourceAuth.ts — Shared authorization + validation for Company Resources.
 *
 * Used by both resolveCompanyResources (read) and manageCompanyResource (write)
 * so the access check is never duplicated and never drifts between surfaces.
 *
 * Reuses the existing company membership verification (companyAuth.ts). For
 * essential_sop Jobs, mirrors resolveJob's adopted-SOP ownership rule: an
 * already-adopted, Published company SOP's resources and PDFs remain accessible
 * even if the originating Master is archived, retired, or unassigned. Platform
 * Master status and ProvisioningRecord assignment are NOT required to read or
 * manage resources on an existing adopted SOP — they remain required only for
 * NEW adoption/provisioning (addToCompanyLibrary / resolveCompanyMasterLibrary).
 */
import { getActiveMembership, isCompanyAdminRole } from './companyAuth.ts';

export const VALID_RESOURCE_TYPES = new Set([
  'youtube', 'manual', 'pdf', 'documentation', 'training', 'website', 'other',
]);

export function isValidResourceType(t: string): boolean {
  return VALID_RESOURCE_TYPES.has(t);
}

/**
 * Validates and sanitizes a URL. Rejects non-HTTPS schemes (javascript:, data:,
 * vbscript:, file:) and any non-https URL. Returns the canonical https URL or null.
 * Never retrieves or executes the linked content server-side.
 */
export function sanitizeHttpsUrl(raw: any): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Reject dangerous schemes before URL parsing
  if (/^\s*(javascript|data|vbscript|file):/i.test(trimmed)) return null;
  if (!/^https:\/\//i.test(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch (_) {
    return null;
  }
}

const ALLOWED_RESOURCE_FIELDS = ['title', 'url', 'resourceType', 'description'];

/** Whitelist client-settable fields. companyId, jobId, createdByUserId,
 *  displayOrder are never accepted from the client. */
export function sanitizeResourceData(raw: any): any {
  const out: any = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of ALLOWED_RESOURCE_FIELDS) {
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

/**
 * Verifies caller access to a Job for Company Resources operations.
 *
 * requireAdmin: true for write operations (GM/PM only), false for reads (any
 * active member with SOP visibility).
 *
 * Enforces:
 *   - Authenticated user
 *   - Active CompanyMembership for the job's company
 *   - Admin role (GM/PM) when requireAdmin is true
 *   - Job is not archived
 *   - For essential_sop Jobs: Published status (company's own Job state).
 *     Platform Master status and ProvisioningRecord assignment are NOT checked
 *     — an already-adopted SOP's resources/PDFs remain accessible even if the
 *     Master is archived/retired/unassigned (adopted-SOP ownership rule).
 *
 * Returns { job, membership, isCompanyAdmin } on success, or { error: Response }.
 */
export async function verifyResourceJobAccess(
  base44: any, SR: any, user: any, jobId: string, requireAdmin: boolean
): Promise<any> {
  const job = await SR.entities.Job.get(jobId).catch(() => null);
  if (!job) return { error: Response.json({ error: 'Job not found' }, { status: 404 }) };

  const membership = await getActiveMembership(base44, user.id, job.companyId);
  if (!membership) return { error: Response.json({ error: 'Forbidden' }, { status: 403 }) };

  if (requireAdmin && !isCompanyAdminRole(membership.role)) {
    return { error: Response.json({ error: 'Insufficient role to manage resources' }, { status: 403 }) };
  }

  // Archived jobs never expose resources (company-created or Master-derived)
  if (job.isArchived === true) {
    return { error: Response.json({ error: 'This procedure is no longer active.', code: 'JOB_NOT_ACTIVE' }, { status: 410 }) };
  }

  // Adopted-SOP ownership rule — mirror resolveJob's resolveEssentialSOPJob gate.
  // An EXISTING adopted company SOP is decoupled from platform Master availability.
  // The company owns its adopted Job and its resources/PDFs, so archiving/retiring/
  // unassigning the original platform Master must NOT make resources or PDFs
  // inaccessible. Access is governed solely by the company's own Job state
  // (Published + non-archived, checked above). Platform Master status and
  // ProvisioningRecord assignment remain required only for NEW adoption/
  // provisioning (addToCompanyLibrary / resolveCompanyMasterLibrary).
  if (job.sourceType === 'essential_sop') {
    if (job.status !== 'Published') {
      return { error: Response.json({ error: 'This procedure is no longer active.', code: 'JOB_NOT_ACTIVE' }, { status: 410 }) };
    }
  }

  return { job, membership, isCompanyAdmin: isCompanyAdminRole(membership.role) };
}