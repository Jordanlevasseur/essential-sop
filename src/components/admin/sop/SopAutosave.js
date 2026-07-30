/**
 * SopAutosave — localStorage-backed draft recovery for the Master SOP editor.
 *
 * Stores unsaved section item changes locally so a refresh/crash doesn't lose work.
 * The server is the authoritative source; localStorage is a safety net only.
 * On load, if a local draft is newer than the server version, the editor
 * offers to restore it.
 */

const KEY_PREFIX = 'sop_autosave_';

function storageKey(masterId) {
  return `${KEY_PREFIX}${masterId}`;
}

/**
 * Save a draft snapshot to localStorage.
 * @param {string} masterId
 * @param {{ sections: Array, metaFields: object, serverUpdatedAt: string }} data
 */
export function saveDraft(masterId, data) {
  try {
    localStorage.setItem(storageKey(masterId), JSON.stringify({
      ...data,
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {}
}

/**
 * Read the locally saved draft, if any.
 * Returns null if none exists or on error.
 * @param {string} masterId
 * @returns {{ sections, metaFields, serverUpdatedAt, savedAt } | null}
 */
export function readDraft(masterId) {
  try {
    const raw = localStorage.getItem(storageKey(masterId));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

/**
 * Clear the locally saved draft (call after a successful save to server).
 * @param {string} masterId
 */
export function clearDraft(masterId) {
  try {
    localStorage.removeItem(storageKey(masterId));
  } catch (_) {}
}

/**
 * Check if a stored local draft is newer than the server version.
 * Returns true if the local draft should be offered for restoration.
 * @param {string} masterId
 * @param {string} serverUpdatedAt — ISO timestamp of the server's updatedAt
 */
export function hasFresherDraft(masterId, serverUpdatedAt) {
  const draft = readDraft(masterId);
  if (!draft || !draft.savedAt) return false;
  // If server has been updated since draft was saved, the draft is stale
  if (serverUpdatedAt && new Date(serverUpdatedAt) > new Date(draft.savedAt)) return false;
  return true;
}