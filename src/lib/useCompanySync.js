/**
 * useCompanySync — Automatic Company Library Synchronization Hook
 *
 * Runs once per company workspace session on mount (after the company is loaded).
 * Subsequent launches within the same session are skipped.
 * Manual sync can be triggered via triggerSync().
 *
 * Sync state is exposed for the Sync Settings page and the Profile section.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { base44 } from '@/api/base44Client';

const SYNC_STORAGE_PREFIX = 'esop_sync_';

function getSyncStorageKey(companyId) {
  return `${SYNC_STORAGE_PREFIX}${companyId}`;
}

function loadSyncRecord(companyId) {
  try {
    const raw = localStorage.getItem(getSyncStorageKey(companyId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSyncRecord(companyId, record) {
  try {
    localStorage.setItem(getSyncStorageKey(companyId), JSON.stringify(record));
  } catch {}
}

/**
 * Returns sync state and a manual trigger for a given companyId.
 *
 * @param {string|null} companyId
 * @param {boolean} hasCompany
 * @param {boolean} isCompanyAdmin  — only admins trigger provisioning; all roles get the status read
 */
export function useCompanySync(companyId, hasCompany, isCompanyAdmin) {
  const [syncing, setSyncing] = useState(false);
  const [syncRecord, setSyncRecord] = useState(() => (companyId ? loadSyncRecord(companyId) : null));
  const [syncError, setSyncError] = useState(null);
  const hasRunRef = useRef(false);

  // Load persisted record when companyId changes
  useEffect(() => {
    if (companyId) {
      setSyncRecord(loadSyncRecord(companyId));
      hasRunRef.current = false; // allow auto-sync on new company
    }
  }, [companyId]);

  const runSync = useCallback(async (manual = false) => {
    if (!companyId || !hasCompany) return;
    if (syncing) return;
    if (!navigator.onLine) {
      // Offline — skip, will retry on next online load
      return;
    }

    setSyncing(true);
    setSyncError(null);
    const startedAt = new Date().toISOString();

    try {
      const res = await base44.functions.invoke('syncCompanyLibrary', { companyId });
      const data = res.data;

      const record = {
        lastSyncAt: data.completedAt || new Date().toISOString(),
        startedAt: data.startedAt || startedAt,
        durationMs: data.durationMs || 0,
        summary: data.summary || { checked: 0, added: 0, outdated: 0, skipped: 0, failed: 0 },
        failedItems: data.failedItems || [],
        manual,
      };

      saveSyncRecord(companyId, record);
      setSyncRecord(record);
    } catch (err) {
      setSyncError(err?.message || 'Sync failed');
      // Still save a failed record so we know when it last attempted
      const failRecord = {
        lastSyncAt: new Date().toISOString(),
        startedAt,
        durationMs: 0,
        summary: null,
        failedItems: [],
        error: err?.message || 'Sync failed',
        manual,
      };
      saveSyncRecord(companyId, failRecord);
      setSyncRecord(failRecord);
    } finally {
      setSyncing(false);
    }
  }, [companyId, hasCompany, syncing]);

  // Auto-sync once per session when workspace loads (non-blocking)
  useEffect(() => {
    if (!companyId || !hasCompany) return;
    if (hasRunRef.current) return;
    hasRunRef.current = true;

    // Small delay to let the app finish loading before the network call
    const timer = setTimeout(() => {
      runSync(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, [companyId, hasCompany]); // intentionally exclude runSync to avoid re-triggering

  return {
    syncing,
    syncRecord,
    syncError,
    triggerSync: () => runSync(true),
  };
}