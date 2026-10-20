import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveCompanyKnowledge } from '../../shared/companyKnowledgeEngine.ts';
import { routeAssistantRequest } from '../../shared/assistantRouter.ts';
import { buildDirectAnswer } from '../../shared/directAnswerBuilder.ts';
import { selectAiContext, ConversationMessage } from '../../shared/aiContextSelector.ts';

/**
 * askAssistant — AI field-operations assistant.
 *
 * Answers a technician's question using ONLY the company's approved SOPs.
 *
 * Pipeline (Stage 4):
 *   1. Authorize active membership of the caller's company (data isolation).
 *   2. Reuse the shared `resolveAssistantContext` retrieval (same data the
 *      resolveJobsForAssistant resolver returns) — never the whole library.
 *   3. Route the request via `routeAssistantRequest` (Stage 3). Direct,
 *      clarification, and no-match routes return structured answers with
 *      ZERO AI calls.
 *   4. For the generative route, `selectAiContext` (Stage 4) determines WHICH
 *      approved SOPs, sections, and content items are relevant to the
 *      question, preserves structured metadata (safety severity, warnings,
 *      quantities, specs, required/critical flags), and applies bounded
 *      size controls. Focus SOPs are revalidated against the current
 *      eligible set (stale focus silently dropped).
 *   5. If no relevant SOP is found, return a plain "no SOP found" answer
 *      with NO citations (no fabrication). Incomplete knowledge is reported
 *      honestly.
 *   6. Otherwise make ONE Core.InvokeLLM call with the intelligent context +
 *      filtered conversation history, asking for a Markdown answer and the
 *      sourceIds actually used.
 *   7. Build a compact sources list from the cited SOPs only (only SOPs
 *      included in the context can be cited — no fabricated citations).
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

const SECTION_LABEL: Record<string, string> = {
  scope: 'Scope', tools: 'Tools', materials: 'Materials',
  procedure: 'Procedure', safety: 'Safety', quality: 'Quality Standards',
};

const SYSTEM_PROMPT = `You are an intelligent field-operations assistant for a residential construction company. You answer technicians' questions using ONLY the approved company SOPs provided in the COMPANY SOPs section below.

RULES:
- Answer the user's actual question directly and practically. Synthesize the approved company instructions into a clear, actionable explanation.
- For procedural questions, give enough step-by-step detail to be genuinely useful, drawn from the provided SOPs.
- Include relevant safety precautions, severity levels, warnings, and required actions from the SOPs whenever applicable. NEVER omit a safety-critical detail, warning, or required action to keep the answer short.
- Preserve documented quantities, specifications, and measurements exactly as they appear in the SOPs.
- Use Markdown for readability: short headings (**bold** or ###), bullet lists, and numbered lists where helpful.
- When answering about MULTIPLE SOPs (compare, contrast, overlap, how they fit together): preserve source identity. Attribute information to the SOP it comes from (e.g., "Per the Drywall Patch SOP..."). If two SOPs contain conflicting documented information, explain the discrepancy rather than silently choosing one. Do not merge differing requirements from separate SOPs into an invented universal company policy.
- NEVER invent company-specific requirements, specs, torque values, codes, or steps that are not in the provided SOPs. Do not attribute general knowledge to a company SOP.
- If the provided SOPs do not cover the question, say plainly that no relevant company SOP was found, then give only brief, clearly-labeled general guidance that is safe and non-company-specific.
- If the context includes a NOTE about incomplete retrieval or size reduction, do not claim that a procedure or requirement definitively does not exist; say the available SOPs do not establish it.
- For follow-up questions, use the CONVERSATION history to resolve references like "it", "that SOP", or "the other one". If the user has clearly changed the subject, do not force previous context into the answer.
- Only cite SOPs whose content you actually used. Return their identifiers (e.g. "src-<jobId>") in "sourceIds". Never cite an SOP that was not provided in the context. Never fabricate item references.

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

    // ── Generative route: Stage 4 intelligent context selection + single AI call ──
    // The context selector determines WHICH SOPs, sections, and items are
    // relevant, preserves structured metadata (safety severity, warnings,
    // quantities, specs, required/critical flags), and applies bounded size
    // controls. It reuses the same resolved knowledge — no re-retrieval, no
    // additional AI calls for routing, summarization, or query-rewriting.
    const {
      contextText, historyText, includedSopIds, stats: contextStats,
    } = selectAiContext(knowledge, question, decision, focusJobIds, history as ConversationMessage[]);

    // ── No relevant SOP found: plain answer, no citations, no fabrication ──
    if (includedSopIds.length === 0) {
      const noMatchAnswer = contextStats.knowledgeComplete
        ? "I couldn't find an approved company SOP covering that. No procedure in your company library matches this topic.\n\nFor anything safety-critical, consult your supervisor and the equipment manufacturer's instructions before proceeding. If you believe a procedure should exist, ask an administrator to add it."
        : "I couldn't find an approved company SOP covering that in the available records. Some procedures may not be shown due to system limits.\n\nFor anything safety-critical, consult your supervisor and the equipment manufacturer's instructions before proceeding. If you believe a procedure should exist, ask an administrator to add it.";
      return Response.json({
        answer: noMatchAnswer, sources: [], route: 'no_match',
        _routingMetrics: makeRoutingMetrics(
          'no_match', knowledge, _routeDurationMs, _totalStartTime,
          0, 0, decision.confidence, null
        ),
      });
    }

    // ── Build the prompt with the intelligent context ──
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

    // ── Map cited sourceIds → compact sources (only SOPs included in context) ──
    // The model can ONLY cite SOPs that were included in the context — never
    // an SOP that was not provided. This prevents fabricated citations.
    const validIds = new Set(includedSopIds);
    let cited: string[] = Array.isArray(aiRaw?.sourceIds)
      ? aiRaw.sourceIds
          .map((x: any) => String(x).replace(/^src-/, ''))
          .filter((id: string) => validIds.has(id))
      : [];
    // De-duplicate, preserve order.
    cited = Array.from(new Set(cited));
    if (cited.length === 0) {
      // Fallback: cite the single most relevant included SOP.
      cited = [includedSopIds[0]];
    }

    const qTokens = tokenize(question);
    const sources = cited.map((jobId: string) => {
      const job = jobs.find((j: any) => j.id === jobId);
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
      _contextStats: contextStats,
    });
  } catch (error: any) {
    return Response.json({ error: 'An unexpected error occurred.' }, { status: 500 });
  }
}