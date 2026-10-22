/**
 * companyKnowledgeEngine.ts — Structured Company Knowledge Engine.
 *
 * Stage 2 of the Assistant 2.0 roadmap. Provides a typed, structured view
 * over the authorized company knowledge output by resolveAssistantContext,
 * plus reusable internal helpers for the future request router (Stage 3).
 *
 * This module does NOT implement request routing, direct answers, or AI-call
 * optimization. It is a pure knowledge foundation: types, structured access,
 * normalized terminology, and ranking utilities.
 *
 * SECURITY: all knowledge originates from resolveAssistantContext, which
 * enforces the same eligibility rules as the current Assistant (active
 * membership, Published, non-archived, active assignment, active Master,
 * published version, override resolution). This module never re-fetches or
 * re-authorizes — it only provides structured views over already-authorized
 * data. A future direct-answer path using these helpers has identical access
 * to the current generative Assistant — no broader, no narrower.
 */
import { resolveAssistantContext } from './assistantRetrieval.ts';

// ── Types ───────────────────────────────────────────────────────────────────

export interface KnowledgeContentItem {
  jobId: string;
  sectionType: string;
  itemId: string;
  contentType: string;
  title: string;
  body: string;
  sortOrder: number;
  isRequired: boolean;
  isCritical: boolean;
  metadata: Record<string, any>;
}

export interface KnowledgeResource {
  id: string;
  jobId: string;
  title: string;
  url: string;
  resourceType: string;
  description: string;
  displayOrder: number;
}

export interface KnowledgeMetrics {
  eligibleJobCount: number;
  contentItemCount: number;
  resourceCount: number;
  retrievalDurationMs: number;
  complete: boolean;
  limits: {
    jobs: boolean;
    content: boolean;
    overrides: boolean;
    resources: boolean;
  };
  errors: string[];
}

export interface CompanyKnowledge {
  jobs: any[];
  contentIndex: KnowledgeContentItem[];
  resources: KnowledgeResource[];
  metrics: KnowledgeMetrics;
}

export const SECTION_TYPES = ['scope', 'tools', 'materials', 'procedure', 'safety', 'quality'] as const;
export type SectionType = typeof SECTION_TYPES[number];

export const SECTION_LABELS: Record<string, string> = {
  scope: 'Scope',
  tools: 'Tools',
  materials: 'Materials',
  procedure: 'Procedure',
  safety: 'Safety',
  quality: 'Quality Standards',
};

// ── Normalized terminology (bounded synonym groups) ──────────────────────────
// Conservative construction-term equivalence groups. Used to expand query
// tokens so "sheetrock" finds "drywall" SOPs. Bounded: only well-established
// industry synonyms. NOT an unbounded expansion engine and NOT AI-driven.

const SYNONYM_GROUPS: string[][] = [
  ['drywall', 'sheetrock', 'gypsum board', 'wallboard', 'plasterboard'],
  ['ppe', 'personal protective equipment', 'protective equipment', 'safety gear'],
  ['hvac', 'heating ventilation air conditioning', 'heating', 'ventilation', 'air conditioning'],
  ['crawlspace', 'crawl space', 'underfloor'],
  ['water heater', 'hot water heater', 'boiler'],
  ['soffit', 'eave', 'fascia'],
  ['receptacle', 'outlet', 'socket', 'plug'],
  ['vinyl siding', 'vinyl', 'siding'],
  ['downspout', 'gutter', 'gutter downspout'],
  ['threshold', 'sill', 'door sill'],
  ['foundation', 'footing', 'slab'],
  ['circuit breaker', 'breaker', 'fuse box'],
];

// Build a lookup: each term → all equivalent terms (including itself).
export const SYNONYM_MAP: Record<string, string[]> = (() => {
  const map: Record<string, string[]> = {};
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      map[term.toLowerCase()] = group.map((t) => t.toLowerCase());
    }
  }
  return map;
})();

/**
 * expandQueryTokens — expand a set of query tokens with synonym equivalents.
 * Bounded: only tokens present in SYNONYM_MAP are expanded. Original tokens
 * are always preserved. Does NOT make AI calls. Does NOT expand tokens not in
 * the map, preventing false matches from unbounded synonym expansion.
 */
export function expandQueryTokens(tokens: string[]): string[] {
  const out = new Set<string>(tokens);
  for (const t of tokens) {
    const syns = SYNONYM_MAP[t.toLowerCase()];
    if (syns) for (const s of syns) out.add(s);
  }
  return [...out];
}

/**
 * stripSuffix — strip common English inflection suffixes (-ing, -ed, -s) so a
 * query token matches its titled form. Conservative: only strips when the
 * remaining stem is long enough to be meaningful (avoids stripping "ing"
 * from a 3-char token). Does NOT strip a lone trailing 'e' here — that is
 * handled by the silent-e rule in stemMatches.
 */
function stripSuffix(t: string): string {
  if (t.length > 4 && t.endsWith('ing')) return t.slice(0, -3);
  if (t.length > 3 && t.endsWith('ed')) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/**
 * stemMatches — conservative stem match between two tokens, handling the
 * cases that matter for construction SOP titles:
 *   - exact:               "taping" == "taping"
 *   - suffix-stripped:     "hang" == stripped("hanging") → "hang" == "hang"
 *   - silent-e conjugation: "tape" vs stripped("taping")="tap" → dropE → "tap"=="tap"
 *     (tape→taping drops the e, so a naive prefix check fails)
 *   - prefix (>=4 chars):  "install" prefix-of "installation"
 * Short tokens ("dry" 3, "mud" 3, "for" 3) are intentionally NOT matched to
 * longer unrelated words — they fail the >=4 prefix and the >=3 stem/e-drop
 * equality checks. Exported for reuse by the router and ranking utility.
 */
export function stemMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const sa = stripSuffix(a);
  const sb = stripSuffix(b);
  if (sa === sb && sa.length >= 3) return true;
  const dropE = (w: string) => (w.endsWith('e') ? w.slice(0, -1) : w);
  const ea = dropE(sa);
  const eb = dropE(sb);
  if (ea === eb && ea.length >= 3) return true;
  const lo = a.length <= b.length ? a : b;
  const hi = a.length <= b.length ? b : a;
  if (lo.length >= 4 && hi.startsWith(lo)) return true;
  return false;
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * resolveCompanyKnowledge — the single entry point for the structured
 * knowledge view. Wraps resolveAssistantContext and returns the typed
 * CompanyKnowledge structure. All eligibility enforcement happens inside
 * resolveAssistantContext — this function adds no new authorization.
 */
export async function resolveCompanyKnowledge(SR: any, companyId: string): Promise<CompanyKnowledge> {
  return (await resolveAssistantContext(SR, companyId)) as CompanyKnowledge;
}

// ── Structured access helpers (operate on resolved knowledge, no DB calls) ───

/**
 * getJobSummary — returns the resolved job summary for an eligible SOP, or null.
 * Verified identifier lookup — a jobId not in the eligible set returns null
 * (no bypass of authorization).
 */
export function getJobSummary(knowledge: CompanyKnowledge, jobId: string): any | null {
  return knowledge.jobs.find((j: any) => j.id === jobId) || null;
}

/**
 * getAllEligibleJobIds — every eligible SOP's jobId in the knowledge.
 */
export function getAllEligibleJobIds(knowledge: CompanyKnowledge): string[] {
  return knowledge.jobs.map((j: any) => j.id);
}

/**
 * getSectionItems — returns all content items for a specific section of a
 * specific eligible SOP, preserving original sortOrder. Returns [] if the
 * job or section has no content. This is the core structured-access helper:
 * a future function can request the Tools section of an identified SOP
 * without parsing a flattened text prompt.
 */
export function getSectionItems(knowledge: CompanyKnowledge, jobId: string, sectionType: string): KnowledgeContentItem[] {
  return knowledge.contentIndex
    .filter((it) => it.jobId === jobId && it.sectionType === sectionType)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Convenience accessor for the Scope section of an eligible SOP. */
export const getScope = (k: CompanyKnowledge, jid: string): KnowledgeContentItem[] => getSectionItems(k, jid, 'scope');
/** Convenience accessor for the Tools section of an eligible SOP. */
export const getTools = (k: CompanyKnowledge, jid: string): KnowledgeContentItem[] => getSectionItems(k, jid, 'tools');
/** Convenience accessor for the Materials section of an eligible SOP. */
export const getMaterials = (k: CompanyKnowledge, jid: string): KnowledgeContentItem[] => getSectionItems(k, jid, 'materials');
/** Convenience accessor for the Procedure section of an eligible SOP. */
export const getProcedure = (k: CompanyKnowledge, jid: string): KnowledgeContentItem[] => getSectionItems(k, jid, 'procedure');
/** Convenience accessor for the Safety section of an eligible SOP. */
export const getSafety = (k: CompanyKnowledge, jid: string): KnowledgeContentItem[] => getSectionItems(k, jid, 'safety');
/** Convenience accessor for the Quality section of an eligible SOP. */
export const getQuality = (k: CompanyKnowledge, jid: string): KnowledgeContentItem[] => getSectionItems(k, jid, 'quality');

/**
 * getAllSections — returns a structured map of all six sections for a job,
 * each an ordered array of items. Sections with no content are [].
 */
export function getAllSections(knowledge: CompanyKnowledge, jobId: string): Record<string, KnowledgeContentItem[]> {
  const out: Record<string, KnowledgeContentItem[]> = {};
  for (const st of SECTION_TYPES) out[st] = getSectionItems(knowledge, jobId, st);
  return out;
}

/**
 * getResourcesForJob — authorized Company Resource metadata for an eligible
 * SOP, ordered by displayOrder. Returns [] if none. Resources are reference
 * metadata only — their external URL contents are NOT ingested as procedural
 * knowledge.
 */
export function getResourcesForJob(knowledge: CompanyKnowledge, jobId: string): KnowledgeResource[] {
  return knowledge.resources
    .filter((r) => r.jobId === jobId)
    .sort((a, b) => a.displayOrder - b.displayOrder);
}

// ── Discovery helpers (find eligible SOPs by structured criteria) ────────────

/**
 * findSopByJobId — verified identifier lookup. Returns the job summary or
 * null if the jobId is not in the eligible set.
 */
export function findSopByJobId(knowledge: CompanyKnowledge, jobId: string): any | null {
  return getJobSummary(knowledge, jobId);
}

/**
 * findSopsByTitle — find eligible SOPs whose resolved title matches.
 * Case-insensitive substring match by default; exact match if options.exact.
 */
export function findSopsByTitle(knowledge: CompanyKnowledge, query: string, options?: { exact?: boolean }): any[] {
  const q = (query || '').trim().toLowerCase();
  if (!q) return [];
  if (options?.exact) {
    return knowledge.jobs.filter((j: any) => (j.title || '').toLowerCase() === q);
  }
  return knowledge.jobs.filter((j: any) => (j.title || '').toLowerCase().includes(q));
}

/** findSopsByTrade — case-insensitive exact trade match. */
export function findSopsByTrade(knowledge: CompanyKnowledge, trade: string): any[] {
  const q = (trade || '').trim().toLowerCase();
  if (!q) return [];
  return knowledge.jobs.filter((j: any) => (j.trade || '').toLowerCase() === q);
}

/** findSopsByCategory — case-insensitive exact category match. */
export function findSopsByCategory(knowledge: CompanyKnowledge, category: string): any[] {
  const q = (category || '').trim().toLowerCase();
  if (!q) return [];
  return knowledge.jobs.filter((j: any) => (j.category || '').toLowerCase() === q);
}

/** findSopsByTag — case-insensitive tag match. */
export function findSopsByTag(knowledge: CompanyKnowledge, tag: string): any[] {
  const q = (tag || '').trim().toLowerCase();
  if (!q) return [];
  return knowledge.jobs.filter((j: any) =>
    Array.isArray(j.tags) && j.tags.some((t: string) => t.toLowerCase() === q)
  );
}

/** findSopsBySectionType — eligible SOPs that have content in a given section. */
export function findSopsBySectionType(knowledge: CompanyKnowledge, sectionType: string): any[] {
  const jobIds = new Set(
    knowledge.contentIndex
      .filter((it) => it.sectionType === sectionType)
      .map((it) => it.jobId)
  );
  return knowledge.jobs.filter((j: any) => jobIds.has(j.id));
}

// ── Ranking utility (internal, for Stage 3 router) ───────────────────────────

/**
 * rankJobsByQuery — score eligible SOPs against a query using token + bigram
 * overlap with optional synonym expansion. Returns jobs sorted by score
 * descending. This is an INTERNAL utility prepared for Stage 3; it is NOT
 * wired into askAssistant during Stage 2. The current askAssistant scoring
 * is unchanged.
 */
export function rankJobsByQuery(
  knowledge: CompanyKnowledge,
  query: string,
  options?: { expandSynonyms?: boolean }
): { job: any; score: number }[] {
  const stopwords = new Set([
    'the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'by', 'with',
    'how', 'what', 'which', 'is', 'are', 'do', 'does', 'did', 'i', 'my', 'me', 'we',
    'this', 'that', 'it', 'its', 'can', 'will', 'be', 'should', 'would', 'could',
    'please', 'tell', 'show', 'give', 'about',
  ]);
  const tokenize = (s: string): string[] =>
    (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [])
      .filter((t) => t.length > 2 && !stopwords.has(t));

  let qTokens = tokenize(query);
  if (options?.expandSynonyms) qTokens = expandQueryTokens(qTokens);
  const qBigrams: string[] = [];
  for (let i = 0; i < qTokens.length - 1; i++) qBigrams.push(`${qTokens[i]} ${qTokens[i + 1]}`);
  const qTokenSet = new Set(qTokens);

  const itemsByJob: Record<string, KnowledgeContentItem[]> = {};
  for (const it of knowledge.contentIndex) {
    (itemsByJob[it.jobId] ||= []).push(it);
  }

  const scored = knowledge.jobs.map((job: any) => {
    const title = String(job.title || '').toLowerCase();
    const titleTokens = new Set(title.match(/[a-z0-9]+/g) || []);
    let score = 0;
    for (const t of qTokenSet) {
      for (const tt of titleTokens) { if (stemMatches(t, tt)) { score += 3; break; } }
    }
    for (const b of qBigrams) if (title.includes(b)) score += 6;

    const items = itemsByJob[job.id] || [];
    let contentHits = 0;
    let hasContentBigram = false;
    for (const it of items) {
      const text = `${it.title || ''} ${it.body || ''}`.toLowerCase();
      for (const t of qTokenSet) if (text.includes(t)) contentHits++;
      for (const b of qBigrams) if (text.includes(b)) hasContentBigram = true;
    }
    score += Math.min(contentHits, 12);
    if (hasContentBigram) score += 4;
    return { job, score };
  });

  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
}