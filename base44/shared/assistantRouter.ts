/**
 * assistantRouter.ts — Stage 3: Intelligent Request Routing.
 *
 * Determines whether a question can be answered directly from structured
 * company knowledge (no AI call) or needs the generative AI path. This is a
 * PURE function — no DB calls, no AI calls. It operates on the already-
 * resolved CompanyKnowledge and returns a routing decision.
 *
 * SECURITY: the knowledge passed in is already authorized by
 * resolveAssistantContext (active membership, Published, non-archived,
 * active assignment, active Master, published version, override-merged).
 * The router never re-fetches or re-authorizes — it only inspects what is
 * already eligible. A direct answer has identical access to the generative
 * path: no broader, no narrower.
 *
 * Design principle: do NOT force complex requests into direct retrieval just
 * to eliminate AI calls. When in doubt, route to generative.
 */
import {
  CompanyKnowledge,
  findSopByJobId,
  SECTION_LABELS,
  SYNONYM_MAP,
  stemMatches,
} from './companyKnowledgeEngine.ts';

export type RouteKind = 'direct' | 'generative' | 'no_match' | 'clarification';
export type DirectKind =
  | 'sop_discovery'
  | 'section_listing'
  | 'multi_sop_section'
  | 'specific_step'
  | 'resource_request'
  | 'trade_listing'
  | 'count';

export interface RoutingDecision {
  route: RouteKind;
  directKind?: DirectKind;
  targetJobId?: string;
  // Multi-operation: the explicitly named SOPs whose requested section should
  // be combined into one answer (NOT clarification). Used by both the direct
  // multi_sop_section path and the generative path (restricts AI context to
  // the named SOPs so a keyword-only match like "Mudding Drywall" is excluded).
  targetJobIds?: string[];
  // True when the question names 2+ operations but only one has a published
  // SOP — answer the supported portion and acknowledge the missing source.
  partialMissing?: boolean;
  sectionType?: string;
  // All requested sections when the question asks for multiple categories at
  // once (e.g. "tools AND materials"). `sectionType` is set to the first entry
  // for backward-compat consumers (count, context-selector fallback).
  targetSectionTypes?: string[];
  stepNumber?: number;
  tradeFilter?: string;
  categoryFilter?: string;
  confidence: number;
  reason: string;
  ambiguousJobIds?: string[];
}

// ── Generative intent detection ──────────────────────────────────────────────
// If any of these appear, the question needs synthesis or interpretation and
// should NOT be forced into direct retrieval.
const GENERATIVE_WORDS = new Set([
  'explain', 'summarize', 'summary', 'compare', 'comparison', 'differ',
  'differences', 'different', 'why', 'recommend', 'versus', 'better',
  'troubleshoot', 'understand', 'reason', 'advice', 'opinion',
]);

const GENERATIVE_PHRASES = [
  'what if', 'should i', 'walk me through', 'help me understand',
  'what does it mean', 'best practice', 'how do i', 'how to',
  'how should', 'how would', 'how could', 'is it safe to',
  'can i use', 'should we',
];

// ── Section keyword map ──────────────────────────────────────────────────────
const SECTION_KEYWORD_MAP: { keywords: string[]; sectionType: string }[] = [
  { keywords: ['tools', 'tool', 'equipment'], sectionType: 'tools' },
  { keywords: ['materials', 'material', 'supplies', 'parts', 'products'],
    sectionType: 'materials' },
  { keywords: ['safety', 'hazards', 'hazard', 'ppe', 'precautions',
    'precaution', 'warnings', 'warning', 'danger', 'caution'],
    sectionType: 'safety' },
  { keywords: ['quality', 'standards', 'acceptance', 'inspection'],
    sectionType: 'quality' },
  { keywords: ['scope'], sectionType: 'scope' },
  { keywords: ['steps', 'step', 'procedure', 'process', 'instructions'],
    sectionType: 'procedure' },
];

const RESOURCE_KEYWORDS = new Set([
  'manual', 'video', 'videos', 'pdf', 'training', 'documentation',
  'resources', 'resource', 'link', 'links', 'reference', 'references',
  'manufacturer', 'youtube',
]);

const LISTING_WORDS = new Set([
  'list', 'show', 'find', 'give', 'display', 'see',
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * normalizeQuery — replace synonym variants with their canonical form so
 * "sheetrock" matches "drywall" titles, "boiler" matches "water heater", etc.
 * Conservative: only replaces exact term matches found in SYNONYM_MAP.
 */
function normalizeQuery(q: string): string {
  let result = q.toLowerCase();
  for (const [term, syns] of Object.entries(SYNONYM_MAP)) {
    const canonical = syns[0];
    if (term === canonical) continue;
    const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    result = result.replace(re, canonical);
  }
  return result;
}

function hasWord(text: string, word: string): boolean {
  const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  return re.test(text);
}

function hasAnyWord(text: string, words: string[]): boolean {
  return words.some(w => hasWord(text, w));
}

function hasPhrase(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase);
}

/**
 * Detect generative intent. If present, the question needs AI synthesis.
 * Exported for testability.
 */
export function hasGenerativeIntent(question: string): boolean {
  const q = question.toLowerCase();
  const tokens = new Set(q.match(/[a-z0-9]+/g) || []);
  for (const w of GENERATIVE_WORDS) {
    if (tokens.has(w)) return true;
  }
  for (const phrase of GENERATIVE_PHRASES) {
    if (hasPhrase(q, phrase)) return true;
  }
  return false;
}

/**
 * Detect ALL requested section types from the question (universal multi-section
 * support). "What tools and materials..." → ['tools','materials']. Order
 * follows SECTION_KEYWORD_MAP (scope, tools, materials, procedure, safety,
 * quality). Exported for testability and reuse by the context selector.
 */
export function detectSectionTypes(question: string): string[] {
  const q = question.toLowerCase();
  const found: string[] = [];
  for (const { keywords, sectionType } of SECTION_KEYWORD_MAP) {
    for (const kw of keywords) {
      if (hasWord(q, kw)) {
        if (!found.includes(sectionType)) found.push(sectionType);
        break;
      }
    }
  }
  return found;
}

/**
 * Detect the requested section type when EXACTLY ONE is requested. Returns
 * the sectionType, or null if zero or multiple are requested. Kept for
 * single-section consumers (count, step). For multi-section routing use
 * detectSectionTypes.
 */
export function detectSectionType(question: string): string | null {
  const found = detectSectionTypes(question);
  return found.length === 1 ? found[0] : null;
}

/**
 * Detect a specific step number request. Returns the step number or null.
 * Exported for testability.
 */
export function detectStepNumber(question: string): number | null {
  const m = question.toLowerCase().match(/step\s+(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n > 0 && n < 1000) return n;
  }
  return null;
}

/**
 * Detect a resource request. Exported for testability.
 */
export function detectResourceRequest(question: string): boolean {
  return hasAnyWord(question.toLowerCase(), [...RESOURCE_KEYWORDS]);
}

/**
 * Detect a count request.
 * Returns 'all_sops' (how many SOPs total) or 'section_items' (how many items
 * in a section of a specific SOP) or null.
 * Exported for testability.
 */
export function detectCountRequest(question: string): 'all_sops' | 'section_items' | null {
  const q = question.toLowerCase();
  if (!hasPhrase(q, 'how many')) return null;
  if (hasWord(q, 'sops') || hasWord(q, 'procedures')) return 'all_sops';
  for (const { keywords } of SECTION_KEYWORD_MAP) {
    if (hasAnyWord(q, keywords)) return 'section_items';
  }
  return null;
}

/**
 * Detect a trade/category listing request.
 * Returns { trade?, category? } or null.
 */
function detectTradeListing(
  question: string,
  knowledge: CompanyKnowledge
): { trade?: string; category?: string } | null {
  const q = question.toLowerCase();
  const hasListingIntent = hasAnyWord(q, ['all', 'list', 'show', 'what']) ||
    hasPhrase(q, 'do we have');
  const hasPlural = hasWord(q, 'sops') || hasWord(q, 'procedures');
  if (!hasListingIntent || !hasPlural) return null;

  const trades = new Set<string>();
  const categories = new Set<string>();
  for (const job of knowledge.jobs) {
    if (job.trade) trades.add(job.trade.toLowerCase());
    if (job.category) categories.add(job.category.toLowerCase());
  }
  for (const trade of trades) {
    if (hasWord(q, trade)) return { trade };
  }
  for (const cat of categories) {
    if (hasWord(q, cat)) return { category: cat };
  }
  return null;
}

/**
 * Generic construction-title process words. These appear across many SOP titles
 * (Fence Repair, Siding Repair, Deck Stair Repair, ...) and don't distinguish
 * one SOP from another. Filter them from the significant-title-token set so a
 * query for "sheetrock repair" matches "Drywall Patch and Repair" via "drywall"
 * rather than tying with "Fence Repair" on the generic word "repair".
 */
const TITLE_STOPWORDS = new Set([
  'repair', 'replacement', 'installation', 'inspection',
  'and', 'the', 'for', 'of', 'in', 'on', 'at', 'to', 'a', 'an',
]);

// Generic location/position adjectives that appear across unrelated SOP titles
// (Exterior Painting, Exterior Door Replacement, Interior Door Replacement...).
// A match on ONLY one of these must not let an unrelated SOP be presented as the
// answer. They still count as significant tokens for disambiguation when paired
// with a matching operation noun (e.g. "exterior" + "door"); only an
// adjective-ONLY match is capped (see titleMatchScore).
const GENERIC_TITLE_MODIFIERS = new Set([
  'exterior', 'interior', 'outside', 'inside',
  'residential', 'commercial', 'exterior',
]);

// ── Multi-operation vocabulary (universal, trade-agnostic) ──────────────────
// Used ONLY to decide whether a question names more than one operation. These
// are NOT trade-specific — they are generic combiners and filters that apply
// to any current or future SOP regardless of trade, title, or category.
const ROUTER_STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'by', 'with',
  'how', 'what', 'which', 'is', 'are', 'do', 'does', 'did', 'i', 'my', 'me', 'we',
  'this', 'that', 'it', 'its', 'can', 'will', 'be', 'should', 'would', 'could',
  'please', 'tell', 'show', 'give', 'about', 'need', 'needed', 'want', 'wanted',
  'use', 'used', 'using', 'get', 'make', 'making', 'done', 'from', 'into', 'over',
  'under', 'out', 'many', 'much', 'some', 'any', 'all',
]);
// Section-keyword variants — an "and" joining these ("tools and materials") is
// NOT a second operation.
const SECTION_KEYWORD_SET = new Set([
  'tools', 'tool', 'equipment', 'materials', 'material', 'supplies', 'parts',
  'products', 'safety', 'hazards', 'hazard', 'ppe', 'precautions', 'precaution',
  'warnings', 'warning', 'danger', 'caution', 'quality', 'standards',
  'acceptance', 'inspection', 'scope', 'steps', 'step', 'procedure', 'process',
  'instructions', 'list', 'find',
]);
// Non-operation nouns/adverbs/connectors — excluded from the "uncovered
// operation token" check so a single-SOP request is not falsely reported as a
// missing second operation. Trade-agnostic: contains no trade verbs.
const NON_OPERATION_WORDS = new Set([
  'room', 'rooms', 'area', 'house', 'home', 'building', 'wall', 'walls',
  'ceiling', 'roof', 'floors', 'floor', 'section', 'side', 'piece', 'pieces',
  'sheet', 'sheets', 'board', 'boards', 'panel', 'panels', 'stuff', 'things',
  'thing', 'gear', 'gears', 'properly', 'safely', 'quickly', 'correctly',
  'carefully', 'easily', 'slowly', 'cleanly', 'right', 'well', 'fast', 'best',
  'better', 'good', 'new', 'old', 'big', 'small', 'first', 'second', 'third',
  'before', 'after', 'during', 'while', 'too', 'one', 'two', 'three',
  // Generic location/position adjectives — not operations in their own right.
  'exterior', 'interior', 'outside', 'inside',
  // Detail-request words that are not construction operations.
  'descriptions', 'quantities', 'specifications', 'specs', 'details',
  'include', 'including',
  // Collective anaphors — refer back to prior SOPs, not new operations.
  'both', 'those', 'these', 'them', 'each', 'ones',
]);

/**
 * Score how well a question references a job title. Returns 0..1.
 * 1.0 = full title substring in question. Lower = partial token overlap.
 * Synonym-normalized + generic process words filtered from title tokens.
 */
function titleMatchScore(question: string, jobTitle: string): number {
  const q = normalizeQuery(question.toLowerCase());
  const title = (jobTitle || '').toLowerCase().trim();
  if (!title) return 0;
  if (q.includes(title)) return 1.0;
  const titleTokens = title.match(/[a-z0-9]+/g) || [];
  const significant = titleTokens.filter(t => t.length > 2 && !TITLE_STOPWORDS.has(t));
  if (significant.length === 0) return 0;
  const qTokens = q.match(/[a-z0-9]+/g) || [];
  let hits = 0;
  let nonGenericHits = 0;
  for (const t of significant) {
    // Stem-aware: "hang" matches "hanging", "tape" matches "taping".
    if (qTokens.some(qt => stemMatches(qt, t))) {
      hits++;
      // A match on ONLY a generic modifier (exterior/interior/...) is weak —
      // it must not let an unrelated SOP win on a shared adjective alone.
      if (!GENERIC_TITLE_MODIFIERS.has(t)) nonGenericHits++;
    }
  }
  if (hits === 0) return 0;
  if (nonGenericHits === 0) return 0.4; // only a generic modifier matched
  return hits / significant.length;
}

// ── Multi-operation detection (universal) ─────────────────────────────────────
// A combined request names two or more operations and wants information from
// ALL of them — it is NOT ambiguity. Evidence of multiplicity is a combiner
// (and/both/together/as well as/plus/also/then/next) OR a comma-separated list,
// so "paint, floor, and frame" and "hang and tape" are both recognized. This is
// trade-agnostic: it relies only on how strongly SOP titles match the question,
// not on any trade vocabulary.
//
//   2+ SOPs each named by a matched significant title token (that is NOT an
//     incidental shared-object-only match) → COMBINE. E.g. "paint, floor, and
//     frame" names Painting Walls/Flooring/Framing; "hang and tape drywall" names
//     Hanging/Taping — "drywall" alone does NOT name "Drywall Patch and Repair".
//   1 named SOP + a credible second operation the user named that no SOP covers
//     → PARTIAL (answer the one, acknowledge the missing).
//   1 named SOP whose own title contains "and" → NOT multi (the and is part of
//     the SOP name, e.g. "Gutters and Downspout Repair").
//   1 named SOP with NO uncovered operation token → NOT multi (the combiner
//     joins sections/concepts, e.g. "tools and materials for hanging drywall").
const MULTI_INDICATOR_RE = /\b(and|both|together|as well as|plus|also|then|next)\b|,/i;

// Collective anaphors that refer back to SOPs from the previous turn, used for
// follow-up resolution (e.g. "what about the materials for both?").
const ANAPHOR_RE = /\b(both|those|these|them|the two|those two|these two|each of|the second|the other|the first|that one|the ones|the procedures|the sops?)\b/i;

/**
 * Returns true if the question contains a significant token that looks like a
 * second operation the matched SOP does not cover. Excludes stopwords, section
 * keywords, generic non-operation nouns/adverbs, and title stopwords so that
 * "tools and materials for hanging drywall" (no uncovered op) is NOT partial
 * while "hang and plaster drywall" (plaster uncovered) IS partial.
 */
function hasUncoveredOperationToken(question: string, job: any): boolean {
  const q = normalizeQuery(question.toLowerCase());
  const qTokens = q.match(/[a-z0-9]+/g) || [];
  const titleTokens = (job.title || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const qt of qTokens) {
    if (qt.length < 4) continue;
    if (ROUTER_STOPWORDS.has(qt)) continue;
    if (SECTION_KEYWORD_SET.has(qt)) continue;
    if (NON_OPERATION_WORDS.has(qt)) continue;
    if (TITLE_STOPWORDS.has(qt)) continue;
    if (titleTokens.some(tt => stemMatches(qt, tt))) continue;
    return true;
  }
  return false;
}

/**
 * True if the question names a credible operation token that NO eligible SOP
 * title covers. Used to tell "no published content for this topic" (no_match)
 * from "too vague, name a SOP" (clarification). E.g. "quantum phaser
 * calibration" → no SOP covers "phaser"/"calibration" → no_match.
 */
function questionNamesUnmatchedOperation(knowledge: CompanyKnowledge, question: string): boolean {
  const q = normalizeQuery(question.toLowerCase());
  const qTokens = q.match(/[a-z0-9]+/g) || [];
  const allTitleTokens: string[] = [];
  for (const job of knowledge.jobs) {
    const t = (job.title || '').toLowerCase().match(/[a-z0-9]+/g) || [];
    for (const x of t) allTitleTokens.push(x);
  }
  for (const qt of qTokens) {
    if (qt.length < 4) continue;
    if (ROUTER_STOPWORDS.has(qt)) continue;
    if (SECTION_KEYWORD_SET.has(qt)) continue;
    if (NON_OPERATION_WORDS.has(qt)) continue;
    if (TITLE_STOPWORDS.has(qt)) continue;
    if (allTitleTokens.some(tt => stemMatches(qt, tt))) continue;
    return true;
  }
  return false;
}

/**
 * True if the question contains any credible operation token — a significant
 * word that is not a stopword, section keyword, generic modifier, or
 * non-operation word. Used to gate the focus fallback in resolveTargetSop:
 * when the user names a new operation (whether or not a SOP covers it),
 * previous focus must NOT be promoted as a match or clarification candidate.
 *
 *   "What tools are needed for kitchen sink installation?" → true (new op)
 *   "What about its safety precautions?"                    → false (follow-up)
 *   "What about the materials for both?"                    → false (anaphor)
 */
function namesAnyOperation(question: string): boolean {
  const q = normalizeQuery(question.toLowerCase());
  const qTokens = q.match(/[a-z0-9]+/g) || [];
  for (const qt of qTokens) {
    if (qt.length < 4) continue;
    if (ROUTER_STOPWORDS.has(qt)) continue;
    if (SECTION_KEYWORD_SET.has(qt)) continue;
    if (NON_OPERATION_WORDS.has(qt)) continue;
    if (TITLE_STOPWORDS.has(qt)) continue;
    if (GENERIC_TITLE_MODIFIERS.has(qt)) continue;
    return true;
  }
  return false;
}

// ── Ordinal / SOP-name selection after clarification ──────────────────────────
// After a clarification, the user may respond with an ordinal ("the first one",
// "the second one") or a bare SOP name from the offered list. Both should
// resolve to the specific SOP and inherit the section from the previous user
// question (e.g., "What tools are needed for drywall?" → "the first one" →
// first SOP's tools). This is deterministic — no AI call, no unreliable ordinal
// interpretation by the LLM.

const ORDINAL_INDEX: Record<string, number> = {
  first: 0, '1st': 0,
  second: 1, '2nd': 1,
  third: 2, '3rd': 2,
  fourth: 3, fifth: 4,
};

// Selector words stripped from a shorthand reply before title-token matching.
// These are generic clarifier nouns/articles, not construction operations.
const SELECTOR_STOPWORDS = new Set([
  'the', 'a', 'an', 'one', 'ones', 'option', 'sop', 'sops', 'procedure',
  'procedures', 'please', 'choose', 'select', 'pick', 'want', 'need',
  'about', 'go', 'with', 'use', 'what',
]);

interface HistoryEntry { role: string; text: string }

/**
 * Parse an ordinal selection from the question.
 * Supports: "the first one", "first", "second", "2", "option 2", "sop 1".
 * Returns the 0-based index, or null.
 */
function parseOrdinalSelection(qLower: string): number | null {
  // Word ordinals: "the first one", "first", "the second", "2nd"
  const ordMatch = qLower.match(
    /^(?:the\s+)?(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)(?:\s+one)?\s*$/
  );
  if (ordMatch) {
    const idx = ORDINAL_INDEX[ordMatch[1].toLowerCase()];
    if (idx !== undefined) return idx;
  }
  // Bare number: "1", "2", "3"
  const bareNum = qLower.match(/^(\d+)\s*$/);
  if (bareNum) {
    const n = parseInt(bareNum[1], 10);
    if (n >= 1 && n <= 9) return n - 1;
  }
  // Prefixed number: "option 2", "sop 1", "choice 3", "number 2"
  const prefixed = qLower.match(
    /^(?:option|sop|choice|number|pick|select)\s+(\d+)\s*$/
  );
  if (prefixed) {
    const n = parseInt(prefixed[1], 10);
    if (n >= 1 && n <= 9) return n - 1;
  }
  return null;
}

// ── Multi-turn clarification context recovery ──────────────────────────────
// After a successful clarification selection, the frontend sets focusJobIds
// to only the SELECTED SOP (from the response sources). When the user then
// selects another candidate from the same clarification (e.g. "Taping" after
// "Hanging"), the reduced focus no longer contains the other candidates.
// recoverClarificationContext scans the conversation history for the
// assistant's clarification message, re-extracts the full candidate list,
// the original question (which carries the requested section intent), and
// the previously-selected SOP (for "the other one"). This lets the user
// switch between offered SOPs across multiple turns without the frontend
// needing to track the candidate list separately.

interface RecoveredClarificationContext {
  candidateJobIds: string[];
  originalQuestion: string;
  selectedJobId: string | null;
}

function recoverClarificationContext(
  history: HistoryEntry[],
  knowledge: CompanyKnowledge
): RecoveredClarificationContext | null {
  // Scan backwards for the most recent assistant clarification message.
  let clarIdx = -1;
  let clarText = '';
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role === 'assistant' && h.text &&
        h.text.includes('I found multiple SOPs that could match')) {
      clarIdx = i;
      clarText = h.text;
      break;
    }
  }
  if (clarIdx === -1) return null;

  // Extract numbered SOP titles: "1. Taping Drywall" etc.
  const candidateTitles: string[] = [];
  for (const line of clarText.split('\n')) {
    const m = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (m && m[2]) candidateTitles.push(m[2].trim());
  }
  if (candidateTitles.length < 2) return null;

  // Match against the current eligible knowledge set (stale SOPs dropped).
  const candidateJobIds: string[] = [];
  for (const title of candidateTitles) {
    const job = knowledge.jobs.find(j =>
      (j.title || '').toLowerCase().trim() === title.toLowerCase().trim()
    );
    if (job && !candidateJobIds.includes(job.id)) candidateJobIds.push(job.id);
  }
  if (candidateJobIds.length < 2) return null;

  // Find the original user question (immediately before the clarification).
  let originalQuestion = '';
  for (let i = clarIdx - 1; i >= 0; i--) {
    if (history[i].role === 'user') {
      originalQuestion = history[i].text || '';
      break;
    }
  }

  // Determine which candidate was previously selected (scan assistant
  // responses after the clarification for a heading matching a candidate).
  let selectedJobId: string | null = null;
  for (let i = clarIdx + 1; i < history.length; i++) {
    if (history[i].role !== 'assistant') continue;
    const text = history[i].text || '';
    if (text.includes('I found multiple SOPs that could match')) continue;
    for (const id of candidateJobIds) {
      const job = knowledge.jobs.find(j => j.id === id);
      if (!job || !job.title) continue;
      for (const line of text.split('\n')) {
        if (/^#{1,4}\s/.test(line) && line.includes(job.title)) {
          selectedJobId = id;
          break;
        }
      }
      if (selectedJobId) break;
    }
    if (selectedJobId) break;
  }

  // Topic-change detection: if a user message after the clarification names
  // a new operation not matching any candidate (and is not itself a
  // selection shorthand or anaphor), the clarification is stale.
  for (let i = clarIdx + 1; i < history.length; i++) {
    if (history[i].role !== 'user') continue;
    const uq = (history[i].text || '').trim();
    if (!uq) continue;
    const uqLower = uq.toLowerCase();
    if (ANAPHOR_RE.test(uqLower)) continue;
    if (parseOrdinalSelection(uqLower) !== null) continue;
    const matchesCandidate = candidateJobIds.some(id => {
      const job = knowledge.jobs.find(j => j.id === id);
      return job && titleMatchScore(uq, job.title || '') > 0.4;
    });
    if (matchesCandidate) continue;
    if (namesAnyOperation(uq)) return null;
  }

  return { candidateJobIds, originalQuestion, selectedJobId };
}

/**
 * Detect a clarification-selection reply: ordinal ("the first one", "2",
 * "option 2", "sop 1"), shorthand SOP name ("Taping", "Taping drywall", "The taping
 * one"), or collective anaphor ("the other one"). Resolves to the selected
 * SOP and inherits the original question's section/step/resource intent.
 *
 * After a successful selection the frontend's focusJobIds contains only the
 * selected SOP. The full candidate list is recovered from the conversation
 * history (recoveredCtx) so the user can switch to any other offered SOP.
 *
 * Matching rules:
 *   - "The other one": selects the non-selected candidate (2 candidates only).
 *   - Ordinal: maps to recovered candidates by position (original display order).
 *   - Exact title: question equals a candidate SOP title (case-insensitive).
 *   - Shorthand: question's significant tokens (after stripping selector words)
 *     stem-match a SUBSET of one candidate's significant title tokens.
 *
 * Returns a RoutingDecision for a successful selection, a clarification if
 * the shorthand is ambiguous, a no_match if the selected SOP is no longer
 * available, or null if the question is not a selection.
 */
function detectClarificationSelection(
  knowledge: CompanyKnowledge,
  question: string,
  focusJobIds: string[],
  history: HistoryEntry[],
  recoveredCtx?: RecoveredClarificationContext | null
): RoutingDecision | null {
  // Build the effective candidate list: union of recovered candidates
  // (from history) and the frontend's focus. After a selection, focus
  // contains only the selected SOP; recovered candidates restore the rest.
  const recoveredIds = recoveredCtx?.candidateJobIds || [];
  const effectiveIds: string[] = [];
  for (const id of [...recoveredIds, ...focusJobIds]) {
    if (!effectiveIds.includes(id)) effectiveIds.push(id);
  }
  if (effectiveIds.length === 0) return null;

  const q = question.trim();
  const qLower = q.toLowerCase();

  // ── 0. "The other one" — select a non-selected candidate ────────────
  if (recoveredCtx && recoveredCtx.selectedJobId &&
      recoveredCtx.candidateJobIds.length >= 2) {
    const OTHER_RE = /\bthe\s+other(?:\s+one)?\b/i;
    if (OTHER_RE.test(qLower)) {
      // Pick the first non-selected candidate. With 2 candidates this is
      // deterministic; with 3+ it picks the first alternative the user saw.
      const otherId = recoveredCtx.candidateJobIds.find(
        id => id !== recoveredCtx.selectedJobId
      );
      if (otherId) {
        const job = findSopByJobId(knowledge, otherId);
        if (job) {
          return buildSelectionDecision(knowledge, job, history, 'the other one', recoveredCtx);
        }
      }
    }
  }

  // ── 1. Ordinal selection ──────────────────────────────────────────────
  const ordIdx = parseOrdinalSelection(qLower);
  if (ordIdx !== null) {
    // Map ordinal to the RECOVERED candidates (which preserve the display
    // order from the original clarification), falling back to focus.
    const candidateList = recoveredIds.length > 0 ? recoveredIds : focusJobIds;
    if (ordIdx < candidateList.length) {
      const job = findSopByJobId(knowledge, candidateList[ordIdx]);
      if (job) {
        return buildSelectionDecision(knowledge, job, history, `ordinal ${ordIdx + 1}`, recoveredCtx);
      }
      return {
        route: 'no_match',
        confidence: 0.7,
        reason: 'Selected SOP is no longer available.',
      };
    }
    return null;
  }

  // Revalidate all effective candidates against the current eligible set.
  const candidateJobs = effectiveIds
    .map(id => findSopByJobId(knowledge, id))
    .filter((j): j is NonNullable<typeof j> => j !== null);
  if (candidateJobs.length === 0) {
    return {
      route: 'no_match',
      confidence: 0.7,
      reason: 'Previously offered SOPs are no longer available.',
    };
  }

  // ── 2. Exact title match ──────────────────────────────────────────────
  for (const job of candidateJobs) {
    const title = (job.title || '').toLowerCase().trim();
    if (title && qLower === title) {
      return buildSelectionDecision(knowledge, job, history, 'exact SOP name', recoveredCtx);
    }
  }

  // ── 3. Shorthand / partial name match ─────────────────────────────────
  const qTokens = (qLower.match(/[a-z0-9]+/g) || [])
    .filter(t => !SELECTOR_STOPWORDS.has(t) && t.length > 1);
  if (qTokens.length > 0) {
    const matches: any[] = [];
    for (const job of candidateJobs) {
      const titleTokens = (job.title || '').toLowerCase().match(/[a-z0-9]+/g) || [];
      const sigTitle = titleTokens.filter(
        t => t.length > 2 && !TITLE_STOPWORDS.has(t)
      );
      const allMatch = qTokens.every(qt =>
        sigTitle.some(tt => stemMatches(qt, tt))
      );
      if (allMatch) matches.push(job);
    }

    if (matches.length === 1) {
      return buildSelectionDecision(knowledge, matches[0], history, 'shorthand SOP name', recoveredCtx);
    }
    if (matches.length >= 2) {
      return {
        route: 'clarification',
        confidence: 0.7,
        reason: 'Multiple offered SOPs match the shorthand selection.',
        ambiguousJobIds: matches.map(j => j.id),
      };
    }
  }

  return null;
}

/**
 * Build a section_listing decision for a clarification selection. The section
 * is inherited from the previous user question in history (e.g., "What tools..."
 * → tools). Defaults to 'scope' if no section can be inferred.
 */
function buildSelectionDecision(
  _knowledge: CompanyKnowledge,
  job: any,
  history: HistoryEntry[],
  via: string,
  recoveredCtx?: RecoveredClarificationContext | null
): RoutingDecision {
  // Use the ORIGINAL question from the clarification context (the one that
  // preceded the clarification) to determine the requested section/step/
  // resource intent. Without this, after two selections the "previous user
  // question" would be the first selection shorthand (e.g. "Hanging") which
  // carries no section intent, causing the answer to default to scope or
  // fall into generative mode.
  const prevQ = recoveredCtx?.originalQuestion
    || history.filter(h => h.role === 'user').map(h => h.text || '').pop()
    || '';

  // Preserve the original question's intent: step, resource, or section listing.
  const stepNum = detectStepNumber(prevQ);
  if (stepNum !== null) {
    return {
      route: 'direct',
      directKind: 'specific_step',
      targetJobId: job.id,
      sectionType: 'procedure',
      stepNumber: stepNum,
      confidence: 0.9,
      reason: `Clarification selection via ${via}; resolved to "${job.title}". Step ${stepNum} inherited from previous question.`,
    };
  }

  if (detectResourceRequest(prevQ)) {
    return {
      route: 'direct',
      directKind: 'resource_request',
      targetJobId: job.id,
      confidence: 0.9,
      reason: `Clarification selection via ${via}; resolved to "${job.title}". Resource request inherited from previous question.`,
    };
  }

  const sections = detectSectionTypes(prevQ);
  const sectionType = sections.length > 0 ? sections[0] : 'scope';
  const targetSections = sections.length > 0 ? sections : ['scope'];

  return {
    route: 'direct',
    directKind: 'section_listing',
    targetJobId: job.id,
    sectionType,
    targetSectionTypes: targetSections,
    confidence: 0.9,
    reason: `Clarification selection via ${via}; resolved to "${job.title}". Section inherited from previous question.`,
  };
}

// A "discriminator" title token is one that is NOT shared across other
// distinct SOP titles. This is what lets the matcher tell a named operation
// from a shared object word — trade-agnostic, no verb/object lexicon needed.
//   "hang and tape drywall": "hanging"/"taping" are discriminators (each in
//     one title); "drywall" is shared across 4 titles → not a discriminator, so
//     "Drywall Patch and Repair" / "Mudding Drywall" are NOT named by "drywall".
//   "paint, floor, and frame": "painting"/"flooring"/"framing" are
//     discriminators → Painting Walls, Flooring Installation, Framing Walls
//     are all named even though the user never said "walls".
//   Duplicate titles ("Mudding Drywall" x2): "mudding" belongs to ONE distinct
//     title → discriminator → both records are named (distinct IDs preserved).
function buildTitleSignificance(knowledge: CompanyKnowledge) {
  const titleSig = new Map<string, Set<string>>();
  for (const job of knowledge.jobs) {
    const title = (job.title || '').toLowerCase().trim();
    if (titleSig.has(title)) continue;
    const tokens = title.match(/[a-z0-9]+/g) || [];
    titleSig.set(title, new Set(tokens.filter(t => t.length > 2 && !TITLE_STOPWORDS.has(t))));
  }
  // Frequency of each significant token across DISTINCT titles.
  const freq = new Map<string, number>();
  for (const sig of titleSig.values()) {
    for (const t of sig) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return { titleSig, freq };
}

function detectMultiOperation(
  knowledge: CompanyKnowledge,
  question: string
): { jobIds: string[]; partial: boolean } | null {
  if (!MULTI_INDICATOR_RE.test(question.toLowerCase())) return null;
  const q = normalizeQuery(question.toLowerCase());
  const qTokens = q.match(/[a-z0-9]+/g) || [];
  const qlower = question.toLowerCase();
  const { titleSig, freq } = buildTitleSignificance(knowledge);

  // A SOP is "named" if the question stem-matches one of its significant title
  // tokens, EXCEPT an incidental object-only match: when EVERY matched token
  // is a shared object word (appears across other distinct titles) AND the SOP
  // has a UNIQUE operation token the user did NOT mention. This is what tells
  // a named operation from a shared material word — no verb/object lexicon:
  //   "hang and tape drywall": Drywall Patch and Repair matches only "drywall"
  //     (shared), and its unique "patch" was never mentioned → excluded.
  //     Hanging/Taping match their unique "hanging"/"taping" → named.
  //   "paint, floor, and frame": Painting Walls matches "painting" (shared with
  //     Interior Painting); its only other token "walls" is also shared, so it
  //     has NO unique unmentioned operation → kept. Interior Painting matches
  //     "painting" but has unique unmentioned "interior" → excluded.
  const named: { job: any; pos: number }[] = [];
  for (const job of knowledge.jobs) {
    const title = (job.title || '').toLowerCase().trim();
    const sigSet = titleSig.get(title);
    if (!sigSet) continue;
    const sig = [...sigSet];
    const matched: string[] = [];
    const matchedSet = new Set<string>();
    let bestPos = Infinity;
    for (const t of sig) {
      for (const qt of qTokens) {
        if (stemMatches(qt, t)) {
          if (!matchedSet.has(t)) { matched.push(t); matchedSet.add(t); }
          const idx = qlower.indexOf(qt);
          if (idx >= 0 && idx < bestPos) bestPos = idx;
        }
      }
    }
    if (matched.length === 0) continue;
    // A SOP named ONLY by a generic modifier (exterior/interior/...) is not a
    // real operation match — "exterior painting" must not name "Exterior Door
    // Replacement" on the shared adjective "exterior" alone.
    const hasNonGenericMatch = matched.some(t => !GENERIC_TITLE_MODIFIERS.has(t));
    if (!hasNonGenericMatch) continue;
    const allMatchedShared = matched.every(t => (freq.get(t) || 0) >= 2);
    const hasUniqueUnmatched = sig.some(t => !matchedSet.has(t) && (freq.get(t) || 0) === 1);
    if (allMatchedShared && hasUniqueUnmatched) continue; // incidental object-only match
    named.push({ job, pos: bestPos });
  }

  named.sort((a, b) => a.pos - b.pos);

  if (named.length >= 2) {
    return { jobIds: named.map(n => n.job.id), partial: false };
  }

  if (named.length === 1) {
    // "and" inside the matched title belongs to the SOP name — not multi.
    const t = (named[0].job.title || '').toLowerCase();
    if (/\band\b/.test(t)) return null;
    // Only treat as partial if the user named a credible second operation no
    // SOP covers. "tools and materials for hanging drywall" has none → single.
    if (hasUncoveredOperationToken(question, named[0].job)) {
      return { jobIds: [named[0].job.id], partial: true };
    }
    return null;
  }

  return null;
}

/**
 * Resolve the target SOP from the question and conversation focus.
 * Revalidates focusJobIds against the CURRENT eligible knowledge set —
 * a stale focus (archived/revoked SOP) is silently dropped.
 * Returns { jobId? } on success, { ambiguous?: string[] } on ambiguity.
 */
function resolveTargetSop(
  knowledge: CompanyKnowledge,
  question: string,
  focusJobIds: string[]
): { jobId?: string; ambiguous?: string[] } {
  const q = question.toLowerCase();

  const scored = knowledge.jobs
    .map(job => ({ job, score: titleMatchScore(q, job.title || '') }))
    .filter(s => s.score > 0.4) // exclude generic-modifier-only matches (capped at 0.4)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    // If the question names a credible new operation, do NOT fall back to
    // previous focus — the user is asking about a different subject. Return
    // empty so the caller returns no_match (no SOP covers the named op),
    // never the stale SOPs from the previous turn.
    if (namesAnyOperation(q)) {
      return {};
    }
    // No operation named — this is a contextual follow-up (section keyword +
    // pronoun, e.g. "what about its safety?"). Fall back to revalidated focus.
    const eligibleFocus = focusJobIds
      .map(id => findSopByJobId(knowledge, id))
      .filter((j): j is NonNullable<typeof j> => j !== null);
    if (eligibleFocus.length === 1) return { jobId: eligibleFocus[0].id };
    if (eligibleFocus.length > 1) return { ambiguous: eligibleFocus.map(j => j.id) };
    return {};
  }

  // Strong match: score >= 0.8 and clearly above the next
  if (scored[0].score >= 0.8) {
    if (scored.length === 1 || scored[0].score - scored[1].score >= 0.2) {
      return { jobId: scored[0].job.id };
    }
  }
  // Multiple matches with similar scores → ambiguous
  if (scored.length >= 2 && scored[0].score - scored[1].score < 0.2) {
    return { ambiguous: scored.slice(0, 4).map(s => s.job.id) };
  }
  // Single match above 0.5 but below 0.8
  if (scored.length === 1 && scored[0].score >= 0.5) {
    return { jobId: scored[0].job.id };
  }
  return {};
}

// ── Main routing function ───────────────────────────────────────────────────

/**
 * routeAssistantRequest — determine the route for a question.
 *
 * Priority:
 *   1. Generative intent → generative
 *   2. Count → direct (if knowledge complete) or generative
 *   3. Specific step → direct (if target unambiguous)
 *   4. Section listing → direct (if target unambiguous)
 *   5. Resource request → direct (if target unambiguous)
 *   6. Trade/category listing → direct
 *   7. SOP discovery (title match) → direct
 *   8. Default → generative
 */
export function routeAssistantRequest(
  knowledge: CompanyKnowledge,
  question: string,
  focusJobIds: string[] = [],
  history: HistoryEntry[] = []
): RoutingDecision {
  const q = question.trim();
  const knowledgeComplete = knowledge.metrics?.complete ?? true;

  // Multi-operation detection (combined requests like "hang AND tape drywall").
  // Computed once and reused by the generative and section-listing branches.
  const multi = detectMultiOperation(knowledge, q);

  // Recover clarification context from history — the full candidate list and
  // the original question are preserved across multiple selections so the
  // user can switch between offered SOPs without re-specifying the request.
  const clarCtx = recoverClarificationContext(history, knowledge);

  // ── 1. Generative intent → generative ──────────────────────────────────
  if (hasGenerativeIntent(q)) {
    const genSections = detectSectionTypes(q);
    // For a multi-operation generative request, restrict the AI context to
    // the explicitly named SOPs so a keyword-only match (e.g. "Mudding
    // Drywall" matching only on "drywall") is excluded from the synthesis.
    if (multi && multi.jobIds.length >= 2) {
      return {
        route: 'generative',
        targetJobIds: multi.jobIds,
        targetSectionTypes: genSections.length > 0 ? genSections : undefined,
        confidence: 0.9,
        reason: 'Multi-operation request; AI context restricted to the named SOPs.',
      };
    }
    // Generative request referencing prior clarification candidates (e.g.
    // "compare the two"). Restrict AI context to the recovered candidates.
    if (clarCtx && clarCtx.candidateJobIds.length >= 2 && ANAPHOR_RE.test(q)) {
      return {
        route: 'generative',
        targetJobIds: clarCtx.candidateJobIds,
        targetSectionTypes: genSections.length > 0 ? genSections : undefined,
        confidence: 0.9,
        reason: 'Generative request referencing prior clarification candidates.',
      };
    }
    return {
      route: 'generative',
      targetSectionTypes: genSections.length > 0 ? genSections : undefined,
      confidence: 0.9,
      reason: 'Question contains generative-intent keywords.',
    };
  }

  // ── 2. Count request ──────────────────────────────────────────────────
  const countKind = detectCountRequest(q);
  if (countKind === 'all_sops') {
    if (!knowledgeComplete) {
      return {
        route: 'generative',
        confidence: 0.6,
        reason: 'Count requested but knowledge may be incomplete.',
      };
    }
    return {
      route: 'direct',
      directKind: 'count',
      confidence: 0.9,
      reason: 'Unambiguous SOP count request with complete knowledge.',
    };
  }
  if (countKind === 'section_items') {
    const sectionType = detectSectionType(q);
    if (!sectionType) {
      return { route: 'generative', confidence: 0.5, reason: 'Count without clear section.' };
    }
    const target = resolveTargetSop(knowledge, q, focusJobIds);
    if (target.jobId) {
      return {
        route: 'direct',
        directKind: 'count',
        targetJobId: target.jobId,
        sectionType,
        confidence: 0.8,
        reason: 'Section item count for an identified SOP.',
      };
    }
    return {
      route: 'generative',
      confidence: 0.5,
      reason: 'Section item count without a clear target SOP.',
    };
  }

  // ── 3. Specific step ──────────────────────────────────────────────────
  const stepNum = detectStepNumber(q);
  if (stepNum !== null) {
    const target = resolveTargetSop(knowledge, q, focusJobIds);
    if (target.jobId) {
      return {
        route: 'direct',
        directKind: 'specific_step',
        targetJobId: target.jobId,
        sectionType: 'procedure',
        stepNumber: stepNum,
        confidence: 0.9,
        reason: 'Specific step number for an identified SOP.',
      };
    }
    if (target.ambiguous) {
      return {
        route: 'clarification',
        confidence: 0.6,
        reason: 'Step request with ambiguous target SOP.',
        ambiguousJobIds: target.ambiguous,
      };
    }
    return {
      route: 'generative',
      confidence: 0.5,
      reason: 'Step request without a clear target SOP.',
    };
  }

  // ── 4. Section listing (single OR multiple sections) ─────────────────
  const sections = detectSectionTypes(q);
  if (sections.length > 0) {
    const sectionType = sections[0]; // backward-compat single-section field
    // Multi-operation combined request: combine every requested section from
    // every explicitly named SOP (no clarification). Works for one section
    // across N SOPs, or M sections across N SOPs. Partial = only one named
    // operation has a published SOP → answer it and acknowledge the missing.
    if (multi && multi.jobIds.length >= 2) {
      return {
        route: 'direct',
        directKind: 'multi_sop_section',
        targetJobIds: multi.jobIds,
        targetSectionTypes: sections,
        sectionType,
        confidence: 0.85,
        reason: `Multi-operation request combining ${sections.join(', ')} across the named SOPs.`,
      };
    }
    if (multi && multi.partial && multi.jobIds.length === 1) {
      return {
        route: 'direct',
        directKind: 'multi_sop_section',
        targetJobIds: multi.jobIds,
        targetSectionTypes: sections,
        sectionType,
        partialMissing: true,
        confidence: 0.8,
        reason: `Multi-operation request; one named operation has no published SOP.`,
      };
    }
    // Follow-up anaphora: the question refers back to prior SOPs ("what about
    // the materials for both?") without re-naming them. When a collective
    // anaphor is present and 2+ prior-turn SOPs are still eligible, combine the
    // requested section across them instead of asking the user to re-specify.
    if (!multi && focusJobIds.length >= 2 && ANAPHOR_RE.test(q)) {
      const focusJobs = focusJobIds
        .map(id => findSopByJobId(knowledge, id))
        .filter((j): j is NonNullable<typeof j> => j !== null);
      if (focusJobs.length >= 2) {
        return {
          route: 'direct',
          directKind: 'multi_sop_section',
          targetJobIds: focusJobs.map(j => j.id),
          targetSectionTypes: sections,
          sectionType,
          confidence: 0.8,
          reason: 'Follow-up referring to previous SOPs; combining the requested section across them.',
        };
      }
    }

    const target = resolveTargetSop(knowledge, q, focusJobIds);
    if (target.jobId) {
      // Procedure is only direct when explicitly listing (not explaining).
      // When procedure is the SOLE requested section, gate it; when requested
      // alongside other sections the user is clearly listing, so allow direct.
      if (sections.length === 1 && sectionType === 'procedure') {
        const isListing = hasAnyWord(q, ['list', 'show']) ||
          hasPhrase(q, 'what are the steps') || hasPhrase(q, 'what steps') ||
          hasPhrase(q, 'list the steps') || hasPhrase(q, 'show the steps');
        if (!isListing) {
          return {
            route: 'generative',
            confidence: 0.7,
            reason: 'Procedure section without explicit listing intent.',
          };
        }
      }
      return {
        route: 'direct',
        directKind: 'section_listing',
        targetJobId: target.jobId,
        targetSectionTypes: sections,
        sectionType,
        confidence: 0.85,
        reason: `Clear ${sections.join(', ')} listing for an identified SOP.`,
      };
    }
    if (target.ambiguous) {
      return {
        route: 'clarification',
        confidence: 0.6,
        reason: `${sections.join(', ')} listing with ambiguous target SOP.`,
        ambiguousJobIds: target.ambiguous,
      };
    }
    // Section keyword(s) present but no target. If the question names a
    // credible operation no SOP covers, report no match (no content); if it is
    // too vague to tell which SOP, ask for clarification.
    if (knowledge.jobs.length > 0) {
      if (questionNamesUnmatchedOperation(knowledge, q)) {
        return { route: 'no_match', confidence: 0.7, reason: 'No eligible SOP covers the named operation.' };
      }
      return {
        route: 'clarification',
        confidence: 0.6,
        reason: `${sections.join(', ')} listing without a clear target SOP.`,
      };
    }
    return { route: 'no_match', confidence: 0.7, reason: 'No eligible SOPs.' };
  }

  // ── 5. Resource request ──────────────────────────────────────────────
  if (detectResourceRequest(q)) {
    const target = resolveTargetSop(knowledge, q, focusJobIds);
    if (target.jobId) {
      return {
        route: 'direct',
        directKind: 'resource_request',
        targetJobId: target.jobId,
        confidence: 0.85,
        reason: 'Resource request for an identified SOP.',
      };
    }
    if (target.ambiguous) {
      return {
        route: 'clarification',
        confidence: 0.6,
        reason: 'Resource request with ambiguous target SOP.',
        ambiguousJobIds: target.ambiguous,
      };
    }
    return {
      route: 'generative',
      confidence: 0.5,
      reason: 'Resource request without a clear target SOP.',
    };
  }

  // ── 6. Trade/category listing ──────────────────────────────────────────
  const tradeListing = detectTradeListing(q, knowledge);
  if (tradeListing) {
    return {
      route: 'direct',
      directKind: 'trade_listing',
      tradeFilter: tradeListing.trade,
      categoryFilter: tradeListing.category,
      confidence: 0.8,
      reason: 'Trade/category listing request.',
    };
  }

  // ── 7. SOP discovery (title match) ────────────────────────────────────
  if (hasAnyWord(q, [...LISTING_WORDS]) || hasPhrase(q, 'do we have')) {
    const scored = knowledge.jobs
      .map(job => ({ job, score: titleMatchScore(q, job.title || '') }))
      .filter(s => s.score >= 0.7)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 1) {
      return {
        route: 'direct',
        directKind: 'sop_discovery',
        targetJobId: scored[0].job.id,
        confidence: 0.8,
        reason: 'Single SOP title match for discovery request.',
      };
    }
    if (scored.length === 0 && knowledgeComplete) {
      return {
        route: 'no_match',
        confidence: 0.7,
        reason: 'No SOP title matches the discovery request.',
      };
    }
    if (scored.length > 1) {
      return {
        route: 'generative',
        confidence: 0.5,
        reason: 'Multiple SOP title matches for discovery request.',
      };
    }
  }

  // ── 8. Ordinal / SOP-name selection after clarification ──────────────
  // "the first one", "the second one", or a bare SOP name from the offered
  // list. Resolved deterministically — the section is inherited from the
  // previous user question so the user gets the tools/materials/etc. they
  // originally asked about.
  if (focusJobIds.length > 0 || (clarCtx && clarCtx.candidateJobIds.length > 0)) {
    const selection = detectClarificationSelection(knowledge, q, focusJobIds, history, clarCtx);
    if (selection) return selection;
  }

  // ── 9. Default → generative ───────────────────────────────────────────
  return {
    route: 'generative',
    confidence: 0.5,
    reason: 'No clear direct-retrieval pattern detected.',
  };
}