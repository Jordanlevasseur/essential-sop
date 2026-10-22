/**
 * directAnswerBuilder.ts — Stage 3: Direct Answer Construction.
 *
 * Builds natural, readable Markdown answers from structured company knowledge
 * for high-confidence direct-retrieval cases. No AI calls. Uses the ACTUAL
 * documented content — preserving order, quantities, specifications, warnings,
 * and other relevant metadata. Never paraphrases away procedural details.
 *
 * SECURITY: all content comes from the already-authorized CompanyKnowledge.
 * This module never fetches external URL contents or ingests linked documents.
 * Company Resource links are presented as metadata only — a link does not
 * mean its contents have been read or verified by AI.
 *
 * Sources shape (compatible with existing frontend):
 *   { jobId: string, jobTitle: string, sectionType: string, section: string, item: string }
 */
import {
  CompanyKnowledge,
  KnowledgeContentItem,
  KnowledgeResource,
  findSopByJobId,
  findSopsByTrade,
  findSopsByCategory,
  getSectionItems,
  getResourcesForJob,
  SECTION_LABELS,
} from './companyKnowledgeEngine.ts';
import { RoutingDecision } from './assistantRouter.ts';

const NO_MATCH_ANSWER =
  "I couldn't find an approved company SOP covering that. No procedure in your company library matches this topic.\n\nFor anything safety-critical, consult your supervisor and the equipment manufacturer's instructions before proceeding. If you believe a procedure should exist, ask an administrator to add it.";

/**
 * buildDirectAnswer — construct a direct answer and sources from the routing
 * decision. Handles 'direct', 'clarification', and 'no_match' routes.
 * Returns { answer, sources }.
 */
export function buildDirectAnswer(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[]; resources: any[] } {
  switch (decision.route) {
    case 'direct':
      return buildDirect(knowledge, decision);
    case 'clarification':
      return { ...buildClarification(knowledge, decision), resources: [] };
    case 'no_match':
      return { answer: NO_MATCH_ANSWER, sources: [], resources: [] };
    default:
      return { answer: NO_MATCH_ANSWER, sources: [], resources: [] };
  }
}

// ── Direct answer builders by kind ──────────────────────────────────────────

function buildDirect(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[]; resources: any[] } {
  // resource_request returns its own resources; all others default to [].
  if (decision.directKind === 'resource_request') {
    return buildResourceRequest(knowledge, decision);
  }
  let result: { answer: string; sources: any[] };
  switch (decision.directKind) {
    case 'section_listing':
      result = buildSectionListing(knowledge, decision); break;
    case 'multi_sop_section':
      result = buildMultiSopSection(knowledge, decision); break;
    case 'specific_step':
      result = buildSpecificStep(knowledge, decision); break;
    case 'trade_listing':
      result = buildTradeListing(knowledge, decision); break;
    case 'count':
      result = buildCount(knowledge, decision); break;
    case 'sop_discovery':
      result = buildSopDiscovery(knowledge, decision); break;
    default:
      return { answer: NO_MATCH_ANSWER, sources: [], resources: [] };
  }
  return { ...result, resources: [] };
}

// ── Section listing ──────────────────────────────────────────────────────────

function buildSectionListing(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[] } {
  const job = findSopByJobId(knowledge, decision.targetJobId!);
  if (!job) return { answer: NO_MATCH_ANSWER, sources: [] };

  const sectionType = decision.sectionType!;
  const sectionLabel = SECTION_LABELS[sectionType] || sectionType;
  const items = getSectionItems(knowledge, job.id, sectionType);

  const introMap: Record<string, string> = {
    tools: `Here are the approved tools for **${job.title}**:`,
    materials: `Here are the approved materials for **${job.title}**:`,
    safety: `Here are the documented safety requirements for **${job.title}**:`,
    quality: `Here are the quality standards for **${job.title}**:`,
    scope: `Here is the scope for **${job.title}**:`,
    procedure: `Here are the procedure steps for **${job.title}**:`,
  };
  const intro = introMap[sectionType] || `Here is the ${sectionLabel} for **${job.title}**:`;

  let body: string;
  if (items.length === 0) {
    body = `No ${sectionLabel.toLowerCase()} are documented for **${job.title}**.`;
  } else if (sectionType === 'safety') {
    body = formatSafetyItems(items);
  } else if (sectionType === 'procedure') {
    body = formatProcedureItems(items);
  } else {
    body = formatGeneralItems(items, sectionType);
  }

  const answer = `${intro}\n\n${body}`;
  const sources = [{
    jobId: job.id,
    jobTitle: job.title,
    sectionType,
    section: sectionLabel,
    item: items.length > 0 ? items[0].title : sectionLabel,
  }];

  return { answer, sources };
}

// ── Multi-operation section (combined request) ──────────────────────────────
// A combined request ("What tools do I need to hang and tape drywall?")
// names 2+ operations and wants the section from BOTH SOPs. We combine them
// into ONE answer (no clarification): tools/materials are de-duplicated and
// attributed to their source SOP(s); procedure/safety are grouped by
// operation so order and identity are preserved. Each cited source is a
// distinct published SOP. When partialMissing is set, only one named
// operation had a published SOP — we answer it and explicitly acknowledge
// the missing source (never fabricate the other operation's content).
function multiItemLine(it: KnowledgeContentItem, sectionType: string): string {
  const req = it.isRequired ? ' (Required)' : '';
  const title = `**${it.title || ''}**${req}`;
  const meta = formatMetadata(it.metadata, sectionType);
  if (it.body && meta) return `${title} — ${it.body}\n   ${meta}`;
  if (it.body) return `${title} — ${it.body}`;
  if (meta) return `${title}\n   ${meta}`;
  return title;
}

function buildMultiSopSection(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[] } {
  const ids = decision.targetJobIds || [];
  const jobs = ids
    .map(id => findSopByJobId(knowledge, id))
    .filter((j): j is NonNullable<typeof j> => j !== null);
  const sectionType = decision.sectionType!;
  const sectionLabel = SECTION_LABELS[sectionType] || sectionType;

  if (jobs.length === 0) {
    return {
      answer: "I couldn't find a published company SOP for the operations you mentioned. Ask an administrator if a procedure should be added.",
      sources: [],
    };
  }

  const opNames = jobs.map(j => j.title);
  const introOps = opNames.length === 2
    ? `${opNames[0]} and ${opNames[1]}`
    : opNames.join(', ');

  const lines: string[] = [];

  if (sectionType === 'tools' || sectionType === 'materials') {
    // Union with per-source attribution; de-duplicate by title.
    lines.push(`Here are the approved ${sectionLabel.toLowerCase()} for ${introOps}, from your company SOPs:\n`);
    // Union with per-source attribution; de-duplicate by title. Attribution
    // tracks job IDs (not titles) so two distinct SOPs sharing a title do not
    // cross-contaminate each other's "only" group — items are attributed to
    // the exact job that documents them.
    const map = new Map<string, { title: string; body: string; meta: string; isRequired: boolean; ops: { id: string; title: string }[] }>();
    for (const job of jobs) {
      const items = getSectionItems(knowledge, job.id, sectionType);
      for (const it of items) {
        const key = (it.title || '').toLowerCase().trim() || it.id;
        if (!map.has(key)) {
          map.set(key, {
            title: it.title, body: it.body || '',
            meta: formatMetadata(it.metadata, sectionType),
            isRequired: !!it.isRequired, ops: [],
          });
        }
        map.get(key)!.ops.push({ id: job.id, title: job.title });
      }
    }
    const entries = [...map.values()];
    const shared = entries.filter(e => e.ops.length >= 2);
    const perOpOnly = jobs.map(j => ({
      job: j,
      items: entries.filter(e => e.ops.length === 1 && e.ops[0].id === j.id),
    }));
    let n = 1;
    if (shared.length > 0) {
      lines.push(`**Shared across the operations**`);
      for (const e of shared) {
        lines.push(`${n}. ${e.title}${e.isRequired ? ' (Required)' : ''}${e.body ? ' — ' + e.body : ''}${e.meta ? '\n   ' + e.meta : ''}`);
        lines.push(`   _Sources: ${e.ops.map(o => o.title).join(', ')}_`);
        n++;
      }
      lines.push('');
    }
    for (const g of perOpOnly) {
      if (g.items.length === 0) continue;
      // Disambiguate duplicate titles with a short id suffix so two distinct
      // same-named SOPs read as separate sections, not merged.
      const dupCount = jobs.filter(j => j.title === g.job.title).length;
      const heading = dupCount > 1
        ? `**${g.job.title} only** (${g.job.id.slice(-4)})`
        : `**${g.job.title} only**`;
      lines.push(heading);
      for (const e of g.items) {
        lines.push(`${n}. ${e.title}${e.isRequired ? ' (Required)' : ''}${e.body ? ' — ' + e.body : ''}${e.meta ? '\n   ' + e.meta : ''}`);
        n++;
      }
      lines.push('');
    }
    if (shared.length === 0 && perOpOnly.every(g => g.items.length === 0)) {
      lines.push(`No ${sectionLabel.toLowerCase()} are documented for these operations.`);
    }
  } else {
    // procedure / safety / quality / scope — group by operation (identity/order).
    lines.push(`Here is the ${sectionLabel.toLowerCase()} for ${introOps}, from your company SOPs:\n`);
    let n = 1;
    for (const job of jobs) {
      const items = getSectionItems(knowledge, job.id, sectionType);
      lines.push(`**${job.title}**`);
      if (items.length === 0) {
        lines.push(`No ${sectionLabel.toLowerCase()} are documented for **${job.title}**.`);
        lines.push('');
        continue;
      }
      if (sectionType === 'safety') {
        for (const it of items) {
          const sev = it.metadata?.severity ? ` (${it.metadata.severity})` : '';
          const crit = it.isCritical ? ' (Critical)' : '';
          lines.push(`${n}. **${it.title}**${sev}${crit}`);
          if (it.body) lines.push(`   ${it.body}`);
          n++;
        }
      } else {
        for (const it of items) {
          lines.push(`${n}. **${it.title}**`);
          if (it.body) lines.push(`   ${it.body}`);
          n++;
        }
      }
      lines.push('');
    }
  }

  if (decision.partialMissing) {
    lines.push(`_I could only find a published company SOP for **${jobs[0].title}**. I did not find an approved SOP for the other operation you mentioned, so I can't provide that part. Ask an administrator if a procedure should be added._`);
  }

  const answer = lines.join('\n').trim();
  const sources = jobs.map(j => {
    const items = getSectionItems(knowledge, j.id, sectionType);
    return {
      jobId: j.id,
      jobTitle: j.title,
      sectionType,
      section: sectionLabel,
      item: items.length > 0 ? items[0].title : sectionLabel,
    };
  });

  return { answer, sources };
}

function formatGeneralItems(items: KnowledgeContentItem[], sectionType: string): string {
  const lines: string[] = [];
  items.forEach((it, i) => {
    const num = `${i + 1}. `;
    const req = it.isRequired ? ' (Required)' : '';
    const title = `**${it.title}**${req}`;
    const meta = formatMetadata(it.metadata, sectionType);
    if (it.body && meta) {
      lines.push(`${num}${title} — ${it.body}\n   ${meta}`);
    } else if (it.body) {
      lines.push(`${num}${title} — ${it.body}`);
    } else if (meta) {
      lines.push(`${num}${title}\n   ${meta}`);
    } else {
      lines.push(`${num}${title}`);
    }
  });
  return lines.join('\n');
}

function formatSafetyItems(items: KnowledgeContentItem[]): string {
  const lines: string[] = [];
  items.forEach(it => {
    const severity = it.metadata?.severity ? ` (${it.metadata.severity})` : '';
    const crit = it.isCritical ? ' (Critical)' : '';
    lines.push(`**${it.title}**${severity}${crit}`);
    if (it.body) lines.push(it.body);
    const reqAction = it.metadata?.requiredAction;
    if (reqAction) lines.push(`   **Required action:** ${reqAction}`);
    lines.push('');
  });
  return lines.join('\n').trim();
}

function formatProcedureItems(items: KnowledgeContentItem[]): string {
  const lines: string[] = [];
  items.forEach((it, i) => {
    const num = `${i + 1}. `;
    lines.push(`${num}**${it.title}**`);
    if (it.body) lines.push(`   ${it.body}`);
    if (it.metadata?.warning) lines.push(`   **Warning:** ${it.metadata.warning}`);
    if (it.metadata?.tip) lines.push(`   **Tip:** ${it.metadata.tip}`);
  });
  return lines.join('\n');
}

function formatMetadata(metadata: Record<string, any>, sectionType: string): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const parts: string[] = [];
  if (metadata.quantity) parts.push(`Qty: ${metadata.quantity}`);
  if (metadata.specification) parts.push(`Spec: ${metadata.specification}`);
  return parts.join(' · ');
}

// ── Specific step ────────────────────────────────────────────────────────────

function buildSpecificStep(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[] } {
  const job = findSopByJobId(knowledge, decision.targetJobId!);
  if (!job) return { answer: NO_MATCH_ANSWER, sources: [] };

  const stepNum = decision.stepNumber!;
  const items = getSectionItems(knowledge, job.id, 'procedure');

  if (stepNum > items.length) {
    const answer = `Step ${stepNum} does not exist in **${job.title}**. This procedure has ${items.length} documented step${items.length === 1 ? '' : 's'}.`;
    return {
      answer,
      sources: [{
        jobId: job.id, jobTitle: job.title, sectionType: 'procedure',
        section: 'Procedure', item: `Step ${stepNum}`,
      }],
    };
  }

  if (items.length === 0) {
    const answer = `No procedure steps are documented for **${job.title}**.`;
    return {
      answer,
      sources: [{
        jobId: job.id, jobTitle: job.title, sectionType: 'procedure',
        section: 'Procedure', item: 'Procedure',
      }],
    };
  }

  const step = items[stepNum - 1];
  const lines: string[] = [`Step ${stepNum} of **${job.title}**:\n`, `**${step.title}**`];
  if (step.body) lines.push(step.body);
  if (step.metadata?.warning) lines.push(`\n**Warning:** ${step.metadata.warning}`);
  if (step.metadata?.tip) lines.push(`\n**Tip:** ${step.metadata.tip}`);

  return {
    answer: lines.join('\n'),
    sources: [{
      jobId: job.id, jobTitle: job.title, sectionType: 'procedure',
      section: 'Procedure', item: step.title,
    }],
  };
}

// ── Resource request ────────────────────────────────────────────────────────

const RESOURCE_TYPE_LABEL: Record<string, string> = {
  youtube: 'YouTube Video',
  manual: 'Manual',
  pdf: 'PDF',
  documentation: 'Documentation',
  training: 'Training',
  website: 'Website',
  other: 'Resource',
};

function buildResourceRequest(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[]; resources: any[] } {
  const job = findSopByJobId(knowledge, decision.targetJobId!);
  if (!job) return { answer: NO_MATCH_ANSWER, sources: [], resources: [] };

  const jobResources = getResourcesForJob(knowledge, job.id);

  if (jobResources.length === 0) {
    const answer = `No authorized resources are linked to **${job.title}**.`;
    return {
      answer,
      sources: [{
        jobId: job.id, jobTitle: job.title, sectionType: 'scope',
        section: 'Scope', item: job.title,
      }],
      resources: [],
    };
  }

  // Markdown answer lists titles, types, and descriptions. The actual
  // tappable links are rendered as distinct resource cards in the frontend
  // (visually distinguishable from internal SOP source cards). No raw URLs
  // are dumped into the answer text — the cards provide the links.
  const lines: string[] = [`Here are the authorized resources for **${job.title}**:\n`];
  jobResources.forEach((r, i) => {
    const typeLabel = RESOURCE_TYPE_LABEL[r.resourceType] || 'Resource';
    lines.push(`${i + 1}. **${r.title}** (${typeLabel})`);
    if (r.description) lines.push(`   ${r.description}`);
  });
  lines.push('\n_A resource link does not mean its contents have been verified or approved as procedural authority._');

  const resourceCards = jobResources.map(r => ({
    id: r.id,
    title: r.title,
    resourceType: r.resourceType,
    description: r.description || '',
    url: r.url,
    parentJobId: job.id,
    parentJobTitle: job.title,
  }));

  return {
    answer: lines.join('\n'),
    sources: [{
      jobId: job.id, jobTitle: job.title, sectionType: 'scope',
      section: 'Scope', item: job.title,
    }],
    resources: resourceCards,
  };
}

// ── Trade/category listing ───────────────────────────────────────────────────

function buildTradeListing(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[] } {
  let jobs: any[];
  let filterLabel: string;

  if (decision.tradeFilter) {
    jobs = findSopsByTrade(knowledge, decision.tradeFilter);
    filterLabel = decision.tradeFilter;
  } else if (decision.categoryFilter) {
    jobs = findSopsByCategory(knowledge, decision.categoryFilter);
    filterLabel = decision.categoryFilter;
  } else {
    jobs = knowledge.jobs;
    filterLabel = '';
  }

  if (jobs.length === 0) {
    const knowledgeComplete = knowledge.metrics?.complete ?? true;
    if (!knowledgeComplete) {
      return {
        answer: `I may not have the complete list of SOPs right now due to system limits. Could you try again, or ask an administrator if you believe ${filterLabel ? `**${filterLabel}**` : ''} SOPs should exist?`,
        sources: [],
      };
    }
    const answer = filterLabel
      ? `No approved SOPs were found for **${filterLabel}** in your company library.`
      : `No approved SOPs were found in your company library.`;
    return { answer, sources: [] };
  }

  const lines: string[] = filterLabel
    ? [`Here are your company's **${filterLabel}** SOPs:\n`]
    : [`Here are your company's approved SOPs:\n`];

  jobs.forEach((j, i) => {
    lines.push(`${i + 1}. ${j.title}`);
  });
  lines.push(`\n(${jobs.length} SOP${jobs.length === 1 ? '' : 's'})`);

  const sources = jobs.map(j => ({
    jobId: j.id, jobTitle: j.title, sectionType: 'scope',
    section: 'Scope', item: j.title,
  }));

  return { answer: lines.join('\n'), sources };
}

// ── Count ───────────────────────────────────────────────────────────────────

function buildCount(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[] } {
  const knowledgeComplete = knowledge.metrics?.complete ?? true;

  // Count all SOPs
  if (!decision.targetJobId && !decision.sectionType) {
    const count = knowledge.jobs.length;
    if (knowledgeComplete) {
      return {
        answer: `Your company library has **${count}** approved SOP${count === 1 ? '' : 's'}.`,
        sources: [],
      };
    }
    return {
      answer: `Your company library has at least **${count}** approved SOP${count === 1 ? '' : 's'}.\n\n*Some procedures may not be shown due to system limits.*`,
      sources: [],
    };
  }

  // Count section items for a specific SOP
  const job = findSopByJobId(knowledge, decision.targetJobId!);
  if (!job) return { answer: NO_MATCH_ANSWER, sources: [] };

  const sectionType = decision.sectionType!;
  const sectionLabel = SECTION_LABELS[sectionType] || sectionType;
  const items = getSectionItems(knowledge, job.id, sectionType);
  const count = items.length;

  const answer = `**${job.title}** has **${count}** approved ${sectionLabel.toLowerCase()}.`;
  return {
    answer,
    sources: [{
      jobId: job.id, jobTitle: job.title, sectionType,
      section: sectionLabel, item: sectionLabel,
    }],
  };
}

// ── SOP discovery ────────────────────────────────────────────────────────────

function buildSopDiscovery(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[] } {
  const job = findSopByJobId(knowledge, decision.targetJobId!);
  if (!job) return { answer: NO_MATCH_ANSWER, sources: [] };

  const lines: string[] = [`Found **${job.title}** in your company library.\n`];
  if (job.shortDescription) lines.push(job.shortDescription);
  const meta: string[] = [];
  if (job.trade) meta.push(`Trade: ${job.trade}`);
  if (job.category) meta.push(`Category: ${job.category}`);
  if (meta.length > 0) lines.push('\n' + meta.join(' | '));

  return {
    answer: lines.join('\n'),
    sources: [{
      jobId: job.id, jobTitle: job.title, sectionType: 'scope',
      section: 'Scope', item: job.title,
    }],
  };
}

// ── Clarification ───────────────────────────────────────────────────────────

function buildClarification(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision
): { answer: string; sources: any[] } {
  const ambiguousIds = decision.ambiguousJobIds || [];
  const jobs = ambiguousIds
    .map(id => findSopByJobId(knowledge, id))
    .filter((j): j is NonNullable<typeof j> => j !== null);

  if (jobs.length === 0) {
    return {
      answer: "I couldn't determine which SOP you're referring to. Could you specify the SOP by name? For example, \"What tools do I need for Deck Stair Repair?\"",
      sources: [],
    };
  }

  const lines: string[] = [
    'I found multiple SOPs that could match your question. Which one are you referring to?\n',
  ];
  jobs.forEach((j, i) => {
    lines.push(`${i + 1}. ${j.title}`);
  });
  lines.push('\nPlease specify the SOP by name, or ask about a specific section (e.g., "What tools do I need for Deck Stair Repair?").');

  const sources = jobs.map(j => ({
    jobId: j.id, jobTitle: j.title, sectionType: 'scope',
    section: 'Scope', item: j.title,
  }));

  return { answer: lines.join('\n'), sources };
}