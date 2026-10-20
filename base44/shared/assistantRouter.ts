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
} from './companyKnowledgeEngine.ts';

export type RouteKind = 'direct' | 'generative' | 'no_match' | 'clarification';
export type DirectKind =
  | 'sop_discovery'
  | 'section_listing'
  | 'specific_step'
  | 'resource_request'
  | 'trade_listing'
  | 'count';

export interface RoutingDecision {
  route: RouteKind;
  directKind?: DirectKind;
  targetJobId?: string;
  sectionType?: string;
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
 * Detect the requested section type from the question. Returns the sectionType
 * if exactly one section is clearly requested, or null if ambiguous/none.
 * Exported for testability.
 */
export function detectSectionType(question: string): string | null {
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
  if (found.length === 1) return found[0];
  return null;
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
 * Score how well a question references a job title. Returns 0..1.
 * 1.0 = full title substring in question. Lower = partial token overlap.
 */
function titleMatchScore(question: string, jobTitle: string): number {
  const q = question.toLowerCase();
  const title = (jobTitle || '').toLowerCase().trim();
  if (!title) return 0;
  if (q.includes(title)) return 1.0;
  const titleTokens = title.match(/[a-z0-9]+/g) || [];
  const significant = titleTokens.filter(t => t.length > 2);
  if (significant.length === 0) return 0;
  let hits = 0;
  for (const t of significant) {
    if (q.includes(t)) hits++;
  }
  return hits / significant.length;
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
    .filter(s => s.score > 0)
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

  // ── 1. Generative intent → generative ──────────────────────────────────
  if (hasGenerativeIntent(q)) {
    return {
      route: 'generative',
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

  // ── 4. Section listing ────────────────────────────────────────────────
  const sectionType = detectSectionType(q);
  if (sectionType) {
    const target = resolveTargetSop(knowledge, q, focusJobIds);
    if (target.jobId) {
      // For procedure: only direct if explicitly listing (not explaining)
      if (sectionType === 'procedure') {
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
        sectionType,
        confidence: 0.85,
        reason: `Clear ${sectionType} listing for an identified SOP.`,
      };
    }
    if (target.ambiguous) {
      return {
        route: 'clarification',
        confidence: 0.6,
        reason: `${sectionType} listing with ambiguous target SOP.`,
        ambiguousJobIds: target.ambiguous,
      };
    }
    // Section keyword present but no target — ask which SOP
    if (knowledge.jobs.length > 0) {
      return {
        route: 'clarification',
        confidence: 0.6,
        reason: `${sectionType} listing without a clear target SOP.`,
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