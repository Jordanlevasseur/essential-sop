import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Send, ExternalLink } from 'lucide-react';
import { SECTION_MAP } from '@/lib/constants';
import { useCompany } from '@/lib/CompanyContext';
import { useAssistantViewport } from '@/lib/assistantViewport';

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
  const [jobs, setJobs] = useState([]);
  const [contentIndex, setContentIndex] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef(null);
  // Single source of truth (shared with Layout): visualViewport height +
  // offsetTop + keyboard-open flag. The fixed chat surface is sized to the
  // visible area; Layout hides the bottom nav on this route while the keyboard
  // is open so the composer never sits behind it.
  const { vpHeight, vpOffsetTop, keyboardOpen } = useAssistantViewport();

  useEffect(() => {
    if (!companyId) { setLoading(false); return; }
    setJobs([]); setContentIndex([]); setMessages([]);
    setLoading(true);
    // Use resolver-backed service so provisioned SOP content (including overrides)
    // is visible to search. No merge logic lives in this component.
    base44.functions.invoke('resolveJobsForAssistant', { companyId })
      .then(res => {
        setJobs(res?.data?.jobs || []);
        setContentIndex(res?.data?.contentIndex || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, searching]);

  const handleAsk = useCallback((question) => {
    const q = (question || input).trim();
    if (!q || searching) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setSearching(true);
    setTimeout(() => {
      const result = searchJobs(q, jobs, contentIndex);
      setSearching(false);
      setMessages(prev => [...prev, result]);
    }, 500);
  }, [input, searching, jobs, contentIndex]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-app-bg">
        <div className="w-8 h-8 border-4 border-app-border border-t-app-accent rounded-full animate-spin" />
      </div>
    );
  }

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
          <div key={i} className={msg.role === 'user' ? 'flex justify-end' : ''}>
            {msg.role === 'user' ? (
              <div className="bg-app-accent text-app-accent-text px-4 py-2.5 rounded-2xl rounded-br-md max-w-[85%]">
                <p className="text-sm">{msg.text}</p>
              </div>
            ) : (
              <div className="bg-app-card border border-app-border rounded-2xl rounded-bl-md p-4 max-w-[95%] w-full">
                <p className="text-sm text-app-text whitespace-pre-wrap mb-3 selectable">{msg.text}</p>
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
              Searching company jobs...
            </div>
          </div>
        )}
      </div>

      <div
        className="bg-app-surface border-t border-app-border p-3 flex-shrink-0"
        style={{ paddingBottom: keyboardOpen ? '0.5rem' : 'calc(60px + env(safe-area-inset-bottom))' }}
      >
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !searching && handleAsk()}
            placeholder="Ask a question..."
            aria-label="Ask a question"
            enterKeyHint="send"
            className="flex-1 min-w-0 px-4 py-2.5 bg-app-input border border-app-border rounded-lg text-sm text-app-text placeholder:text-app-text-muted focus:outline-none focus:border-app-accent"
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

// Search function now operates on the resolver-backed contentIndex.
// The contentIndex includes provisioned SOP content (master + override) from the server.
// No merge logic here — results come pre-resolved.
function searchJobs(query, jobs, contentIndex) {
  const q = query.toLowerCase();
  const keywords = q.split(/\s+/).filter(w => w.length > 2);
  const matchingJobs = new Set();
  const sources = [];
  const summaryParts = [];

  for (const job of jobs) {
    if (job.isArchived || job.status !== 'Published') continue;
    const jobText = [job.title, job.shortDescription, job.trade, job.category, ...(job.tags || [])].join(' ').toLowerCase();
    if (keywords.some(k => jobText.includes(k))) matchingJobs.add(job.id);
  }

  const contentByJob = {};
  for (const item of contentIndex) {
    if (!contentByJob[item.jobId]) contentByJob[item.jobId] = [];
    contentByJob[item.jobId].push(item);
    const itemText = [item.title, item.body || ''].join(' ').toLowerCase();
    if (keywords.some(k => itemText.includes(k))) matchingJobs.add(item.jobId);
  }

  if (matchingJobs.size === 0) {
    return { role: 'assistant', text: 'I could not find enough approved company information to answer that. Try another search or ask an administrator to add the missing information.', sources: [] };
  }

  for (const jobId of matchingJobs) {
    const job = jobs.find(j => j.id === jobId);
    if (!job) continue;
    const contents = contentByJob[jobId] || [];
    const isRespiratorQuery = q.includes('respirator') || q.includes('respir');
    const isToolsQuery = q.includes('tool') || q.includes('equipment');
    const isProcedureQuery = q.includes('procedure') || q.includes('step') || q.includes('how') || q.includes('summarize');
    const isQualityQuery = q.includes('quality') || q.includes('standard') || q.includes('acceptable');
    const isSafetyQuery = q.includes('safety') || q.includes('hazard') || q.includes('ppe');
    const isMaterialsQuery = q.includes('material') || q.includes('supply') || q.includes('product');
    let jobParts = [];

    if (isRespiratorQuery) {
      const respiratorItems = contents.filter(c =>
        c.title.toLowerCase().includes('respirator') ||
        (c.body || '').toLowerCase().includes('respirator')
      );
      if (respiratorItems.length > 0) {
        jobParts.push('Requires a respirator — see Safety section.');
        respiratorItems.forEach(item => {
          sources.push({ jobId, jobTitle: job.title, sectionType: item.sectionType, section: SECTION_MAP[item.sectionType]?.title || item.sectionType, item: item.title });
        });
      } else { continue; }
    } else {
      if (isToolsQuery || (!isProcedureQuery && !isQualityQuery && !isSafetyQuery && !isMaterialsQuery)) {
        const tools = contents.filter(c => c.sectionType === 'tools');
        if (tools.length > 0) {
          jobParts.push(`Tools: ${tools.map(t => t.title).join(', ')}`);
          if (tools[0]) sources.push({ jobId, jobTitle: job.title, sectionType: 'tools', section: 'Tools', item: tools[0].title });
        }
      }
      if (isProcedureQuery || (!isToolsQuery && !isQualityQuery && !isSafetyQuery && !isMaterialsQuery)) {
        const steps = contents.filter(c => c.sectionType === 'procedure');
        if (steps.length > 0) {
          jobParts.push(`Procedure: ${steps.length} steps starting with "${steps[0].title}"`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'procedure', section: 'Procedure', item: steps[0].title });
        }
      }
      if (isSafetyQuery || (!isToolsQuery && !isProcedureQuery && !isQualityQuery && !isMaterialsQuery)) {
        const safety = contents.filter(c => c.sectionType === 'safety');
        if (safety.length > 0) {
          jobParts.push(`Safety: ${safety.length} item(s) — ${safety.map(s => s.title).join(', ')}`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'safety', section: 'Safety', item: safety[0].title });
        }
      }
      if (isQualityQuery || (!isToolsQuery && !isProcedureQuery && !isSafetyQuery && !isMaterialsQuery)) {
        const quality = contents.filter(c => c.sectionType === 'quality');
        if (quality.length > 0) {
          jobParts.push(`Quality Standards: ${quality.map(q => q.title).slice(0, 3).join(', ')}`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'quality', section: 'Quality Standards', item: quality[0].title });
        }
      }
      if (isMaterialsQuery) {
        const mats = contents.filter(c => c.sectionType === 'materials');
        if (mats.length > 0) {
          jobParts.push(`Materials: ${mats.map(m => m.title).join(', ')}`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'materials', section: 'Materials', item: mats[0].title });
        }
      }
    }
    if (jobParts.length > 0) summaryParts.push(`**${job.title}**\n${jobParts.join('\n')}`);
  }

  if (summaryParts.length === 0) {
    return { role: 'assistant', text: 'I could not find enough approved company information to answer that. Try another search or ask an administrator to add the missing information.', sources: [] };
  }

  const uniqueSources = [];
  const seen = new Set();
  for (const s of sources) {
    const key = `${s.jobId}_${s.sectionType}`;
    if (!seen.has(key)) { seen.add(key); uniqueSources.push(s); }
  }
  return { role: 'assistant', text: summaryParts.join('\n\n'), sources: uniqueSources.slice(0, 6) };
}