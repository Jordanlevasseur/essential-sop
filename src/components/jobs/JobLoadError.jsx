import React, { useState } from 'react';
import { AlertTriangle, RefreshCw, ArrowLeft, ChevronDown, ChevronUp, WifiOff, Lock, ServerCrash, Clock, FileWarning } from 'lucide-react';
import { useJobsListState } from '@/lib/useJobsListState';

const IS_DEV = import.meta.env.DEV;

// ── Per-error-type copy ───────────────────────────────────────────────────────

const ERROR_COPY = {
  NOT_FOUND: {
    icon: FileWarning,
    iconCls: 'text-app-text-muted',
    bgCls: 'bg-app-elevated',
    title: 'Job not found',
    body: 'This Job could not be found. It may have been deleted, moved, or the link is no longer valid.',
    footer: 'If you believe this is a mistake, contact your administrator.',
  },
  FORBIDDEN: {
    icon: Lock,
    iconCls: 'text-app-warning',
    bgCls: 'bg-app-warning-bg',
    title: 'Access denied',
    body: "You don't have permission to view this Job.",
    footer: 'If you need access, contact your administrator.',
  },
  PERMISSION_CHANGED: {
    icon: Lock,
    iconCls: 'text-app-warning',
    bgCls: 'bg-app-warning-bg',
    title: 'Access has changed',
    body: 'Your permissions changed while this Job was open.',
    footer: 'Please return to the Jobs list or contact your administrator if you believe this is an error.',
  },
  NETWORK_ERROR: {
    icon: WifiOff,
    iconCls: 'text-app-text-2',
    bgCls: 'bg-app-elevated',
    title: 'No internet connection',
    body: "We couldn't reach the server.",
    footer: 'Check your internet connection and try again.\n\nYour work has not been changed.',
  },
  TIMEOUT: {
    icon: Clock,
    iconCls: 'text-app-text-2',
    bgCls: 'bg-app-elevated',
    title: 'Request timed out',
    body: 'The server took too long to respond.',
    footer: 'Please try again. If this continues, check your connection or contact your administrator.',
  },
  SERVER_ERROR: {
    icon: ServerCrash,
    iconCls: 'text-app-danger',
    bgCls: 'bg-app-danger-bg',
    title: 'Server error',
    body: 'Something went wrong while loading this Job.',
    footer: 'Your work has not been changed.\n\nPlease try again in a moment. If the problem continues, contact your administrator.',
  },
  INVALID_RESPONSE: {
    icon: AlertTriangle,
    iconCls: 'text-app-warning',
    bgCls: 'bg-app-warning-bg',
    title: "Job data couldn't be loaded",
    body: 'We received an unexpected response while loading this Job.',
    footer: 'Your work has not been changed.\n\nPlease try again. If the problem continues, contact your administrator.',
  },
  UNAVAILABLE: {
    icon: FileWarning,
    iconCls: 'text-app-text-muted',
    bgCls: 'bg-app-elevated',
    title: 'Procedure no longer available',
    body: 'This procedure is no longer available to your company. It may have been removed from your library or is no longer provisioned to your company.',
    footer: 'Your customized copy and history are preserved. If you believe this is a mistake, contact your administrator.',
  },
  UNKNOWN_ERROR: {
    icon: AlertTriangle,
    iconCls: 'text-app-danger',
    bgCls: 'bg-app-danger-bg',
    title: 'Unable to load this Job',
    body: "We couldn't load this Job right now. This may be a temporary problem or the Job may no longer be available.",
    footer: null,
  },
};

function getCopy(errorCode) {
  if (!errorCode) return ERROR_COPY.UNKNOWN_ERROR;
  if (errorCode === 'JOB_NOT_FOUND' || errorCode === 'HTTP_404') return ERROR_COPY.NOT_FOUND;
  if (errorCode === 'HTTP_403' || errorCode === 'FORBIDDEN') return ERROR_COPY.FORBIDDEN;
  if (errorCode === 'PERMISSION_CHANGED') return ERROR_COPY.PERMISSION_CHANGED;
  if (errorCode === 'NETWORK_ERROR') return ERROR_COPY.NETWORK_ERROR;
  if (errorCode === 'TIMEOUT') return ERROR_COPY.TIMEOUT;
  if (errorCode?.startsWith('HTTP_5') || errorCode === 'SERVER_ERROR') return ERROR_COPY.SERVER_ERROR;
  if (errorCode === 'HTTP_410' || errorCode === 'SOURCE_MASTER_UNAVAILABLE' || errorCode === 'ASSIGNMENT_REVOKED' || errorCode === 'JOB_NOT_ACTIVE') return ERROR_COPY.UNAVAILABLE;
  if (errorCode === 'INVALID_RESPONSE') return ERROR_COPY.INVALID_RESPONSE;
  return ERROR_COPY.UNKNOWN_ERROR;
}

/**
 * JobLoadError — Dedicated error state for Job Detail load failures.
 *
 * Props:
 *   jobId    — string  — jobId from route param
 *   error    — object  — structured error from parseJobLoadError()
 *   onRetry  — fn      — re-runs loadData without leaving the page
 *   navigate — fn      — React Router navigate fn (passed in from JobDetail)
 */
export default function JobLoadError({ jobId, error, onRetry, navigate }) {
  const [stackOpen, setStackOpen] = useState(false);
  const { navigateBackToJobs } = useJobsListState();

  const { errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId } = error || {};
  const copy = getCopy(errorCode);
  const Icon = copy.icon;

  const handleBack = () => navigateBackToJobs(navigate);

  return (
    <div className="min-h-screen bg-app-bg flex flex-col">
      {/* Header — same structure as JobDetail header */}
      <div
        className="bg-app-surface border-b border-app-border sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <button
          onClick={handleBack}
          className="icon-btn no-select touch-active"
          aria-label="Back to Jobs"
        >
          <ArrowLeft size={22} className="text-app-text-2" />
        </button>
        <span className="font-semibold text-app-text flex-1 truncate">Job Detail</span>
      </div>

      {/* Error body */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Icon */}
        <div className={`w-14 h-14 rounded-2xl ${copy.bgCls} flex items-center justify-center mb-5`}>
          <Icon size={26} className={copy.iconCls} />
        </div>

        {/* Title & body */}
        <h1 className="text-lg font-bold text-app-text text-center mb-2">{copy.title}</h1>
        <p className="text-sm text-app-text-2 text-center leading-relaxed max-w-xs mb-3">{copy.body}</p>

        {/* Footer copy (may contain newlines for paragraph breaks) */}
        {copy.footer && (
          <div className="text-xs text-app-text-muted text-center leading-relaxed max-w-xs mb-6 space-y-1.5">
            {copy.footer.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        )}
        {!copy.footer && <div className="mb-6" />}

        {/* Always-visible meta — Job ID + error code */}
        {(jobId || errorCode) && (
          <div className="w-full max-w-xs mb-6 rounded-xl bg-app-elevated border border-app-border divide-y divide-app-divider text-xs">
            {jobId && (
              <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                <span className="text-app-text-muted font-medium">Job ID</span>
                <span className="font-mono text-app-text-2 truncate">{jobId}</span>
              </div>
            )}
            {errorCode && (
              <div className="flex items-center justify-between px-4 py-2.5 gap-3">
                <span className="text-app-text-muted font-medium">Error code</span>
                <span className="font-mono text-app-text-2">{errorCode}</span>
              </div>
            )}
            {IS_DEV && technicalReason && (
              <div className="flex items-start justify-between px-4 py-2.5 gap-3">
                <span className="text-app-text-muted font-medium flex-shrink-0">Reason</span>
                <span className="text-app-text-2 text-right">{technicalReason}</span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="w-full max-w-xs flex flex-col gap-3">
          <button
            onClick={onRetry}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-app-accent text-app-accent-text font-semibold text-sm no-select touch-active"
          >
            <RefreshCw size={15} />
            Try Again
          </button>
          <button
            onClick={handleBack}
            className="w-full py-3 px-4 rounded-xl border border-app-border text-app-text-2 font-medium text-sm no-select touch-active"
          >
            Back to Jobs
          </button>
        </div>

        {/* Dev-only panel */}
        {IS_DEV && (httpStatus || backendMessage || stackTrace || requestId) && (
          <div className="w-full max-w-xs mt-8 rounded-xl border border-app-warning/40 bg-app-warning-bg overflow-hidden text-xs">
            <div className="px-4 py-2.5 border-b border-app-warning/20">
              <span className="font-bold text-app-warning uppercase tracking-wide">Dev Info</span>
            </div>
            <div className="px-4 py-3 space-y-2">
              {httpStatus && (
                <div className="flex justify-between gap-2">
                  <span className="text-app-text-muted font-medium">HTTP status</span>
                  <span className="font-mono text-app-text-2">{httpStatus}</span>
                </div>
              )}
              {requestId && (
                <div className="flex justify-between gap-2">
                  <span className="text-app-text-muted font-medium">Request ID</span>
                  <span className="font-mono text-app-text-2 truncate">{requestId}</span>
                </div>
              )}
              {backendMessage && (
                <div className="mt-1">
                  <span className="text-app-text-muted font-medium block mb-1">Backend message</span>
                  <p className="text-app-text-2 font-mono break-words whitespace-pre-wrap">{backendMessage}</p>
                </div>
              )}
              {stackTrace && (
                <div className="mt-1">
                  <button
                    onClick={() => setStackOpen(o => !o)}
                    className="flex items-center gap-1 text-app-text-muted font-medium touch-active"
                  >
                    {stackOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    Stack trace
                  </button>
                  {stackOpen && (
                    <pre className="mt-2 text-app-text-2 font-mono text-[10px] break-words whitespace-pre-wrap overflow-auto max-h-48 leading-relaxed">
                      {stackTrace}
                    </pre>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ height: 'env(safe-area-inset-bottom)' }} />
    </div>
  );
}

// ── parseJobLoadError ─────────────────────────────────────────────────────────
/**
 * Normalises any thrown value into a structured error object for JobLoadError.
 * Logs every failure to the console unconditionally.
 */
export function parseJobLoadError(err, jobId) {
  // Log every failure unconditionally
  console.error('[JobDetail] Load failure', {
    jobId,
    route: window.location.pathname,
    error: err,
    timestamp: new Date().toISOString(),
  });

  const base = {
    errorCode: null,
    httpStatus: null,
    technicalReason: null,
    backendMessage: null,
    stackTrace: IS_DEV ? (err?.stack || null) : null,
    requestId: null,
  };

  if (!err) return { ...base, errorCode: 'UNKNOWN_ERROR' };

  // Base44 SDK error shape: { status, data: { error, code, detail } }
  if (err?.status && err?.data !== undefined) {
    const code = err.data?.code || `HTTP_${err.status}`;
    return {
      ...base,
      errorCode: code,
      httpStatus: err.status,
      backendMessage: IS_DEV ? (err.data?.error || err.data?.detail || null) : null,
      technicalReason: IS_DEV ? `HTTP ${err.status} — ${err.data?.error || ''}` : null,
      requestId: err.data?.requestId || null,
    };
  }

  // Invalid response shape
  if (err?.code === 'INVALID_RESPONSE') {
    return { ...base, errorCode: 'INVALID_RESPONSE', technicalReason: IS_DEV ? err.message : null };
  }

  // Network error
  if (err instanceof TypeError && err.message?.toLowerCase().includes('fetch')) {
    return { ...base, errorCode: 'NETWORK_ERROR', technicalReason: IS_DEV ? err.message : null };
  }

  // Timeout / abort
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.message?.toLowerCase().includes('timeout')) {
    return { ...base, errorCode: 'TIMEOUT', technicalReason: IS_DEV ? err.message : null };
  }

  // Plain Error
  if (err instanceof Error) {
    return { ...base, errorCode: err.code || 'RESOLVER_ERROR', technicalReason: IS_DEV ? err.message : null };
  }

  if (typeof err === 'string') {
    return { ...base, errorCode: 'UNKNOWN_ERROR', technicalReason: IS_DEV ? err : null };
  }

  return { ...base, errorCode: 'UNKNOWN_ERROR' };
}