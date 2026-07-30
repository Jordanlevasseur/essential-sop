import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';

const IS_DEV = import.meta.env.DEV;

/**
 * JobLoadError — Dedicated error state for Job Detail load failures.
 *
 * Always renders — never blank, never silent redirect.
 *
 * Props:
 *   jobId       — string  — the jobId from the route param
 *   error       — object  — structured error from parseJobLoadError()
 *   onRetry     — fn      — re-runs loadData without leaving the page
 */
export default function JobLoadError({ jobId, error, onRetry }) {
  const navigate = useNavigate();
  const [stackOpen, setStackOpen] = useState(false);

  const { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId } = error || {};

  return (
    <div className="min-h-screen bg-app-bg flex flex-col">
      {/* Minimal header — keeps the user oriented */}
      <div
        className="bg-app-surface border-b border-app-border sticky top-0 z-40 flex items-center gap-3 px-4 py-3"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <button
          onClick={() => navigate('/')}
          className="icon-btn no-select touch-active"
          aria-label="Back to Jobs"
        >
          <ArrowLeft size={22} className="text-app-text-2" />
        </button>
        <span className="font-semibold text-app-text-muted flex-1 truncate text-sm">Job Detail</span>
      </div>

      {/* Error body */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Icon */}
        <div className="w-14 h-14 rounded-2xl bg-app-danger-bg flex items-center justify-center mb-5">
          <AlertTriangle size={26} className="text-app-danger" />
        </div>

        {/* Title & body */}
        <h1 className="text-lg font-bold text-app-text text-center mb-2">
          {title || 'Unable to load this Job'}
        </h1>
        <p className="text-sm text-app-text-2 text-center leading-relaxed max-w-xs mb-6">
          {body || "We couldn't load this Job right now. This may be a temporary problem or the Job may no longer be available."}
        </p>

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
            onClick={() => navigate('/')}
            className="w-full py-3 px-4 rounded-xl border border-app-border text-app-text-2 font-medium text-sm no-select touch-active"
          >
            Back to Jobs
          </button>
        </div>

        {/* Dev-only panel */}
        {IS_DEV && (httpStatus || backendMessage || stackTrace || requestId) && (
          <div className="w-full max-w-xs mt-8 rounded-xl border border-app-warning/40 bg-app-warning-bg overflow-hidden text-xs">
            <div className="px-4 py-2.5 flex items-center gap-2 border-b border-app-warning/20">
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

/**
 * parseJobLoadError — Normalises any thrown value into a structured error object
 * suitable for JobLoadError props. Call this inside the loadData catch block.
 *
 * Handles:
 *   - Base44 SDK function errors (res.status, res.data.error, res.data.code)
 *   - Network / timeout errors (TypeError, DOMException)
 *   - JSON schema / unexpected-shape errors
 *   - Plain JS Error objects
 *   - Unknown throws
 */
export function parseJobLoadError(err, jobId) {
  const IS_DEV = import.meta.env.DEV;

  // Log every failure unconditionally
  console.error('[JobDetail] Load failure', {
    jobId,
    route: window.location.pathname,
    error: err,
    timestamp: new Date().toISOString(),
  });

  // Base defaults
  let title = 'Unable to load this Job';
  let body = "We couldn't load this Job right now. This may be a temporary problem or the Job may no longer be available.";
  let errorCode = null;
  let httpStatus = null;
  let technicalReason = null;
  let backendMessage = null;
  let stackTrace = IS_DEV ? (err?.stack || null) : null;
  let requestId = null;

  if (!err) {
    errorCode = 'UNKNOWN_ERROR';
    return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
  }

  // Base44 SDK / fetch response error shape: { status, data: { error, code, detail } }
  if (err?.status && err?.data) {
    httpStatus = err.status;
    backendMessage = IS_DEV ? (err.data?.error || err.data?.detail || null) : null;
    errorCode = err.data?.code || `HTTP_${err.status}`;
    requestId = err.data?.requestId || null;

    if (err.status === 401 || err.status === 403) {
      title = 'Access denied';
      body = "You don't have permission to view this Job.";
      technicalReason = IS_DEV ? `HTTP ${err.status} — ${err.data?.error || 'Forbidden'}` : null;
    } else if (err.status === 404) {
      title = 'Job not found';
      body = 'This Job may have been deleted or the link may be incorrect.';
      technicalReason = IS_DEV ? 'HTTP 404 — Job not found' : null;
    } else if (err.status === 409) {
      technicalReason = IS_DEV ? `HTTP 409 — ${err.data?.error || 'Conflict'}` : null;
    } else if (err.status >= 500) {
      technicalReason = IS_DEV ? `HTTP ${err.status} — server error` : null;
    }
    return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
  }

  // Network / timeout
  if (err instanceof TypeError && err.message?.includes('fetch')) {
    errorCode = 'NETWORK_ERROR';
    technicalReason = IS_DEV ? err.message : null;
    body = "A network error occurred. Please check your connection and try again.";
    return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
  }
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.message?.toLowerCase().includes('timeout')) {
    errorCode = 'TIMEOUT';
    technicalReason = IS_DEV ? err.message : null;
    body = "The request timed out. Please try again.";
    return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
  }

  // Invalid response shape (missing job/sections/contentBySection)
  if (err?.code === 'INVALID_RESPONSE') {
    errorCode = 'INVALID_RESPONSE';
    technicalReason = IS_DEV ? err.message : null;
    return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
  }

  // Plain Error
  if (err instanceof Error) {
    errorCode = err.code || 'RESOLVER_ERROR';
    technicalReason = IS_DEV ? err.message : null;
    return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
  }

  // String throw
  if (typeof err === 'string') {
    errorCode = 'UNKNOWN_ERROR';
    technicalReason = IS_DEV ? err : null;
    return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
  }

  errorCode = 'UNKNOWN_ERROR';
  return { title, body, errorCode, httpStatus, technicalReason, backendMessage, stackTrace, requestId };
}