import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Send, ExternalLink } from 'lucide-react';
import { useCompany } from '@/lib/CompanyContext';
import { useAssistantViewport } from '@/lib/assistantViewport';
import AssistantMessage from '@/components/assistant/AssistantMessage';

const SUGGESTED_QUESTIONS = [
  'Which jobs require a respirator?',
  'What tools are needed for an exterior door replacement?',
  'Summarize the crawlspace inspection procedure.',
  'What are the quality standards for a gutter repair?',
];

export default function Assistant() {
  const navigate = useNavigate();
  const { activeCompany } = useCompany();
  const companyId = activeCompany?.id;
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef(null);
  const lastJobIdsRef = useRef([]);
  // Refs to each rendered message wrapper + last-seen message count, used only
  // to top-align a newly arrived Assistant answer. No repositioning on keyboard
  // or viewport changes.
  const messageRefs = useRef([]);
  const prevLenRef = useRef(0);
  // Auto-expanding composer textarea: grows with content up to 5 lines, then
  // scrolls internally. Sized by measuring scrollHeight after each input change
  // (including the clear-after-send), capped to the CSS max-height (5 lines).
  const textareaRef = useRef(null);
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = parseFloat(window.getComputedStyle(el).maxHeight) || 0;
    el.style.height = (max ? Math.min(el.scrollHeight, max) : el.scrollHeight) + 'px';
  }, []);
  // Single source of truth (shared with Layout): visualViewport height +
  // offsetTop + keyboard-open flag. The fixed chat surface is sized to the
  // visible area; Layout hides the bottom nav on this route while the keyboard
  // is open so the composer never sits behind it.
  const { vpHeight, vpOffsetTop, keyboardOpen } = useAssistantViewport();

  // Reset conversation context when the active company changes.
  useEffect(() => {
    if (!companyId) return;
    setMessages([]);
    lastJobIdsRef.current = [];
  }, [companyId]);

  // Position a newly arrived Assistant answer with its TOP at the top of the
  // scrollable conversation region (heading + first lines visible immediately)
  // instead of jumping to the bottom. A new user message keeps the existing
  // bottom behavior so the user sees their message + the "Thinking…" indicator.
  // Only message appends trigger repositioning — never keyboard/viewport
  // changes, source-card rendering, or in-place updates. Positioning is
  // immediate (no smooth animation) and clamped by the browser, so a short
  // answer never leaves forced blank space.
  useEffect(() => {
    const len = messages.length;
    if (len === prevLenRef.current) return;
    const grew = len > prevLenRef.current;
    prevLenRef.current = len;
    if (!grew) return; // messages cleared (company change) — no reposition
    const last = messages[len - 1];
    if (!last) return;
    const container = scrollRef.current;
    if (!container) return;
    if (last.role === 'assistant') {
      const node = messageRefs.current[len - 1];
      if (!node) return;
      const cRect = container.getBoundingClientRect();
      const nRect = node.getBoundingClientRect();
      const paddingTop = parseFloat(window.getComputedStyle(container).paddingTop) || 0;
      container.scrollTop += nRect.top - cRect.top - paddingTop;
    } else {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Keep the textarea height in sync with its content — both while typing and
  // after a send clears the field. Runs after DOM commit so scrollHeight is fresh.
  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  const handleAsk = useCallback(async (question) => {
    const q = (question || input).trim();
    if (!q || searching) return;
    setInput('');
    const history = messages.slice(-8).map(m => ({ role: m.role, text: m.text }));
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setSearching(true);
    try {
      const res = await base44.functions.invoke('askAssistant', {
        companyId,
        question: q,
        history,
        focusJobIds: lastJobIdsRef.current,
      });
      const data = res?.data || {};
      const answer = data.answer || 'I could not generate an answer. Please try again.';
      const sources = Array.isArray(data.sources) ? data.sources : [];
      setMessages(prev => [...prev, { role: 'assistant', text: answer, sources }]);
      lastJobIdsRef.current = sources.map(s => s.jobId).filter(Boolean);
    } catch (e) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: 'Something went wrong reaching the assistant. Please try again.',
        sources: [],
      }]);
    } finally {
      setSearching(false);
    }
  }, [input, searching, companyId, messages]);

  return (
    <div
      className="flex flex-col bg-app-bg max-w-2xl mx-auto"
      style={{
        position: 'fixed',
        top: `${vpOffsetTop}px`,
        left: 0,
        right: 0,
        height: `${vpHeight}px`,
        paddingTop: `max(env(safe-area-inset-top) - ${vpOffsetTop}px, 0px)`,
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      <div className="bg-app-surface border-b border-app-border px-3 py-2 flex-shrink-0">
        <h1 className="text-xl font-bold text-app-heading">Assistant</h1>
        <p className="text-xs text-app-text-muted mt-0.5">Ask about jobs, procedures, tools, materials, and safety.</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 overscroll-contain">
        {messages.length === 0 && !searching && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-app-text-muted uppercase mb-1">Suggested Questions</p>
            {SUGGESTED_QUESTIONS.map(q => (
              <button key={q} onClick={() => handleAsk(q)}
                className="w-full text-left px-3 py-2.5 bg-app-card border border-app-border rounded-lg text-sm text-app-text hover:border-app-accent transition-colors no-select touch-active">
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} ref={(el) => { messageRefs.current[i] = el; }} className={msg.role === 'user' ? 'flex justify-end' : ''}>
            {msg.role === 'user' ? (
              <div className="bg-app-accent text-app-accent-text px-4 py-2.5 rounded-2xl rounded-br-md max-w-[85%]">
                <p className="text-sm">{msg.text}</p>
              </div>
            ) : (
              <div className="bg-app-card border border-app-border rounded-2xl rounded-bl-md p-4 max-w-[95%] w-full">
                <div className="mb-3 selectable"><AssistantMessage text={msg.text} /></div>
                {msg.sources && msg.sources.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-app-text-muted uppercase mb-2">Sources</p>
                    <div className="space-y-2">
                      {msg.sources.map((src, j) => (
                        <div key={j} className="flex items-center justify-between gap-2 p-2.5 bg-app-elevated rounded-lg border border-app-border">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-app-text truncate">{src.jobTitle}</p>
                            <p className="text-xs text-app-text-muted">{src.section} · {src.item}</p>
                          </div>
                          <button onClick={() => navigate(`/jobs/${src.jobId}/${src.sectionType}`)}
                            className="flex-shrink-0 px-2.5 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium flex items-center gap-1">
                            Open <ExternalLink size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {searching && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-sm text-app-text-muted">
              <div className="w-4 h-4 border-2 border-app-border border-t-app-accent rounded-full animate-spin" />
              Thinking...
            </div>
          </div>
        )}
      </div>

      <div
        className="bg-app-surface border-t border-app-border p-3 flex-shrink-0"
        style={{ paddingBottom: keyboardOpen ? '0.5rem' : 'calc(60px + env(safe-area-inset-bottom))' }}
      >
        <div className="flex gap-3 items-center">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask a question..."
            aria-label="Ask a question"
            rows={1}
            className="flex-1 min-w-0 min-h-[44px] max-h-[144px] overflow-y-auto resize-none px-4 py-3 leading-6 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
          />
          <button
            onClick={() => handleAsk()}
            disabled={!input.trim() || searching}
            aria-label="Send message"
            className="w-11 h-11 bg-app-accent text-app-accent-text rounded-lg flex items-center justify-center disabled:bg-app-disabled disabled:text-app-text-disabled flex-shrink-0 touch-active"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}