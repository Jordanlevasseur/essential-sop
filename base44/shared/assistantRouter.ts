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
    // No title match — try focus (revalidated against current eligible set)
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
  focusJobIds: string[] = []
): RoutingDecision {
  const q = question.trim();
  const knowledgeComplete = knowledge.metrics?.complete ?? true;

  // Multi-operation detection (combined requests like "hang AND tape drywall").
  // Computed once and reused by the generative and section-listing branches.
  const multi = detectMultiOperation(knowledge, q);

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

  // ── 8. Default → generative ───────────────────────────────────────────
  return {
    route: 'generative',
    confidence: 0.5,
    reason: 'No clear direct-retrieval pattern detected.',
  };
}