import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveCompanyKnowledge } from '../../shared/companyKnowledgeEngine.ts';
import { routeAssistantRequest } from '../../shared/assistantRouter.ts';
import { buildDirectAnswer } from '../../shared/directAnswerBuilder.ts';

/**
 * askAssistant — AI field-operations assistant.
 *
 * Answers a technician's question using ONLY the company's approved SOPs.
 *
 * Pipeline:
 *   1. Authorize active membership of the caller's company (data isolation).
 *   2. Reuse the shared `resolveAssistantContext` retrieval (same data the
 *      resolveJobsForAssistant resolver returns) — never the whole library.
 *   3. Score every published job against the question (title token + bigram
 *      overlap weighted heavily; content matches modestly) and select only
 *      the strongly relevant ones via a relative threshold. Follow-up
 *      `focusJobIds` are force-included so conversation context is preserved.
 *   4. If nothing relevant is found, return a plain "no SOP found" answer
 *      with NO citations (no fabrication).
 *   5. Otherwise call Core.InvokeLLM with the selected SOP context + recent
 *      conversation history, asking for a Markdown answer and the sourceIds
 *      actually used.
 *   6. Build a compact sources list from the cited SOPs only (falling back to
 *      the top relevant SOP if the model omits sourceIds), each pointing at
 *      its most relevant section.
 *
 * Request:  { companyId, question, history?: [{role,text}], focusJobIds?: string[] }
 * Response: { answer: string, sources: [{ jobId, jobTitle, sectionType, section, item }] }
 *
 * Uses the built-in Core.InvokeLLM integration (no new external service).
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'and', 'or', 'in', 'on', 'at', 'by', 'with',
  'how', 'what', 'which', 'is', 'are', 'do', 'does', 'did', 'i', 'my', 'me', 'we',
  'this', 'that', 'it', 'its', 'can', 'will', 'be', 'should', 'would', 'could',
  'please', 'tell', 'show', 'give', 'about',
]);

const SECTION_ORDER = ['scope', 'tools', 'materials', 'procedure', 'safety', 'quality'];
const SECTION_LABEL: Record<string, string> = {
  scope: 'Scope', tools: 'Tools', materials: 'Materials',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

const SYSTEM_PROMPT = `You are an intelligent field-operations assistant for a residential construction company. You answer technicians' questions using ONLY the approved company SOPs provided in the COMPANY SOPs section below.

RULES:
- Answer the user's actual question directly and practically. Synthesize the approved company instructions into a clear, actionable explanation.
- For procedural questions, give enough step-by-step detail to be genuinely useful, drawn from the provided SOPs.
- Include relevant safety precautions from the SOPs whenever applicable.
- Use Markdown for readability: short headings (**bold** or ###), bullet lists, and numbered lists where helpful.
- NEVER invent company-specific requirements, specs, torque values, codes, or steps that are not in the provided SOPs. Do not attribute general knowledge to a company SOP.
- If the provided SOPs do not cover the question, say plainly that no relevant company SOP was found, then give only brief, clearly-labeled general guidance that is safe and non-company-specific.
- For follow-up questions, use the CONVERSATION history to resolve references like "it" or "that".
- Only cite SOPs whose content you actually used. Return their identifiers (e.g. "src-<jobId>") in "sourceIds".

Return ONLY a JSON object: { "answer": <markdown string>, "sourceIds": [<string>, ...] }`;

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'Markdown answer using only the provided company SOP context.' },
    sourceIds: { type: 'array', items: { type: 'string' }, description: 'The src-<jobId> identifiers of SOPs actually used.' },
  },
  required: ['answer'],
};

function tokenize(s: string): string[] {
  return (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

function scoreJob(job: any, qTokens: string[], qBigrams: string[], items: any[]): number {
  const title = String(job.title || '').toLowerCase();
  const titleTokens = new Set(title.match(/[a-z0-9]+/g) || []);
  let score = 0;
  for (const t of qTokens) if (titleTokens.has(t)) score += 3;
  for (const b of qBigrams) if (title.includes(b)) score += 6;

  let contentHits = 0;
  let hasContentBigram = false;
  for (const it of items) {
    const text = `${it.title || ''} ${it.body || ''}`.toLowerCase();
    for (const t of qTokens) if (text.includes(t)) contentHits++;
    for (const b of qBigrams) if (text.includes(b)) hasContentBigram = true;
  }
  score += Math.min(contentHits, 12);
  if (hasContentBigram) score += 4;
  return score;
}

function buildContextText(selected: any[], contentIndex: any[]): string {
  const byJob: Record<string, Record<string, any[]>> = {};
  for (const it of contentIndex) {
    if (!byJob[it.jobId]) byJob[it.jobId] = {};
    (byJob[it.jobId][it.sectionType] ||= []).push(it);
  }
  const parts: string[] = [];
  for (const s of selected) {
    const j = s.job;
    const secs = byJob[j.id] || {};
    const head = `### src-${j.id}: ${j.title}${j.trade ? ` (${j.trade})` : ''}${j.category ? ` — ${j.category}` : ''}`;
    parts.push(head);
    for (const st of SECTION_ORDER) {
      const items = secs[st];
      if (!items || items.length === 0) continue;
      parts.push(`${SECTION_LABEL[st]}:`);
      for (const it of items) {
        const body = String(it.body || '').trim();
        parts.push(body ? `- ${it.title}: ${body}` : `- ${it.title}`);
      }
    }
    parts.push('');
  }
  return parts.join('\n');
}

function buildHistoryText(history: any[]): string {
  if (!Array.isArray(history) || history.length === 0) return '(none)';
  return history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.text || '').slice(0, 800)}`).join('\n');
}

function pickBestSection(jobId: string, contentIndex: any[], qTokens: string[]): any | null {
  const items = contentIndex.filter(it => it.jobId === jobId);
  let best: any = null;
  let bestScore = -1;
  for (const it of items) {
    const text = `${it.title || ''} ${it.body || ''}`.toLowerCase();
    let sc = 0;
    for (const t of qTokens) if (text.includes(t)) sc++;
    if (sc > bestScore) { bestScore = sc; best = it; }
  }
  return best;
}

// ── Stage 3: non-sensitive routing instrumentation ──────────────────────────
// Measures only route, durations, counts, and completeness. Never logs or
// returns question text, SOP text, user content, or conversation content.
function makeRoutingMetrics(
  route: string, knowledge: any, routeDurationMs: number,
  totalStartTime: number, sourceCount: number, aiCalls: number,
  confidence: number, directKind?: string | null
) {
  return {
    route,
    directKind: directKind || null,
    aiCalls,
    knowledgeDurationMs: knowledge.metrics?.retrievalDurationMs ?? 0,
    routeDurationMs,
    totalDurationMs: Date.now() - totalStartTime,
    sourceCount,
    eligibleJobCount: knowledge.metrics?.eligibleJobCount ?? 0,
    knowledgeComplete: knowledge.metrics?.complete ?? true,
    confidence,
  };
}

export default async function (req: Request): Promise<Response> {
  const _totalStartTime = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const companyId = typeof body?.companyId === 'string' ? body.companyId : '';
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    const history = Array.isArray(body?.history) ? body.history : [];
    const focusJobIds = Array.isArray(body?.focusJobIds) ? body.focusJobIds.filter((x: any) => typeof x === 'string') : [];

    if (!companyId) return Response.json({ error: 'companyId is required' }, { status: 400 });
    if (!question) return Response.json({ error: 'question is required' }, { status: 400 });
    if (question.length > 2000) return Response.json({ error: 'question is too long' }, { status: 400 });

    // ── Authorization: active membership of this company (data isolation) ──
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, companyId, status: 'active',
    });
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // ── Retrieval (shared, resolver-backed, override-merged) ──
    // Stage 3: resolve once, reuse for both routing and generation.
    const knowledge = await resolveCompanyKnowledge(base44.asServiceRole, companyId);
    const { jobs, contentIndex } = knowledge;

    // ── Stage 3: Intelligent request routing ──
    const _routeStartTime = Date.now();
    const decision = routeAssistantRequest(knowledge, question, focusJobIds);
    const _routeDurationMs = Date.now() - _routeStartTime;

    // ── Direct / clarification routes: structured answer, no AI call ──
    if (decision.route === 'direct' || decision.route === 'clarification') {
      const { answer, sources } = buildDirectAnswer(knowledge, decision);
      return Response.json({
        answer, sources, route: decision.route,
        _routingMetrics: makeRoutingMetrics(
          decision.route, knowledge, _routeDurationMs, _totalStartTime,
          sources.length, 0, decision.confidence, decision.directKind
        ),
      });
    }

    // ── No-match route: no AI call ──
    if (decision.route === 'no_match') {
      return Response.json({
        answer:
          "I couldn't find an approved company SOP covering that. No procedure in your company library matches this topic.\n\nFor anything safety-critical, consult your supervisor and the equipment manufacturer's instructions before proceeding. If you believe a procedure should exist, ask an administrator to add it.",
        sources: [], route: 'no_match',
        _routingMetrics: makeRoutingMetrics(
          'no_match', knowledge, _routeDurationMs, _totalStartTime,
          0, 0, decision.confidence, null
        ),
      });
    }

    // ── Generative route: existing AI pipeline (same knowledge, no re-retrieval) ──
    const itemsByJob: Record<string, any[]> = {};
    for (const it of contentIndex) (itemsByJob[it.jobId] ||= []).push(it);

    const qTokens = tokenize(question);
    const qBigrams = bigrams(qTokens);

    const scored = jobs.map((j: any) => ({
      job: j,
      score: scoreJob(j, qTokens, qBigrams, itemsByJob[j.id] || []),
    }));

    const maxScore = scored.reduce((m: number, s: any) => Math.max(m, s.score), 0);

    let selected: any[] = [];
    if (maxScore > 0) {
      const threshold = Math.max(2, Math.ceil(maxScore * 0.5));
      selected = scored
        .filter((s: any) => s.score >= threshold)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 5);
    }

    // Follow-up context: force-include previously discussed SOPs.
    if (focusJobIds.length > 0) {
      const have = new Set(selected.map((s: any) => s.job.id));
      for (const s of scored) {
        if (focusJobIds.includes(s.job.id) && !have.has(s.job.id)) {
          selected.push(s);
          have.add(s.job.id);
        }
      }
    }

    // ── No relevant SOP found: plain answer, no citations, no fabrication ──
    if (selected.length === 0) {
      return Response.json({
        answer:
          "I couldn't find an approved company SOP covering that. No procedure in your company library matches this topic.\n\nFor anything safety-critical, consult your supervisor and the equipment manufacturer's instructions before proceeding. If you believe a procedure should exist, ask an administrator to add it.",
        sources: [], route: 'no_match',
        _routingMetrics: makeRoutingMetrics(
          'no_match', knowledge, _routeDurationMs, _totalStartTime,
          0, 0, decision.confidence, null
        ),
      });
    }

    // ── Build LLM context from the selected SOPs only ──
    const contextText = buildContextText(selected, contentIndex);
    const historyText = buildHistoryText(history);
    const prompt =
      `${SYSTEM_PROMPT}\n\n` +
      `COMPANY SOPs (approved, use ONLY these):\n${contextText}\n\n` +
      `CONVERSATION SO FAR:\n${historyText}\n\n` +
      `USER QUESTION:\n${question}\n\n` +
      `Return JSON: { "answer": string, "sourceIds": [string] }`;

    let aiRaw: any;
    try {
      aiRaw = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: ANSWER_SCHEMA,
      });
    } catch (e: any) {
      return Response.json(
        { code: 'AI_ERROR', error: 'The assistant could not generate an answer right now. Please try again.' },
        { status: 502 }
      );
    }

    if (typeof aiRaw === 'string') {
      try { aiRaw = JSON.parse(aiRaw); } catch (_) {
        return Response.json({ answer: 'The assistant returned an unexpected response. Please try again.', sources: [] });
      }
    }

    const answer: string = (aiRaw && typeof aiRaw.answer === 'string' && aiRaw.answer.trim())
      ? aiRaw.answer
      : 'The assistant could not produce an answer. Please try rephrasing your question.';

    // ── Map cited sourceIds → compact sources (only SOPs actually used) ──
    const validIds = new Set(selected.map((s: any) => s.job.id));
    let cited: string[] = Array.isArray(aiRaw?.sourceIds)
      ? aiRaw.sourceIds
          .map((x: any) => String(x).replace(/^src-/, ''))
          .filter((id: string) => validIds.has(id))
      : [];
    // De-duplicate, preserve order.
    cited = Array.from(new Set(cited));
    if (cited.length === 0) {
      // Fallback: cite the single most relevant SOP.
      cited = [selected[0].job.id];
    }

    const sources = cited.map((jobId: string) => {
      const s = selected.find((x: any) => x.job.id === jobId);
      const job = s ? s.job : null;
      const best = pickBestSection(jobId, contentIndex, qTokens);
      const sectionType = best?.sectionType || 'procedure';
      return {
        jobId,
        jobTitle: job ? job.title : 'Company SOP',
        sectionType,
        section: SECTION_LABEL[sectionType] || sectionType,
        item: best?.title || (job ? job.title : 'Procedure'),
      };
    });

    return Response.json({
      answer, sources, route: 'generative',
      _routingMetrics: makeRoutingMetrics(
        'generative', knowledge, _routeDurationMs, _totalStartTime,
        sources.length, 1, decision.confidence, null
      ),
    });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}