import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Send, ExternalLink } from 'lucide-react';
import { SECTION_MAP } from '@/lib/constants';

const SUGGESTED_QUESTIONS = [
  'Which jobs require a respirator?',
  'What tools are needed for an exterior door replacement?',
  'Summarize the crawlspace inspection procedure.',
  'What photos are required for a water heater replacement?',
];

export default function Assistant() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [allContent, setAllContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [searching, setSearching] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    Promise.all([
      base44.entities.Job.list('-updated_date', 200),
      base44.entities.SectionContent.list('-sortOrder', 500),
    ]).then(([j, c]) => { setJobs(j || []); setAllContent(c || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, searching]);

  const handleAsk = async (question) => {
    const q = (question || input).trim();
    if (!q) return;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: q }]);
    setSearching(true);

    setTimeout(() => {
      const result = searchJobs(q, jobs, allContent);
      setSearching(false);
      setMessages(prev => [...prev, result]);
    }, 500);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="bg-white border-b border-neutral-200 px-4 py-4">
        <h1 className="text-xl font-bold text-neutral-900">Assistant</h1>
        <p className="text-xs text-neutral-500 mt-1">Ask questions about your company's jobs, procedures, tools, materials, safety requirements, and documentation.</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && !searching && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-neutral-500 uppercase mb-2">Suggested Questions</p>
            {SUGGESTED_QUESTIONS.map(q => (
              <button key={q} onClick={() => handleAsk(q)} className="w-full text-left px-4 py-3 bg-white border border-neutral-200 rounded-xl text-sm text-neutral-700 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'flex justify-end' : ''}>
            {msg.role === 'user' ? (
              <div className="bg-blue-600 text-white px-4 py-2.5 rounded-2xl rounded-br-md max-w-[85%]">
                <p className="text-sm">{msg.text}</p>
              </div>
            ) : (
              <div className="bg-white border border-neutral-200 rounded-2xl rounded-bl-md p-4 max-w-[95%] w-full">
                <p className="text-sm text-neutral-700 whitespace-pre-wrap mb-3">{msg.text}</p>
                {msg.sources && msg.sources.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-neutral-500 uppercase mb-2">Sources</p>
                    <div className="space-y-2">
                      {msg.sources.map((src, j) => (
                        <div key={j} className="flex items-center justify-between gap-2 p-2.5 bg-neutral-50 rounded-lg">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-900 truncate">{src.jobTitle}</p>
                            <p className="text-xs text-neutral-500">{src.section} · {src.item}</p>
                          </div>
                          <button onClick={() => navigate(`/jobs/${src.jobId}/${src.sectionType}`)}
                            className="flex-shrink-0 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium flex items-center gap-1">
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
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <div className="w-4 h-4 border-2 border-neutral-200 border-t-blue-600 rounded-full animate-spin"></div>
              Searching company jobs...
            </div>
          </div>
        )}
      </div>

      <div className="bg-white border-t border-neutral-200 p-3">
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAsk()}
            placeholder="Ask a question..."
            className="flex-1 px-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-full text-sm focus:outline-none focus:border-blue-500" />
          <button onClick={() => handleAsk()} disabled={!input.trim()}
            className="w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center disabled:bg-neutral-300 flex-shrink-0">
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function searchJobs(query, jobs, allContent) {
  const q = query.toLowerCase();
  const keywords = q.split(/\s+/).filter(w => w.length > 2);

  const matchingJobs = new Set();
  const sources = [];
  const summaryParts = [];

  // Search job fields
  for (const job of jobs) {
    if (job.isArchived || job.status !== 'Published') continue;
    const jobText = [job.title, job.shortDescription, job.trade, job.category, ...(job.tags || [])].join(' ').toLowerCase();
    if (keywords.some(k => jobText.includes(k))) {
      matchingJobs.add(job.id);
    }
  }

  // Search content
  const contentByJob = {};
  for (const item of allContent) {
    if (!contentByJob[item.jobId]) contentByJob[item.jobId] = [];
    contentByJob[item.jobId].push(item);
    const itemText = [item.title, item.body, item.metadata?.specification || '', item.metadata?.requiredAction || ''].join(' ').toLowerCase();
    if (keywords.some(k => itemText.includes(k))) {
      matchingJobs.add(item.jobId);
    }
  }

  if (matchingJobs.size === 0) {
    return {
      role: 'assistant',
      text: 'I could not find enough approved company information to answer that. Try another search or ask an administrator to add the missing information.',
      sources: [],
    };
  }

  // Build response
  for (const jobId of matchingJobs) {
    const job = jobs.find(j => j.id === jobId);
    if (!job) continue;
    const contents = contentByJob[jobId] || [];

    // Check for specific question types
    const isRespiratorQuery = q.includes('respirator') || q.includes('respir');
    const isToolsQuery = q.includes('tool') || q.includes('equipment');
    const isProcedureQuery = q.includes('procedure') || q.includes('step') || q.includes('how') || q.includes('summarize');
    const isPhotoQuery = q.includes('photo') || q.includes('documentation') || q.includes('picture');
    const isSafetyQuery = q.includes('safety') || q.includes('hazard') || q.includes('ppe');
    const isMaterialsQuery = q.includes('material') || q.includes('supply') || q.includes('product');

    let jobParts = [];

    if (isRespiratorQuery) {
      const respiratorItems = contents.filter(c =>
        c.title.toLowerCase().includes('respirator') ||
        c.body?.toLowerCase().includes('respirator') ||
        c.metadata?.requiredAction?.toLowerCase().includes('respirator')
      );
      if (respiratorItems.length > 0) {
        jobParts.push('Requires a respirator — see Safety section.');
        respiratorItems.forEach(item => {
          sources.push({ jobId, jobTitle: job.title, sectionType: item.sectionType, section: SECTION_MAP[item.sectionType]?.title || item.sectionType, item: item.title });
        });
      } else {
        continue; // Don't include this job if it doesn't mention respirator
      }
    } else {
      if (isToolsQuery || (!isProcedureQuery && !isPhotoQuery && !isSafetyQuery && !isMaterialsQuery)) {
        const tools = contents.filter(c => c.sectionType === 'tools');
        if (tools.length > 0) {
          const reqTools = tools.filter(t => t.isRequired).map(t => t.title).join(', ');
          jobParts.push(`Tools: ${reqTools || tools.map(t => t.title).join(', ')}`);
          if (tools[0]) sources.push({ jobId, jobTitle: job.title, sectionType: 'tools', section: 'Tools', item: tools[0].title });
        }
      }
      if (isProcedureQuery || (!isToolsQuery && !isPhotoQuery && !isSafetyQuery && !isMaterialsQuery)) {
        const steps = contents.filter(c => c.sectionType === 'procedure');
        if (steps.length > 0) {
          jobParts.push(`Procedure: ${steps.length} steps starting with "${steps[0].title}"`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'procedure', section: 'Procedure', item: steps[0].title });
        }
      }
      if (isSafetyQuery || (!isToolsQuery && !isProcedureQuery && !isPhotoQuery && !isMaterialsQuery)) {
        const safety = contents.filter(c => c.sectionType === 'safety');
        if (safety.length > 0) {
          const critical = safety.filter(s => s.isCritical);
          jobParts.push(`Safety: ${critical.length} critical item(s) — ${critical.map(s => s.title).join(', ')}`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'safety', section: 'Safety', item: safety[0].title });
        }
      }
      if (isPhotoQuery || (!isToolsQuery && !isProcedureQuery && !isSafetyQuery && !isMaterialsQuery)) {
        const docs = contents.filter(c => c.sectionType === 'documentation');
        if (docs.length > 0) {
          const reqDocs = docs.filter(d => d.isRequired);
          jobParts.push(`Documentation: ${reqDocs.length} required — ${reqDocs.map(d => d.title).join(', ')}`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'documentation', section: 'Documentation', item: docs[0].title });
        }
      }
      if (isMaterialsQuery) {
        const mats = contents.filter(c => c.sectionType === 'materials');
        if (mats.length > 0) {
          const reqMats = mats.filter(m => m.isRequired).map(m => `${m.title} (${m.metadata?.quantity || 1} ${m.metadata?.unit || ''})`).join(', ');
          jobParts.push(`Materials: ${reqMats}`);
          sources.push({ jobId, jobTitle: job.title, sectionType: 'materials', section: 'Materials', item: mats[0].title });
        }
      }
    }

    if (jobParts.length > 0) {
      summaryParts.push(`**${job.title}**\n${jobParts.join('\n')}`);
    }
  }

  if (summaryParts.length === 0) {
    return {
      role: 'assistant',
      text: 'I could not find enough approved company information to answer that. Try another search or ask an administrator to add the missing information.',
      sources: [],
    };
  }

  // Deduplicate sources
  const uniqueSources = [];
  const seen = new Set();
  for (const s of sources) {
    const key = `${s.jobId}_${s.sectionType}`;
    if (!seen.has(key)) { seen.add(key); uniqueSources.push(s); }
  }

  return {
    role: 'assistant',
    text: summaryParts.join('\n\n'),
    sources: uniqueSources.slice(0, 6),
  };
}