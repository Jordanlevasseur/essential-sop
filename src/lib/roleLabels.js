/**
 * Centralized role-label resolution.
 *
 * Backend role CODES never change — they control permissions.
 * Display LABELS are the only thing that may vary per company.
 *
 * Usage:
 *   getRoleLabel('project_lead', company)   → 'Lead Carpenter'  (or default)
 *   getRoleLabel('technician')              → 'Technician'
 *   ALL_ROLES                               → list for selects
 */

export const ROLE_CODES = ['general_manager', 'project_manager', 'project_lead', 'technician'];

export const DEFAULT_ROLE_LABELS = {
  general_manager: 'General Manager',
  project_manager: 'Project Manager',
  project_lead: 'Project Lead',
  technician: 'Technician',
};

// General Manager label is fixed — not customizable.
export const FIXED_ROLE_LABELS = ['general_manager'];

// Max character length for custom labels.
export const ROLE_LABEL_MAX_LENGTH = 32;

// Disallowed label values (case-insensitive prefix match).
export const DISALLOWED_LABEL_PREFIXES = ['owner'];

/**
 * Resolve a display label for a role code.
 * @param {string} roleCode  — e.g. 'project_lead'
 * @param {object} [company] — Company record; may have customRoleLabels object
 * @returns {string}
 */
export function getRoleLabel(roleCode, company) {
  if (!roleCode) return '';
  if (company?.customRoleLabels?.[roleCode] && !FIXED_ROLE_LABELS.includes(roleCode)) {
    return company.customRoleLabels[roleCode];
  }
  return DEFAULT_ROLE_LABELS[roleCode] || roleCode.replace(/_/g, ' ');
}

/**
 * Returns all customizable roles (all except General Manager).
 */
export function getCustomizableRoles() {
  return ROLE_CODES.filter(r => !FIXED_ROLE_LABELS.includes(r));
}

/**
 * Validate a proposed custom label.
 * Returns an error string or null if valid.
 */
export function validateRoleLabel(label) {
  if (!label || !label.trim()) return 'Label cannot be blank.';
  if (label.trim().length > ROLE_LABEL_MAX_LENGTH) return `Label must be ${ROLE_LABEL_MAX_LENGTH} characters or fewer.`;
  const lower = label.trim().toLowerCase();
  if (DISALLOWED_LABEL_PREFIXES.some(p => lower.startsWith(p))) {
    return `The label "${label}" is not allowed.`;
  }
  return null;
}

/**
 * Map internal status codes to user-facing labels.
 */
export const EDIT_REQUEST_STATUS_LABELS = {
  pending: 'Awaiting Review',
  approved: 'Edit Access Approved',
  editing: 'Editing in Progress',
  submitted_for_review: 'Changes Submitted',
  changes_requested: 'Changes Requested',
  published: 'Published',
  denied: 'Request Denied',
  rejected: 'Changes Rejected',
  expired: 'Edit Access Expired',
  revoked: 'Edit Access Revoked',
  cancelled: 'Request Cancelled',
};

export function getEditRequestStatusLabel(status) {
  return EDIT_REQUEST_STATUS_LABELS[status] || status?.replace(/_/g, ' ') || '';
}

/**
 * Notification category mapping — used by Notifications page filters.
 */
export const NOTIFICATION_CATEGORIES = {
  needs_attention: [
    'edit_request_submitted',
    'temporary_access_expiring',
    'revision_submitted',
    'revision_changes_requested',
    'invitation_received',
    'plan_limit_reached',
    'membership_suspended',
  ],
  jobs: [
    'job_published',
    'edit_request_approved',
    'edit_request_denied',
    'temporary_access_expired',
    'temporary_access_revoked',
    'revision_published',
    'revision_rejected',
  ],
  team: [
    'invitation_sent',
    'invitation_accepted',
    'invitation_cancelled',
    'role_changed',
    'membership_suspended',
    'membership_restored',
  ],
  account: [
    'subscription_status_changed',
    'plan_limit_reached',
  ],
};

export function getNotificationCategory(type) {
  for (const [cat, types] of Object.entries(NOTIFICATION_CATEGORIES)) {
    if (types.includes(type)) return cat;
  }
  return 'account';
}

/**
 * Activity log category mapping — used by ActivityHistory filters.
 */
export const ACTIVITY_CATEGORIES = {
  jobs: [
    'job_created', 'job_edited', 'job_published', 'job_archived', 'job_restored',
    'revision_published',
  ],
  team: [
    'member_invited', 'invitation_resent', 'invitation_cancelled', 'invitation_accepted',
    'member_role_changed', 'member_suspended', 'member_restored', 'member_removed',
    'ownership_transferred',
  ],
  edit_access: [
    'edit_request_submitted', 'edit_request_approved', 'edit_request_denied',
    'temporary_access_granted', 'temporary_access_revoked', 'temporary_access_expired',
    'revision_submitted', 'revision_changes_requested', 'revision_rejected',
  ],
  account: [
    'plan_selected', 'plan_upgraded', 'plan_downgraded', 'downgrade_blocked',
    'account_over_limit', 'account_within_limit', 'membership_activation_blocked',
    'account_deletion_requested', 'seat_limit_blocked', 'company_created',
  ],
};

export function getActivityCategory(actionType) {
  for (const [cat, types] of Object.entries(ACTIVITY_CATEGORIES)) {
    if (types.includes(actionType)) return cat;
  }
  return 'account';
}

// PM-visible action types
export const PM_VISIBLE_ACTIONS = [
  ...ACTIVITY_CATEGORIES.jobs,
  ...ACTIVITY_CATEGORIES.edit_access,
];