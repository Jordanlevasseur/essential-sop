/**
 * directAnswerBuilder.ts — Stage 3: Direct Answer Construction.
 *
 * Builds clean, natural Markdown answers from structured company knowledge
 * for high-confidence direct-retrieval cases. No AI calls. Uses the ACTUAL
 * documented content — preserving order, quantities, specifications,
 * warnings, and other relevant metadata. Never paraphrases away procedural
 * details.
 *
 * FORMATTING PRINCIPLE:
 *   - Tools/materials → clean bullet lists of item names by default.
 *   - Procedure → numbered steps (body + warnings always preserved).
 *   - Safety → readable bullets preserving warnings and required actions.
 *   - Multi-SOP → a distinct heading (SOP name) for each operation.
 *   - Detail (descriptions, quantities, specs, required/optional) is shown
 *     ONLY when the user explicitly asks for it.
 *   - Every Markdown block is separated by a blank line so the renderer
 *     never collapses a heading and a list onto the same line.
 *
 * SECURITY: all content comes from the already-authorized CompanyKnowledge.
 * This module never fetches external URL contents or ingests linked
 * documents. Company Resource links are presented as metadata only.
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

// ── Detail-level detection ──────────────────────────────────────────────────
// The default answer shows only item names (tools/materials). Descriptions,
// quantities, specifications, and required/optional labels are included ONLY
// when the user explicitly asks for them. This is a presentation choice only
// — the underlying database records are never modified.

interface DetailLevel {
  descriptions: boolean;
  quantities: boolean;
  specs: boolean;
  required: boolean;
}

function detectDetailLevel(question: string): DetailLevel {
  const q = (question || '').toLowerCase();
  return {
    descriptions: /\bdescri/.test(q) || /\bdetail/.test(q) || /\bexplain/.test(q) || /with description/.test(q) || /what.*used for/.test(q),
    quantities: /\bhow many/.test(q) || /\bquantit/.test(q) || /\bamount/.test(q) || /\bnumber of/.test(q),
    specs: /\bspec/.test(q) || /what size/.test(q) || /what kind/.test(q) || /what type/.test(q),
    required: /which.*required/.test(q) || /required.*optional/.test(q) || /optional.*required/.test(q) || /required vs/.test(q) || /which.*mandatory/.test(q),
  };
}

function formatMetadata(metadata: Record<string, any>): string {
  if (!metadata || typeof metadata !== 'object') return '';
  const parts: string[] = [];
  if (metadata.quantity) parts.push(`Qty: ${metadata.quantity}`);
  if (metadata.specification) parts.push(`Spec: ${metadata.specification}`);
  return parts.join(' · ');
}

// ── Item formatters ──────────────────────────────────────────────────────────

/** Format a tool/material/scope/quality item as a bullet. Default: name only. */
function formatItemBullet(item: KnowledgeContentItem, _sectionType: string, detail: DetailLevel): string {
  const name = item.title || '';
  const anyDetail = detail.descriptions || detail.quantities || detail.specs || detail.required;
  const label = anyDetail ? `**${name}**` : name;

  if (detail.required && item.isRequired) {
    const extras: string[] = [];
    if (detail.descriptions && item.body) extras.push(item.body);
    const meta = formatMetadata(item.metadata);
    if ((detail.quantities || detail.specs) && meta) extras.push(meta);
    return extras.length > 0 ? `- ${label} (Required) — ${extras.join(' · ')}` : `- ${label} (Required)`;
  }

  const extras: string[] = [];
  if (detail.descriptions && item.body) extras.push(item.body);
  const meta = formatMetadata(item.metadata);
  if ((detail.quantities || detail.specs) && meta) extras.push(meta);
  return extras.length > 0 ? `- ${label} — ${extras.join(' · ')}` : `- ${label}`;
}

/** Format a safety item as a bullet, always preserving warnings and required actions. */
function formatSafetyBullet(item: KnowledgeContentItem): string[] {
  const name = item.title || '';
  // Deduplicate: if severity is already "Critical", do not add a second "(Critical)".
  const tags: string[] = [];
  if (item.metadata?.severity) tags.push(item.metadata.severity);
  if (item.isCritical && item.metadata?.severity !== 'Critical') tags.push('Critical');
  const tagStr = tags.length > 0 ? ` (${tags.join(', ')})` : '';
  const lines = [`- **${name}**${tagStr}`];
  if (item.body) lines.push(`  ${item.body}`);
  const reqAction = item.metadata?.requiredAction;
  if (reqAction) lines.push(`  **Required action:** ${reqAction}`);
  return lines;
}

/** Format a procedure step as a numbered item, always with body and warnings. */
function formatProcedureStep(item: KnowledgeContentItem, index: number): string[] {
  const num = index + 1;
  const lines = [`${num}. **${item.title}**`];
  if (item.body) lines.push(`   ${item.body}`);
  if (item.metadata?.warning) lines.push(`   **Warning:** ${item.metadata.warning}`);
  if (item.metadata?.tip) lines.push(`   **Tip:** ${item.metadata.tip}`);
  return lines;
}

// ── Main entry ───────────────────────────────────────────────────────────────

export function buildDirectAnswer(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision,
  question: string
): { answer: string; sources: any[]; resources: any[] } {
  switch (decision.route) {
    case 'direct':
      return buildDirect(knowledge, decision, question);
    case 'clarification':
      return { ...buildClarification(knowledge, decision), resources: [] };
    case 'no_match':
      return { answer: NO_MATCH_ANSWER, sources: [], resources: [] };
    default:
      return { answer: NO_MATCH_ANSWER, sources: [], resources: [] };
  }
}

function buildDirect(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision,
  question: string
): { answer: string; sources: any[]; resources: any[] } {
  if (decision.directKind === 'resource_request') {
    return buildResourceRequest(knowledge, decision);
  }
  let result: { answer: string; sources: any[] };
  switch (decision.directKind) {
    case 'section_listing':
      result = buildSectionListing(knowledge, decision, question); break;
    case 'multi_sop_section':
      result = buildMultiSopSection(knowledge, decision, question); break;
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

// ── Section listing (single SOP) ─────────────────────────────────────────────

function buildSectionListing(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision,
  question: string
): { answer: string; sources: any[] } {
  const job = findSopByJobId(knowledge, decision.targetJobId!);
  if (!job) return { answer: NO_MATCH_ANSWER, sources: [] };

  const sectionTypes = (decision.targetSectionTypes && decision.targetSectionTypes.length > 0)
    ? decision.targetSectionTypes
    : (decision.sectionType ? [decision.sectionType] : []);
  if (sectionTypes.length === 0) return { answer: NO_MATCH_ANSWER, sources: [] };

  const detail = detectDetailLevel(question);
  const multi = sectionTypes.length > 1;
  const sources: any[] = [];
  const lines: string[] = [];

  for (const sectionType of sectionTypes) {
    const sectionLabel = SECTION_LABELS[sectionType] || sectionType;
    const items = getSectionItems(knowledge, job.id, sectionType);

    // Heading: include the SOP name when single-section; bare label when multi.
    if (multi) {
      lines.push(`### ${sectionLabel}`);
    } else {
      lines.push(`### ${sectionLabel} for ${job.title}`);
    }
    lines.push('');

    if (items.length === 0) {
      lines.push(`No ${sectionLabel.toLowerCase()} are documented for **${job.title}**.`);
      lines.push('');
    } else if (sectionType === 'procedure') {
      items.forEach((it, i) => lines.push(...formatProcedureStep(it, i)));
      lines.push('');
    } else if (sectionType === 'safety') {
      items.forEach(it => lines.push(...formatSafetyBullet(it)));
      lines.push('');
    } else {
      items.forEach(it => lines.push(formatItemBullet(it, sectionType, detail)));
      lines.push('');
    }

    sources.push({
      jobId: job.id,
      jobTitle: job.title,
      sectionType,
      section: sectionLabel,
      item: items.length > 0 ? items[0].title : sectionLabel,
    });
  }

  return { answer: lines.join('\n').trim(), sources };
}

// ── Multi-operation answer (N SOPs × M sections) ─────────────────────────────
// Each SOP gets its own heading (SOP name) and its own list. No cross-SOP
// de-duplication, no "shared/only" grouping. Each cited source is a distinct
// published SOP.

function buildMultiSopSection(
  knowledge: CompanyKnowledge,
  decision: RoutingDecision,
  question: string
): { answer: string; sources: any[] } {
  const ids = decision.targetJobIds || [];
  const jobs = ids
    .map(id => findSopByJobId(knowledge, id))
    .filter((j): j is NonNullable<typeof j> => j !== null);

  const sectionTypes = (decision.targetSectionTypes && decision.targetSectionTypes.length > 0)
    ? decision.targetSectionTypes
    : (decision.sectionType ? [decision.sectionType] : []);

  if (jobs.length === 0) {
    return {
      answer: "I couldn't find a published company SOP for the operations you mentioned. Ask an administrator if a procedure should be added.",
      sources: [],
    };
  }
  if (sectionTypes.length === 0) {
    return { answer: NO_MATCH_ANSWER, sources: [] };
  }

  const detail = detectDetailLevel(question);
  const multiSection = sectionTypes.length > 1;
  const lines: string[] = [];
  const sources: any[] = [];

  for (const sectionType of sectionTypes) {
    const sectionLabel = SECTION_LABELS[sectionType] || sectionType;

    if (multiSection) {
      lines.push(`### ${sectionLabel}`);
      lines.push('');
    }

    for (const job of jobs) {
      const items = getSectionItems(knowledge, job.id, sectionType);
      lines.push(`#### ${job.title}`);
      lines.push('');

      if (items.length === 0) {
        lines.push(`No ${sectionLabel.toLowerCase()} are documented.`);
        lines.push('');
      } else if (sectionType === 'procedure') {
        items.forEach((it, i) => lines.push(...formatProcedureStep(it, i)));
        lines.push('');
      } else if (sectionType === 'safety') {
        items.forEach(it => lines.push(...formatSafetyBullet(it)));
        lines.push('');
      } else {
        items.forEach(it => lines.push(formatItemBullet(it, sectionType, detail)));
        lines.push('');
      }
    }

    for (const job of jobs) {
      const items = getSectionItems(knowledge, job.id, sectionType);
      sources.push({
        jobId: job.id,
        jobTitle: job.title,
        sectionType,
        section: sectionLabel,
        item: items.length > 0 ? items[0].title : sectionLabel,
      });
    }
  }

  if (decision.partialMissing) {
    lines.push(`_I could only find a published company SOP for **${jobs[0].title}**. I did not find an approved SOP for the other operation you mentioned, so I can't provide that part. Ask an administrator if a procedure should be added._`);
  }

  return { answer: lines.join('\n').trim(), sources };
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
  const lines: string[] = [`### Step ${stepNum} of ${job.title}`, ''];
  lines.push(`**${step.title}**`);
  if (step.body) { lines.push(''); lines.push(step.body); }
  if (step.metadata?.warning) { lines.push(''); lines.push(`**Warning:** ${step.metadata.warning}`); }
  if (step.metadata?.tip) { lines.push(''); lines.push(`**Tip:** ${step.metadata.tip}`); }

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

  const lines: string[] = [`### Resources for ${job.title}`, ''];
  jobResources.forEach(r => {
    const typeLabel = RESOURCE_TYPE_LABEL[r.resourceType] || 'Resource';
    let line = `- **${r.title}** (${typeLabel})`;
    if (r.description) line += `\n  ${r.description}`;
    lines.push(line);
  });
  lines.push('');
  lines.push('_A resource link does not mean its contents have been verified or approved as procedural authority._');

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

  const heading = filterLabel
    ? `### ${filterLabel} SOPs`
    : `### Company SOPs`;
  const lines: string[] = [heading, ''];
  jobs.forEach(j => lines.push(`- ${j.title}`));
  lines.push('');
  lines.push(`(${jobs.length} SOP${jobs.length === 1 ? '' : 's'})`);

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

  const lines: string[] = [`### ${job.title}`, ''];
  if (job.shortDescription) lines.push(job.shortDescription);
  const meta: string[] = [];
  if (job.trade) meta.push(`Trade: ${job.trade}`);
  if (job.category) meta.push(`Category: ${job.category}`);
  if (meta.length > 0) { lines.push(''); lines.push(meta.join(' · ')); }

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
    'I found multiple SOPs that could match. Which one are you referring to?',
    '',
  ];
  jobs.forEach((j, i) => lines.push(`${i + 1}. ${j.title}`));
  lines.push('');
  lines.push('Reply with the number or name (e.g., "1" or "Taping") to select one.');

  const sources = jobs.map(j => ({
    jobId: j.id, jobTitle: j.title, sectionType: 'scope',
    section: 'Scope', item: j.title,
  }));

  return { answer: lines.join('\n'), sources };
}