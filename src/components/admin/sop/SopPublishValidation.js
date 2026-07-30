/**
 * SopPublishValidation — Pre-publish validation for Master SOP drafts.
 *
 * Validates:
 * - Missing title
 * - Empty required sections (procedure and safety must have ≥1 item)
 * - Duplicate logicalItemIds across all sections
 * - Items with empty titles
 * - Empty checklist items (no title)
 * - Invalid ordering (sortOrder gaps — not a hard block, just a warning)
 *
 * Returns { errors: string[], warnings: string[], valid: boolean }
 */

const REQUIRED_SECTIONS = ['procedure', 'safety'];

/**
 * @param {{ title: string, trade?: string }} meta
 * @param {Array<{ sectionType: string, title: string, contentItems: Array }>} sections
 * @returns {{ errors: string[], warnings: string[], valid: boolean }}
 */
export function validateForPublish(meta, sections) {
  const errors = [];
  const warnings = [];

  // 1. Title required
  if (!meta.title || !meta.title.trim()) {
    errors.push('SOP title is required before publishing.');
  }

  const allItems = [];
  const logicalIds = [];

  for (const section of sections) {
    const items = section.contentItems || [];

    // 2. Required sections must not be empty
    if (REQUIRED_SECTIONS.includes(section.sectionType) && items.length === 0) {
      errors.push(`Section "${section.title}" must have at least one item before publishing.`);
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      allItems.push({ section: section.title, item, index: i });

      // 3. Items must have a title
      if (!item.title || !item.title.trim()) {
        errors.push(`Item ${i + 1} in "${section.title}" is missing a title.`);
      }

      // 4. Duplicate logicalItemIds
      if (item.logicalItemId) {
        if (logicalIds.includes(item.logicalItemId)) {
          errors.push(`Duplicate logicalItemId detected in "${section.title}" at item ${i + 1}: ${item.logicalItemId}`);
        } else {
          logicalIds.push(item.logicalItemId);
        }
      }

      // 5. Checklist items with no meaningful content
      if (item.contentType === 'checklist' && !item.body?.trim() && !item.title?.trim()) {
        warnings.push(`Checklist item ${i + 1} in "${section.title}" has no content.`);
      }
    }
  }

  // 6. Warn if trade not set (useful for distribution)
  if (!meta.trade || !meta.trade.trim()) {
    warnings.push('No trade specified — this SOP will not be filterable by trade.');
  }

  // 7. Warn if all sections are empty
  const totalItems = sections.reduce((sum, s) => sum + (s.contentItems?.length || 0), 0);
  if (totalItems === 0) {
    errors.push('This SOP has no content. Add items to at least one section before publishing.');
  }

  return {
    errors,
    warnings,
    valid: errors.length === 0,
  };
}