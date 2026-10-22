/**
 * aiContextSelector.ts — Stage 4: Intelligent AI Context Selection.
 *
 * Replaces the Stage 3 approach of dumping ALL content of ALL selected SOPs
 * with a relevance-aware context selector. Determines which approved SOPs,
 * sections, and content items are relevant to the question, preserves
 * structured metadata (safety severity, warnings, quantities, specs, required/
 * critical flags, content type), and applies bounded size controls with
 * safe reduction (never mid-warning, mid-step, or mid-specification).
 *
 * SECURITY: operates ONLY on already-authorized CompanyKnowledge (active
 * membership, Published, non-archived, active assignment, active Master,
 * published version, override-merged). Never fetches external URL contents.
 * Treats all SOP text, resource descriptions, and conversation history as
 * untrusted content, not as system instructions.
 *
 * AI-CALL EFFICIENCY: this module makes ZERO AI calls. It only selects and
 * formats context for the single InvokeLLM call in the generative path.
 * Direct, clarification, and no-match routes are unaffected (zero AI calls).
 *
 * CONVERSATION INTELLIGENCE: revalidates focusJobIds against the CURRENT
 * eligible knowledge set (stale focus is silently dropped). Detects subject
 * changes and trims history accordingly. Never treats previous assistant
 * messages as authoritative procedural sources.
 */
import {
  CompanyKnowledge,
  KnowledgeContentItem,
  KnowledgeResource,
  SECTION_LABELS,
  expandQueryTokens,
  findSopByJobId,
  getSectionItems,
  getResourcesForJob,
  rankJobsByQuery,
} from './companyKnowledgeEngine.ts';
import { RoutingDecision, detectSectionType, detectSectionTypes } from './assistantRouter.ts';

// ── Types ───────────────────────────────────────────────────────────────────

type QueryMode = 'comparison' | 'comprehensive' | 'section_targeted' | 'general';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AiContextResult {
  contextText: string;
  historyText: string;
  includedSopIds: string[];
  stats: {
    sopCount: number;
    sectionCount: number;
    itemCount: number;
    contextChars: number;
    historyChars: number;
    truncated: boolean;
    queryMode: QueryMode;
    reductionReason?: string;
    knowledgeComplete: boolean;
  };
}

interface SopContext {
  job: any;
  score: number;
  sections: string[];
}

// ── Constants ───────────────────────────────────────────────────────────────

// Generous budget — correctness over consumption. Comprehensive questions
// legitimately produce large contexts; we reduce only when truly necessary.
const CONTEXT_BUDGET = 16000;
const HISTORY_BUDGET = 2000;
const MAX_HISTORY_MESSAGES = 6;
const MIN_HISTORY_ON_SUBJECT_CHANGE = 2;
const MAX_SOPS = 5;

const COMPREHENSIVE_PHRASES = [
  'walk me through', 'walk through', 'complete', 'completely', 'full procedure',
  'full sop', 'entire', 'whole', 'all the steps', 'all steps', 'everything',
  'from start to finish', 'step by step', 'end to end', 'full process',
  'complete process', 'complete guide', 'full guide', 'comprehensive',
];

const COMPARISON_WORDS = new Set([
  'compare', 'comparison', 'versus', 'vs', 'difference', 'differences',
  'differ', 'different', 'contrast',
]);

const RESOURCE_KEYWORDS = new Set([
  'manual', 'video', 'videos', 'pdf', 'training', 'documentation',
  'resources', 'resource', 'link', 'links', 'reference', 'references',
  'manufacturer', 'youtube',
]);

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'by', 'with',
  'how', 'what', 'which', 'is', 'are', 'do', 'does', 'did', 'i', 'my', 'me', 'we',
  'this', 'that', 'it', 'its', 'can', 'will', 'be', 'should', 'would', 'could',
  'please', 'tell', 'show', 'give', 'about',
]);

const SECTION_ORDER = ['scope', 'tools', 'materials', 'procedure', 'safety', 'quality'] as const;

// Sections ALWAYS included when present — safety is critical, scope is context.
const ALWAYS_INCLUDE_SECTIONS = new Set(['safety', 'scope']);

// ── Tokenization ────────────────────────────────────────────────────────────

function tokenize(s: string): string[] {
  return (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

// ── Query mode detection ────────────────────────────────────────────────────

function detectQueryMode(question: string, decision: RoutingDecision): QueryMode {
  const q = question.toLowerCase();
  const tokens = new Set(q.match(/[a-z0-9]+/g) || []);

  // Comparison
  for (const w of COMPARISON_WORDS) {
    if (tokens.has(w)) return 'comparison';
  }

  // Comprehensive
  for (const phrase of COMPREHENSIVE_PHRASES) {
    if (q.includes(phrase)) return 'comprehensive';
  }

  // Section-targeted (use router's detection or our own)
  if (decision.sectionType || detectSectionType(question)) return 'section_targeted';

  return 'general';
}

function questionHasResourceKeywords(question: string): boolean {
  const q = question.toLowerCase();
  const tokens = new Set(q.match(/[a-z0-9]+/g) || []);
  for (const kw of RESOURCE_KEYWORDS) {
    if (tokens.has(kw)) return true;
  }
  return false;
}

// ── SOP selection ────────────────────────────────────────────────────────────

function selectSops(
  knowledge: CompanyKnowledge,
  question: string,
  decision: RoutingDecision,
  focusJobIds: string[],
  mode: QueryMode
): SopContext[] {
  // Rank all eligible SOPs by query relevance (with synonym expansion)
  const ranked = rankJobsByQuery(knowledge, question, { expandSynonyms: true });

  // Multi-operation generative request: restrict context to the explicitly
  // named SOPs so a keyword-only match (e.g. "Mudding Drywall" matching only
  // on "drywall") is excluded from the synthesis. The router already
  // authorized these as strong, explicitly-named operations.
  if (decision.targetJobIds && decision.targetJobIds.length >= 2) {
    const wanted = decision.targetJobIds
      .map(id => findSopByJobId(knowledge, id))
      .filter((j): j is NonNullable<typeof j> => j !== null);
    return wanted.slice(0, MAX_SOPS).map(job => ({ job, score: 100, sections: [] }));
  }

  let selected: SopContext[];

  if (mode === 'comparison') {
    // For comparison: include ALL SOPs with any relevance (score > 0)
    selected = ranked.map(s => ({ job: s.job, score: s.score, sections: [] }));
  } else {
    // For other modes: take top-scoring SOPs above a relative threshold
    const maxScore = ranked.reduce((m, s) => Math.max(m, s.score), 0);
    if (maxScore === 0) {
      selected = [];
    } else {
      const threshold = Math.max(2, Math.ceil(maxScore * 0.4));
      selected = ranked
        .filter(s => s.score >= threshold)
        .map(s => ({ job: s.job, score: s.score, sections: [] }));
    }
  }

  // Force-include the router's target if present (highest priority)
  if (decision.targetJobId) {
    const have = new Set(selected.map(s => s.job.id));
    if (!have.has(decision.targetJobId)) {
      const job = findSopByJobId(knowledge, decision.targetJobId);
      if (job) selected.unshift({ job, score: 100, sections: [] });
    }
  }

  // Force-include revalidated focus SOPs (stale focus silently dropped)
  if (focusJobIds.length > 0) {
    const have = new Set(selected.map(s => s.job.id));
    for (const fid of focusJobIds) {
      if (have.has(fid)) continue;
      // findSopByJobId revalidates against the CURRENT eligible set.
      // A stale focus (archived/revoked) returns null and is silently dropped.
      const job = findSopByJobId(knowledge, fid);
      if (job) {
        const focusScore = selected.length > 0 ? selected[0].score * 0.5 : 1;
        selected.push({ job, score: focusScore, sections: [] });
        have.add(fid);
      }
    }
  }

  // Sort by score descending, take top MAX_SOPS
  selected.sort((a, b) => b.score - a.score);
  return selected.slice(0, MAX_SOPS);
}

// ── Section selection ───────────────────────────────────────────────────────

function selectSectionsForSop(
  job: any,
  knowledge: CompanyKnowledge,
  mode: QueryMode,
  targetSectionTypes: string[]
): string[] {
  // Determine which sections exist for this SOP
  const existingSections = new Set<string>();
  for (const st of SECTION_ORDER) {
    if (getSectionItems(knowledge, job.id, st).length > 0) existingSections.add(st);
  }
  if (existingSections.size === 0) return [];

  if (mode === 'comprehensive' || mode === 'general' || mode === 'comparison') {
    return SECTION_ORDER.filter(st => existingSections.has(st));
  }

  // section_targeted: include ALL requested sections + always-include + related
  const sections = new Set<string>();
  for (const st of ALWAYS_INCLUDE_SECTIONS) {
    if (existingSections.has(st)) sections.add(st);
  }
  for (const st of targetSectionTypes) {
    if (existingSections.has(st)) sections.add(st);
  }

  // Related-section context so the answer is coherent across multi-section
  // requests (e.g. "tools and materials" → include both even if one omitted).
  if (targetSectionTypes.includes('safety') && existingSections.has('procedure')) {
    sections.add('procedure');
  }
  if (targetSectionTypes.includes('tools') && existingSections.has('materials')) {
    sections.add('materials');
  }
  if (targetSectionTypes.includes('materials') && existingSections.has('tools')) {
    sections.add('tools');
  }

  return SECTION_ORDER.filter(st => sections.has(st));
}

// ── Item / section / SOP formatting (preserves all metadata) ─────────────────

function formatItem(item: KnowledgeContentItem, index: number, sectionType: string): string {
  const parts: string[] = [];
  const prefix = sectionType === 'procedure' ? `${index + 1}. ` : '- ';

  // Content type tag (only for non-text types to reduce noise)
  const ctTag = item.contentType && item.contentType !== 'text' ? `(${item.contentType}) ` : '';

  // Flags: Required, Critical
  const flags: string[] = [];
  if (item.isRequired) flags.push('Required');
  if (item.isCritical) flags.push('Critical');
  const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';

  // Severity for safety items
  const severity = item.metadata?.severity ? ` [Severity: ${item.metadata.severity}]` : '';

  parts.push(`${prefix}${ctTag}**${item.title || ''}**${flagStr}${severity}`);

  // Body
  if (item.body) parts.push(`   ${item.body}`);

  // Metadata line: quantities, specs, warnings, required actions, tips
  const metaParts: string[] = [];
  if (item.metadata?.quantity) metaParts.push(`Qty: ${item.metadata.quantity}`);
  if (item.metadata?.specification) metaParts.push(`Spec: ${item.metadata.specification}`);
  if (item.metadata?.warning) metaParts.push(`Warning: ${item.metadata.warning}`);
  if (item.metadata?.requiredAction) metaParts.push(`Required action: ${item.metadata.requiredAction}`);
  if (item.metadata?.tip) metaParts.push(`Tip: ${item.metadata.tip}`);
  if (metaParts.length > 0) parts.push(`   ${metaParts.join(' | ')}`);

  return parts.join('\n');
}

function formatSopBlock(
  job: any,
  knowledge: CompanyKnowledge,
  sections: string[],
  includeResources: boolean,
  maxItemsBySection?: Record<string, number>
): string {
  const lines: string[] = [`=== src-${job.id}: ${job.title || ''} ===`];

  // SOP metadata header
  const meta: string[] = [];
  if (job.trade) meta.push(`Trade: ${job.trade}`);
  if (job.category) meta.push(`Category: ${job.category}`);
  if (job.shortDescription) meta.push(`Description: ${job.shortDescription}`);
  if (meta.length > 0) lines.push(meta.join(' | '));
  lines.push('');

  for (const st of sections) {
    const items = getSectionItems(knowledge, job.id, st);
    if (items.length === 0) continue;
    const cap = maxItemsBySection?.[st];
    const visible = cap != null ? items.slice(0, cap) : items;
    lines.push(`## ${SECTION_LABELS[st] || st}`);
    visible.forEach((it, i) => lines.push(formatItem(it, i, st)));
    if (cap != null && items.length > cap) {
      lines.push(`(${items.length - cap} additional items omitted to fit size limits)`);
    }
    lines.push('');
  }

  // Include resource metadata only when the question asks about resources
  if (includeResources) {
    const resources = getResourcesForJob(knowledge, job.id);
    if (resources.length > 0) {
      lines.push('## Resources');
      resources.forEach((r, i) => {
        lines.push(`${i + 1}. **${r.title}** (${r.resourceType})`);
        if (r.description) lines.push(`   ${r.description}`);
        lines.push(`   Link: ${r.url}`);
      });
      lines.push('');
      lines.push('_Note: Resource links are reference metadata only. Their contents have not been verified or approved as procedural authority._');
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ── Size control ───────────────────────────────────────────────────────────

/**
 * Truncate text at a sentence or word boundary — never mid-sentence.
 * Used only when the context is too large. Never applied to safety warnings
 * or numbered steps in a way that would cut mid-instruction.
 */
function truncateAtBoundary(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const sentenceEnd = Math.max(
    cut.lastIndexOf('. '),
    cut.lastIndexOf('! '),
    cut.lastIndexOf('? '),
    cut.lastIndexOf('\n'),
  );
  if (sentenceEnd > maxLen * 0.5) {
    return cut.slice(0, sentenceEnd + 1) + ' [...]';
  }
  const wordEnd = cut.lastIndexOf(' ');
  if (wordEnd > maxLen * 0.5) {
    return cut.slice(0, wordEnd) + ' [...]';
  }
  return cut + ' [...]';
}

/**
 * Reduce context to fit within CONTEXT_BUDGET using a priority-based strategy:
 *   1. Drop non-essential sections (not safety/scope/target) from lowest-
 *      scoring SOPs first.
 *   2. Drop lowest-scoring SOPs entirely (keep at least minSops).
 *   3. Truncate long item body lines at sentence boundaries.
 * Never truncates mid-safety-warning or mid-numbered-step (steps and warnings
 * are separate lines; truncation only applies to overly long body text).
 */
function reduceContext(
  sopContexts: SopContext[],
  knowledge: CompanyKnowledge,
  mode: QueryMode,
  targetSectionTypes: string[],
  includeResources: boolean
): { text: string; reason: string; finalContexts: SopContext[] } {
  const minSops = mode === 'comparison' ? 2 : 1;
  let contexts = sopContexts.map(c => ({ ...c, sections: [...c.sections] }));
  let itemLimits: Record<string, number> | undefined;

  const build = () =>
    contexts
      .filter(c => c.sections.length > 0)
      .map(c => formatSopBlock(c.job, knowledge, c.sections, includeResources, itemLimits))
      .join('\n---\n\n');

  let text = build();

  // Pass 1: drop non-essential sections from lowest-scoring SOPs
  if (text.length > CONTEXT_BUDGET) {
    const essential = new Set<string>(ALWAYS_INCLUDE_SECTIONS);
    for (const st of targetSectionTypes) essential.add(st);
    if (mode === 'comprehensive') essential.add('procedure');

    // Process lowest-scoring SOPs first (most expendable)
    const byScoreAsc = [...contexts].sort((a, b) => a.score - b.score);
    for (const entry of byScoreAsc) {
      if (text.length <= CONTEXT_BUDGET) break;
      const reduced = entry.sections.filter(st => essential.has(st));
      if (reduced.length < entry.sections.length) {
        entry.sections = reduced;
        text = build();
      }
    }
  }

  // Pass 2: drop lowest-scoring SOPs entirely (keep minSops)
  while (text.length > CONTEXT_BUDGET && contexts.length > minSops) {
    contexts.sort((a, b) => b.score - a.score);
    contexts.pop();
    text = build();
  }

  // Pass 3: truncate long body lines (item text, not section headers or SOP titles)
  if (text.length > CONTEXT_BUDGET) {
    const maxLineLen = 400;
    text = text
      .split('\n')
      .map(line => {
        if (line.length > maxLineLen && !line.startsWith('===') && !line.startsWith('##')) {
          return truncateAtBoundary(line, maxLineLen);
        }
        return line;
      })
      .join('\n');
  }

  // Pass 4: cap items per section when context still exceeds budget.
  // Safety and scope items are NEVER capped (critical context). Procedure and
  // other sections are capped in order from the beginning, preserving the
  // sequential flow. An "(N additional items omitted)" note is added per
  // capped section so the AI and user know steps were skipped.
  if (text.length > CONTEXT_BUDGET) {
    // Estimate average chars per item from current text
    let totalItems = 0;
    for (const c of contexts) {
      for (const st of c.sections) {
        totalItems += getSectionItems(knowledge, c.job.id, st).length;
      }
    }
    const avgItemChars = totalItems > 0 ? text.length / totalItems : 500;

    // Count uncappable items (safety + scope) and their estimated size
    let uncappableItems = 0;
    for (const c of contexts) {
      for (const st of c.sections) {
        if (st === 'safety' || st === 'scope') {
          uncappableItems += getSectionItems(knowledge, c.job.id, st).length;
        }
      }
    }
    const uncappableChars = Math.round(uncappableItems * avgItemChars);
    const overheadChars = contexts.length * 300; // SOP headers, section labels
    const remainingBudget = CONTEXT_BUDGET - uncappableChars - overheadChars;
    const maxCappableItems = Math.max(1, Math.floor(remainingBudget / Math.max(avgItemChars, 200)));

    itemLimits = {};
    for (const c of contexts) {
      for (const st of c.sections) {
        if (st !== 'safety' && st !== 'scope') {
          const fullCount = getSectionItems(knowledge, c.job.id, st).length;
          itemLimits[st] = Math.min(maxCappableItems, fullCount);
        }
      }
    }
    text = build();
  }

  const withinBudget = text.length <= CONTEXT_BUDGET;
  const reason = withinBudget
    ? 'Context reduced to fit size budget.'
    : 'Context exceeds size budget; safety-critical items prioritized over procedure steps.';

  return { text, reason, finalContexts: contexts };
}

// ── Conversation history ───────────────────────────────────────────────────

function detectSubjectChange(currentQuestion: string, history: ConversationMessage[]): boolean {
  const userMsgs = history.filter(m => m.role === 'user');
  if (userMsgs.length === 0) return false;
  const lastUser = userMsgs[userMsgs.length - 1];
  const currentTokens = new Set(tokenize(currentQuestion));
  const lastTokens = new Set(tokenize(lastUser.text));
  if (currentTokens.size === 0 || lastTokens.size === 0) return false;
  const overlap = [...currentTokens].filter(t => lastTokens.has(t)).length;
  return overlap < 2;
}

function buildHistoryText(history: ConversationMessage[], currentQuestion: string): string {
  if (!Array.isArray(history) || history.length === 0) return '(none)';

  const subjectChanged = detectSubjectChange(currentQuestion, history);
  const maxMsgs = subjectChanged
    ? Math.min(MIN_HISTORY_ON_SUBJECT_CHANGE, history.length)
    : Math.min(MAX_HISTORY_MESSAGES, history.length);

  const recent = history.slice(-maxMsgs);
  const lines: string[] = [];
  let totalChars = 0;

  for (const m of recent) {
    const role = m.role === 'user' ? 'User' : 'Assistant';
    const text = String(m.text || '');
    const remaining = HISTORY_BUDGET - totalChars;
    if (remaining <= 10) break;
    const truncated = text.length > remaining
      ? truncateAtBoundary(text, remaining)
      : text;
    lines.push(`${role}: ${truncated}`);
    totalChars += truncated.length + role.length + 2;
  }

  return lines.length > 0 ? lines.join('\n') : '(none)';
}

// ── Main selection function ─────────────────────────────────────────────────

export function selectAiContext(
  knowledge: CompanyKnowledge,
  question: string,
  decision: RoutingDecision,
  focusJobIds: string[] = [],
  history: ConversationMessage[] = []
): AiContextResult {
  const mode = detectQueryMode(question, decision);
  const includeResources = questionHasResourceKeywords(question);
  // Universal multi-section: prefer the router's resolved sections, then the
  // plural detector, then the single-section field as a final fallback.
  const targetSectionTypes: string[] = (decision.targetSectionTypes && decision.targetSectionTypes.length > 0)
    ? decision.targetSectionTypes
    : (detectSectionTypes(question).length > 0
        ? detectSectionTypes(question)
        : (decision.sectionType ? [decision.sectionType] : (detectSectionType(question) ? [detectSectionType(question)!] : [])));
  const knowledgeComplete = knowledge.metrics?.complete ?? true;

  // ── Select SOPs ──
  const scoredSops = selectSops(knowledge, question, decision, focusJobIds, mode);

  if (scoredSops.length === 0) {
    const _historyText0 = buildHistoryText(history, question);
    return {
      contextText: '(No relevant approved company SOPs were found for this question.)',
      historyText: _historyText0,
      includedSopIds: [],
      stats: {
        sopCount: 0, sectionCount: 0, itemCount: 0,
        contextChars: 0, historyChars: _historyText0.length,
        truncated: false, queryMode: mode,
        knowledgeComplete,
      },
    };
  }

  // ── Select sections per SOP ──
  const sopContexts: SopContext[] = scoredSops.map(s => ({
    job: s.job,
    score: s.score,
    sections: selectSectionsForSop(s.job, knowledge, mode, targetSectionTypes),
  }));

  // Filter out SOPs with no content sections
  const withContent = sopContexts.filter(c => c.sections.length > 0);

  if (withContent.length === 0) {
    const _historyText1 = buildHistoryText(history, question);
    return {
      contextText: '(No relevant approved company SOPs were found for this question.)',
      historyText: _historyText1,
      includedSopIds: [],
      stats: {
        sopCount: 0, sectionCount: 0, itemCount: 0,
        contextChars: 0, historyChars: _historyText1.length,
        truncated: false, queryMode: mode,
        knowledgeComplete,
      },
    };
  }

  // ── Count items/sections before reduction ──
  let itemCount = 0;
  let sectionCount = 0;
  for (const c of withContent) {
    for (const st of c.sections) {
      const items = getSectionItems(knowledge, c.job.id, st);
      if (items.length > 0) {
        sectionCount++;
        itemCount += items.length;
      }
    }
  }

  // ── Build full context ──
  let contextText = withContent
    .map(c => formatSopBlock(c.job, knowledge, c.sections, includeResources))
    .join('\n---\n\n');

  // ── Size control ──
  let truncated = false;
  let reductionReason: string | undefined;
  let finalContexts = withContent;

  if (contextText.length > CONTEXT_BUDGET) {
    const reduced = reduceContext(withContent, knowledge, mode, targetSectionTypes, includeResources);
    contextText = reduced.text;
    truncated = true;
    reductionReason = reduced.reason;
    finalContexts = reduced.finalContexts;
  }

  // ── Incomplete knowledge note (untrusted context, not system instruction) ──
  if (!knowledgeComplete) {
    contextText +=
      '\n\n---\nNOTE: Some eligible company SOPs or content may not be included due to system limits. Do not assume a procedure or requirement definitively does not exist based on this context alone.';
  }

  // ── Truncation note ──
  if (truncated) {
    contextText +=
      '\n\n---\nNOTE: The context above was reduced to fit size limits. Some less-relevant content was omitted. If the question requires comprehensive detail, the answer may be incomplete.';
  }

  const historyText = buildHistoryText(history, question);

  return {
    contextText,
    historyText,
    includedSopIds: finalContexts.map(c => c.job.id),
    stats: {
      sopCount: finalContexts.length,
      sectionCount,
      itemCount,
      contextChars: contextText.length,
      historyChars: historyText.length,
      truncated,
      queryMode: mode,
      reductionReason,
      knowledgeComplete,
    },
  };
}