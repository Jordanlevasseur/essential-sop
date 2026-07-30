/**
 * SopVersionTimeline — Full version history timeline for a Master SOP.
 * Supports: viewing change summaries, comparing versions, initiating rollback.
 */
import React, { useState } from 'react';
import { CheckCircle2, Clock, GitBranch, Eye, RotateCcw, ChevronDown, ChevronUp, X, AlertTriangle } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function SopVersionTimeline({ master, versions, currentVersionId, onRollback, onCompare, onClose }) {
  const [expanded, setExpanded] = useState(null);
  const [confirmRollback, setConfirmRollback] = useState(null);
  const [rolling, setRolling] = useState(false);
  const [rollbackError, setRollbackError] = useState(null);

  const sorted = [...(versions || [])].sort((a, b) => b.versionNumber - a.versionNumber);

  const handleRollback = async (version) => {
    setRolling(true);
    setRollbackError(null);
    try {
      await onRollback(version);
      setConfirmRollback(null);
    } catch (e) {
      setRollbackError(e.message || 'Rollback failed. Please try again.');
    }
    setRolling(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-app-surface rounded-2xl w-full max-w-xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-app-border flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="font-semibold text-app-text">Version Timeline</h3>
            <p className="text-xs text-app-text-muted">{master.title}</p>
          </div>
          <div className="flex items-center gap-2">
            {onCompare && sorted.length >= 2 && (
              <button
                onClick={() => onCompare(sorted[1], sorted[0])}
                className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1.5 hover:border-app-accent transition-colors"
              >
                <GitBranch size={12} /> Compare Latest
              </button>
            )}
            <button onClick={onClose} className="icon-btn text-app-text-muted hover:text-app-text">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {sorted.length === 0 ? (
            <div className="text-center py-8 text-app-text-muted text-sm">No published versions yet.</div>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[17px] top-4 bottom-4 w-0.5 bg-app-border" />

              <div className="space-y-4">
                {sorted.map((v, i) => {
                  const isCurrent = v.id === currentVersionId;
                  const isExpanded = expanded === v.id;
                  const date = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
                  const time = v.publishedAt ? new Date(v.publishedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';

                  return (
                    <div key={v.id} className="relative flex gap-4">
                      {/* Dot */}
                      <div className={`flex-shrink-0 w-9 h-9 rounded-full border-2 flex items-center justify-center z-10 ${
                        isCurrent ? 'bg-app-accent border-app-accent' : 'bg-app-surface border-app-border'
                      }`}>
                        {isCurrent
                          ? <CheckCircle2 size={16} className="text-white" />
                          : <Clock size={14} className="text-app-text-muted" />
                        }
                      </div>

                      {/* Card */}
                      <div className={`flex-1 border rounded-xl overflow-hidden transition-colors ${
                        isCurrent ? 'border-app-accent/40 bg-app-info-bg/30' : 'border-app-border bg-app-card'
                      }`}>
                        <div
                          className="px-4 py-3 cursor-pointer hover:bg-app-elevated/50 transition-colors"
                          onClick={() => setExpanded(isExpanded ? null : v.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-app-text">v{v.versionNumber}</span>
                              {isCurrent && (
                                <span className="text-xs px-2 py-0.5 bg-app-accent text-app-accent-text rounded-full font-medium">Current</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-app-text-muted">
                              <span>{date}</span>
                              {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </div>
                          </div>
                          {v.changeNotes && !isExpanded && (
                            <p className="text-xs text-app-text-2 mt-1 line-clamp-1">{v.changeNotes}</p>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="border-t border-app-divider px-4 py-3 space-y-3">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <p className="text-app-text-muted">Published</p>
                                <p className="text-app-text font-medium">{date} {time}</p>
                              </div>
                              <div>
                                <p className="text-app-text-muted">Author ID</p>
                                <p className="text-app-text font-mono text-[10px] truncate">{v.publishedBy || '—'}</p>
                              </div>
                            </div>

                            {v.changeNotes && (
                              <div>
                                <p className="text-xs font-semibold text-app-text-muted mb-1">Change Summary</p>
                                <p className="text-sm text-app-text-2 leading-relaxed whitespace-pre-wrap">{v.changeNotes}</p>
                              </div>
                            )}

                            <div className="flex gap-2 flex-wrap">
                              {onCompare && i < sorted.length - 1 && (
                                <button
                                  onClick={() => onCompare(sorted[i + 1], v)}
                                  className="px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text-2 flex items-center gap-1 hover:border-app-accent transition-colors"
                                >
                                  <Eye size={11} /> Compare with v{sorted[i + 1].versionNumber}
                                </button>
                              )}
                              {!isCurrent && (
                                <button
                                  onClick={() => setConfirmRollback(v)}
                                  className="px-3 py-1.5 border border-app-warning/40 rounded-lg text-xs text-app-warning flex items-center gap-1 hover:bg-app-warning-bg transition-colors"
                                >
                                  <RotateCcw size={11} /> Rollback to v{v.versionNumber}
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Rollback confirmation */}
      {confirmRollback && (
        <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmRollback(null)}>
          <div className="bg-app-surface rounded-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-start gap-3 mb-4">
              <AlertTriangle size={20} className="text-app-warning flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-bold text-app-text mb-1">Rollback to v{confirmRollback.versionNumber}?</h3>
                <p className="text-sm text-app-text-2 leading-relaxed">
                  This will create a <strong>new version</strong> with the content from v{confirmRollback.versionNumber}. The current version will not be deleted.
                </p>
                <p className="text-xs text-app-text-muted mt-2">
                  Company Jobs will be notified of the new version update as usual.
                </p>
              </div>
            </div>
            {rollbackError && (
              <div className="mb-3 p-2.5 bg-app-danger-bg rounded-lg text-xs text-app-danger">{rollbackError}</div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => handleRollback(confirmRollback)}
                disabled={rolling}
                className="flex-1 py-2.5 bg-app-warning text-white rounded-lg text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {rolling ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Rolling back…</> : 'Confirm Rollback'}
              </button>
              <button onClick={() => setConfirmRollback(null)} className="flex-1 py-2.5 border border-app-border rounded-lg text-sm text-app-text-2">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}