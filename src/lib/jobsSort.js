/**
 * jobsSort — shared sorting for Job / Master SOP listings.
 *
 * Reused by the Jobs screen and the Master Library so both lists share one
 * deterministic sort definition. Works against company Jobs (created_date /
 * updated_date) and Master SOPs (createdAt / updatedAt) by falling back
 * across both field-name conventions, so missing metadata never hides a row
 * or breaks ordering. Identical sort keys always tie-break by title A–Z so
 * ordering stays stable.
 */

export const SORT_OPTIONS = [
  { value: 'name_az', label: 'Name: A–Z' },
  { value: 'name_za', label: 'Name: Z–A' },
  { value: 'category', label: 'Category' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'recently_updated', label: 'Recently updated' },
  { value: 'least_recently_updated', label: 'Least recently updated' },
];

export const DEFAULT_SORT = 'name_az';

const getTitle = (j) => (j.title || '').toLowerCase();
const getCategory = (j) => j.category || '';
const getCreated = (j) => new Date(j.createdAt || j.created_date || 0).getTime();
const getUpdated = (j) => new Date(j.updatedAt || j.updated_date || 0).getTime();
const byTitleAsc = (a, b) => getTitle(a).localeCompare(getTitle(b));

export function sortItems(list, sortBy) {
  const arr = [...list];
  switch (sortBy) {
    case 'name_za':
      return arr.sort((a, b) => getTitle(b).localeCompare(getTitle(a)) || byTitleAsc(a, b));
    case 'category':
      return arr.sort((a, b) => {
        const ca = getCategory(a), cb = getCategory(b);
        if (!ca && !cb) return byTitleAsc(a, b);
        if (!ca) return 1;   // missing categories sort last
        if (!cb) return -1;
        return ca.localeCompare(cb) || byTitleAsc(a, b);
      });
    case 'newest':
      return arr.sort((a, b) => getCreated(b) - getCreated(a) || byTitleAsc(a, b));
    case 'oldest':
      return arr.sort((a, b) => getCreated(a) - getCreated(b) || byTitleAsc(a, b));
    case 'recently_updated':
      return arr.sort((a, b) => getUpdated(b) - getUpdated(a) || byTitleAsc(a, b));
    case 'least_recently_updated':
      return arr.sort((a, b) => getUpdated(a) - getUpdated(b) || byTitleAsc(a, b));
    case 'name_az':
    default:
      return arr.sort(byTitleAsc);
  }
}

/** Map any legacy stored sort value to the current option set. */
export function migrateSort(value) {
  if (SORT_OPTIONS.some((o) => o.value === value)) return value;
  if (value === 'updated') return 'recently_updated';
  if (value === 'title') return 'name_az';
  if (value === 'trade') return 'category';
  return DEFAULT_SORT;
}