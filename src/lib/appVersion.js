/**
 * Essential SOP — Product Version (single source of truth).
 *
 * This is the version of the Essential SOP SOFTWARE PRODUCT. It is NOT related
 * to and must NEVER be confused with:
 *   - Master SOP versioning / EssentialSOPVersion records
 *   - publishing versions or Company Job versions
 *   - Master SOP draft revision numbers
 *
 * The Master SOP versioning architecture is untouched by this value.
 *
 * To release the next product version (e.g. v0.6), update APP_VERSION,
 * APP_RELEASE_STAGE, and APP_VERSION_DISPLAY below (and APP_RELEASE_NOTES
 * when there is a new changelog).
 */
export const APP_VERSION = '0.5';

export const APP_RELEASE_STAGE = 'Beta';

/** Human-readable display string shown in admin/profile areas. */
export const APP_VERSION_DISPLAY = 'v0.5 Beta';

/** Release changelog for the current product version. */
export const APP_RELEASE_NOTES = [
  'AI Master SOP Builder',
  'Manual and AI Master SOP authoring',
  'Structured AI draft generation',
  'AI draft validation and persistence safety',
  'Simplified Master SOP publishing',
  'Publishing separated from company distribution',
  'Publishing Notes preserved in version history',
  'Improved publishing error handling and navigation',
  'Improved Master SOP deletion and company-access revocation',
  'Clean Master SOP production-library starting state',
];