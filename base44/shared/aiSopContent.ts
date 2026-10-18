/**
 * aiSopContent.ts — Shared AI SOP authoring logic.
 *
 * Reused by:
 *   - generateMasterSopDraft (platform Master SOP AI builder)
 *   - generateCompanySopDraft (company SOP AI authoring)
 *
 * Extracting these here guarantees a single implementation of the AI system
 * prompt, response schema, and output validation/coercion, so company AI
 * authoring produces the same six-section structure and quality as the
 * platform builder. No persistence, publishing, or authorization logic lives
 * here — callers own that. This is a behavior-preserving extraction (same
 * precedent as masterSopDraftFactory.ts).
 */
import { SECTION_TYPES } from './masterSopDraftFactory.ts';
export { SECTION_TYPES };

export const VALID_CONTENT_TYPES = new Set([
  'text', 'numberedStep', 'checklist', 'tool', 'material', 'warning', 'qualityCheck',
]);

export function defaultTypeForSection(sectionType: string): string {
  const map: Record<string, string> = {
    tools: 'tool',
    materials: 'material',
    scope: 'text',
    procedure: 'numberedStep',
    safety: 'warning',
    quality: 'qualityCheck',
  };
  return map[sectionType] || 'text';
}

// Section metadata reused by the company draft creator (JobSection titles +
// descriptions mirror src/lib/constants SECTION_DEFINITIONS; backend cannot
// import src/, so the six canonical values are mirrored here).
export const SECTION_META: Record<string, { title: string; description: string }> = {
  tools: { title: 'Tools', description: 'Review required and optional equipment.' },
  materials: { title: 'Materials', description: 'Confirm products, quantities, and specifications.' },
  scope: { title: 'Scope', description: 'Understand what work is included, excluded, and expected.' },
  procedure: { title: 'Procedure', description: 'Follow the approved step-by-step process.' },
  safety: { title: 'Safety', description: 'Review hazards, PPE, and required precautions.' },
  quality: { title: 'Quality Standards', description: 'Acceptable completed work standards for this job.' },
};

export const SYSTEM_PROMPT = `You are an expert residential construction operations specialist and safety professional. Your task is to author an Essential SOP — a Standard Operating Procedure for residential construction field teams — returned as strict JSON.

AUDIENCE: technicians, project leads, and field crews. Write clearly, concisely, and actionably. Avoid marketing language. Use plain field terminology.

OUTPUT — a JSON object with:
- "title": concise SOP title (e.g. "Interior Door Installation")
- "description": one or two sentence summary
- "trade": one of Plumbing, Carpentry, Electrical, Drywall, Roofing, Inspection, Waterproofing, HVAC, Painting, General (or a close fit)
- "category": short category (e.g. "Doors & Windows", "Interior", "Exterior")
- "tags": array of short lowercase tags
- "sections": an object with EXACTLY these six keys, each an array of content items:
    1. "tools"      — required and optional tools/equipment. Use contentType "tool". Put quantity in metadata.quantity.
    2. "materials"  — materials and supplies. Use contentType "material". Put spec in metadata.specification, quantity in metadata.quantity.
    3. "scope"      — what work is included, excluded, and the expected outcome. Use contentType "text" or "checklist".
    4. "procedure"  — sequential steps in order. Use contentType "numberedStep". Put a safety caution in metadata.warning and a helpful tip in metadata.tip when relevant.
    5. "safety"     — hazards, PPE, precautions, and stop-work conditions. Use contentType "warning". Set metadata.severity to one of "Information", "Caution", "Warning", "Critical".
    6. "quality"    — acceptance criteria, quality standards, and completion checks. Use contentType "qualityCheck" or "checklist".

Each content item shape:
  { "contentType": string, "title": string, "body": string, "isRequired": boolean, "isCritical": boolean, "metadata": object }

WRITING STANDARD:
- Be professional, practical, field-usable, safety-conscious, quality-conscious, and action-oriented.
- Include pre-work inspection, preparation, sequential procedure, quality control, completion criteria, and stop-work conditions where appropriate.
- 3 to 12 items per section where the work warrants; keep titles short (ideally under 12 words) and bodies focused.
- Set isRequired=true for items that must not be skipped. Set isCritical=true for safety-critical items.
- DO NOT invent OSHA citations, building codes, torque values, dimensions, manufacturer specifications, or regulatory references. If such a detail is needed, write "[VERIFY: <what to verify>]" inside the body and keep the title general.
- Flag any item that requires human verification of local code or manufacturer instructions.

OUTPUT ONLY the JSON object matching the schema. No commentary, no markdown, no surrounding text.`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    trade: { type: 'string' },
    category: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    sections: {
      type: 'object',
      properties: {
        tools: { type: 'array', items: { type: 'object', properties: {
          contentType: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
          isRequired: { type: 'boolean' }, isCritical: { type: 'boolean' }, metadata: { type: 'object' },
        } } },
        materials: { type: 'array', items: { type: 'object', properties: {
          contentType: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
          isRequired: { type: 'boolean' }, isCritical: { type: 'boolean' }, metadata: { type: 'object' },
        } } },
        scope: { type: 'array', items: { type: 'object', properties: {
          contentType: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
          isRequired: { type: 'boolean' }, isCritical: { type: 'boolean' }, metadata: { type: 'object' },
        } } },
        procedure: { type: 'array', items: { type: 'object', properties: {
          contentType: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
          isRequired: { type: 'boolean' }, isCritical: { type: 'boolean' }, metadata: { type: 'object' },
        } } },
        safety: { type: 'array', items: { type: 'object', properties: {
          contentType: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
          isRequired: { type: 'boolean' }, isCritical: { type: 'boolean' }, metadata: { type: 'object' },
        } } },
        quality: { type: 'array', items: { type: 'object', properties: {
          contentType: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
          isRequired: { type: 'boolean' }, isCritical: { type: 'boolean' }, metadata: { type: 'object' },
        } } },
      },
    },
  },
  required: ['title', 'sections'],
};

/**
 * validateAndCleanAiSop — validate the raw full-SOP AI output and produce a
 * clean SOP object. Tolerant of malformed/missing/truncated fields: bad items
 * are dropped, invalid contentTypes are coerced to the section default,
 * oversized strings are truncated. Returns { ok: true, sop } on success.
 */
export function validateAndCleanAiSop(raw: any): { ok: boolean; sop?: any; errors?: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['AI response was not a JSON object.'] };
  }

  const rawTitle = raw.title;
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
    errors.push('Missing or empty "title".');
  }

  const rawSections = raw.sections;
  if (!rawSections || typeof rawSections !== 'object' || Array.isArray(rawSections)) {
    errors.push('Missing "sections" object.');
  }

  if (errors.length > 0) return { ok: false, errors };

  const clean: any = {
    title: String(rawTitle).trim().slice(0, 200),
    description: typeof raw.description === 'string' ? raw.description.slice(0, 1000) : '',
    trade: typeof raw.trade === 'string' ? raw.trade.slice(0, 80) : '',
    category: typeof raw.category === 'string' ? raw.category.slice(0, 80) : '',
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t: any) => typeof t === 'string').map((t: string) => t.slice(0, 40)).slice(0, 20)
      : [],
    sections: {},
  };

  for (const st of SECTION_TYPES) {
    const arr = (rawSections as any)[st];
    if (!Array.isArray(arr)) {
      clean.sections[st] = [];
      continue;
    }
    const cleanItems: any[] = [];
    for (const it of arr) {
      if (!it || typeof it !== 'object') continue;
      const t = typeof it.title === 'string' ? it.title.trim() : '';
      if (!t) continue;
      const ct = typeof it.contentType === 'string' && VALID_CONTENT_TYPES.has(it.contentType)
        ? it.contentType
        : defaultTypeForSection(st);
      cleanItems.push({
        contentType: ct,
        title: t.slice(0, 500),
        body: typeof it.body === 'string' ? it.body.slice(0, 4000) : '',
        isRequired: !!it.isRequired,
        isCritical: !!it.isCritical,
        metadata: it.metadata && typeof it.metadata === 'object' && !Array.isArray(it.metadata) ? it.metadata : {},
      });
    }
    clean.sections[st] = cleanItems;
  }

  const totalItems = SECTION_TYPES.reduce((n, st) => n + clean.sections[st].length, 0);
  if (totalItems === 0) {
    errors.push('AI produced no usable content items.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, sop: clean };
}

// ── Per-section generation (regenerate / refine one section only) ────────────

export const SECTION_GUIDE: Record<string, string> = {
  tools: 'Required and optional tools/equipment. Use contentType "tool". Put quantity in metadata.quantity.',
  materials: 'Materials and supplies. Use contentType "material". Put spec in metadata.specification, quantity in metadata.quantity.',
  scope: 'What work is included, excluded, and the expected outcome. Use contentType "text" or "checklist".',
  procedure: 'Sequential steps in order. Use contentType "numberedStep". Put a safety caution in metadata.warning and a helpful tip in metadata.tip when relevant.',
  safety: 'Hazards, PPE, precautions, and stop-work conditions. Use contentType "warning". Set metadata.severity to one of "Information", "Caution", "Warning", "Critical".',
  quality: 'Acceptance criteria, quality standards, and completion checks. Use contentType "qualityCheck" or "checklist".',
};

export const SECTION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      contentType: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' },
      isRequired: { type: 'boolean' }, isCritical: { type: 'boolean' }, metadata: { type: 'object' },
    } } },
  },
  required: ['items'],
};

export function buildSectionPrompt(
  sectionType: string,
  ctx: { title: string; trade?: string; category?: string },
  instruction: string,
  existingItems: any[]
): string {
  const guide = SECTION_GUIDE[sectionType] || '';
  const existingText = (existingItems && existingItems.length > 0)
    ? `\nEXISTING ITEMS (improve or rewrite these; keep what is already correct):\n${existingItems.map((it: any, i: number) => `${i + 1}. ${it.title}${it.body ? ` — ${it.body}` : ''}`).join('\n')}\n`
    : '';
  return `You are an expert residential construction operations specialist and safety professional. Generate ONLY the "${sectionType}" section of an Essential SOP for a residential construction field team. Return strict JSON.

SOP TITLE: ${ctx.title || '(untitled)'}
${ctx.trade ? `TRADE: ${ctx.trade}\n` : ''}${ctx.category ? `CATEGORY: ${ctx.category}\n` : ''}${existingText}
SECTION GUIDANCE: ${guide}

WRITING STANDARD:
- Practical, field-usable, safety-conscious, action-oriented. No marketing language.
- 3 to 12 items where the work warrants; titles short (ideally under 12 words); bodies focused.
- Set isRequired=true for items that must not be skipped. Set isCritical=true for safety-critical items.
- DO NOT invent OSHA citations, building codes, torque values, dimensions, or manufacturer specs. If such a detail is needed, write "[VERIFY: <what to verify>]" in the body.
- This is a draft suggestion, not a verified company requirement.
${instruction ? `\nINSTRUCTION: ${instruction}\n` : ''}
Return ONLY JSON: { "items": [ { "contentType": string, "title": string, "body": string, "isRequired": boolean, "isCritical": boolean, "metadata": object } ] }`;
}

export function validateSectionItems(raw: any, sectionType: string): { ok: boolean; items?: any[]; errors?: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['AI response was not a JSON object.'] };
  }
  const arr = (raw as any).items;
  if (!Array.isArray(arr)) {
    return { ok: false, errors: ['Missing "items" array.'] };
  }
  const out: any[] = [];
  for (const it of arr) {
    if (!it || typeof it !== 'object') continue;
    const t = typeof it.title === 'string' ? it.title.trim() : '';
    if (!t) continue;
    const ct = typeof it.contentType === 'string' && VALID_CONTENT_TYPES.has(it.contentType)
      ? it.contentType
      : defaultTypeForSection(sectionType);
    out.push({
      contentType: ct,
      title: t.slice(0, 500),
      body: typeof it.body === 'string' ? it.body.slice(0, 4000) : '',
      isRequired: !!it.isRequired,
      isCritical: !!it.isCritical,
      metadata: it.metadata && typeof it.metadata === 'object' && !Array.isArray(it.metadata) ? it.metadata : {},
    });
  }
  if (out.length === 0) return { ok: false, errors: ['AI produced no usable items for this section.'] };
  return { ok: true, items: out };
}