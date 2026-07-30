/**
 * SopAutosave — localStorage-backed draft recovery for the Master SOP editor.
 *
 * ARCHITECTURE:
 *   Editor state → immediate localStorage copy → debounced server save → authoritative server draft
 *
 * The server is always the authoritative source. localStorage is a secondary safety net that
 * survives browser crashes, tab closes, and network failures. It is NOT authoritative and must
 * never be presented as such.
 *
 * STORAGE KEY SCOPING:
 *   sop_draft_{masterId}_{userId}
 *
 * Scoped to both masterId AND userId so:
 *   - Two admins editing the same SOP do not overwrite each other's local cache.
 *   - Draft data from one SOP cannot leak into another.
 *   - Switching users on the same device does not surface another user's draft.
 *
 * RECOVERY CASES (see MasterSOPEditor for the decision logic):
 *   A — No local draft         → load server draft
 *   B — Revisions match        → load server draft (already in sync)
 *   C — Local is ahead         → offer restore
 *   D — Server is newer        → load server by default, keep local for comparison
 *   E — Both changed from same → conflict: offer compare
 *   F — Wrong masterId/userId  → reject silently
 */

/**
 * Build a scoped localStorage key.
 * @param {string} masterId
 * @param {string} userId
 */
function storageKey(masterId, userId) {
  return `sop_draft_${masterId}_${userId}`;
}

/**
 * Save a draft snapshot to localStorage immediately.
 * Call this on every editor change for crash-safe recovery.
 *
 * @param {string} masterId
 * @param {string} userId
 * @param {{
 *   sections: Array,
 *   metaFields: object,
 *   serverDraftRevision: number,
 *   serverUpdatedAt: string
 * }} data
 */
export function saveDraft(masterId, userId, data) {
  if (!masterId || !userId) return;
  try {
    localStorage.setItem(storageKey(masterId, userId), JSON.stringify({
      ...data,
      masterId,
      userId,
      savedAt: new Date().toISOString(),
    }));
  } catch (_) {}
}

/**
 * Read the locally saved draft for this masterId + userId.
 * Returns null if none exists, on error, or if the stored record belongs to a different scope.
 *
 * @param {string} masterId
 * @param {string} userId
 * @returns {{ sections, metaFields, serverDraftRevision, serverUpdatedAt, savedAt } | null}
 */
export function readDraft(masterId, userId) {
  if (!masterId || !userId) return null;
  try {
    const raw = localStorage.getItem(storageKey(masterId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Safety: reject if scope fields don't match (old keys without scoping)
    if (parsed.masterId && parsed.masterId !== masterId) return null;
    if (parsed.userId && parsed.userId !== userId) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

/**
 * Clear the locally saved draft for this masterId + userId.
 * ONLY call after a confirmed successful server save, publication, deletion, or explicit user discard.
 *
 * @param {string} masterId
 * @param {string} userId
 */
export function clearDraft(masterId, userId) {
  if (!masterId || !userId) return;
  try {
    localStorage.removeItem(storageKey(masterId, userId));
  } catch (_) {}
}

/**
 * Determine the recovery case to present to the user on editor load.
 *
 * Returns one of:
 *   'none'         — no local draft; load server as-is (Case A)
 *   'in_sync'      — local and server revisions match; server is authoritative (Case B)
 *   'local_ahead'  — local revision is higher than server; likely unsaved work (Case C)
 *   'server_ahead' — server revision is newer than local; server wins by default (Case D)
 *   'conflict'     — both changed from a different base; requires admin decision (Case E)
 *
 * @param {string} masterId
 * @param {string} userId
 * @param {number} serverDraftRevision
 * @param {string} serverUpdatedAt  ISO string
 * @returns {'none'|'in_sync'|'local_ahead'|'server_ahead'|'conflict'}
 */
export function assessDraftRecovery(masterId, userId, serverDraftRevision, serverUpdatedAt) {
  const draft = readDraft(masterId, userId);
  if (!draft) return 'none';

  const localRevision = draft.serverDraftRevision ?? -1;
  const serverRev = serverDraftRevision ?? 0;

  if (localRevision === serverRev) {
    // Same revision — check if server was updated since the local save
    if (serverUpdatedAt && new Date(serverUpdatedAt) > new Date(draft.savedAt)) {
      return 'server_ahead'; // Server updated after local save, same revision means external write
    }
    return 'in_sync';
  }

  if (localRevision > serverRev) return 'local_ahead';  // Case C — local has unsaved work
  return 'server_ahead'; // Case D — server is newer
}