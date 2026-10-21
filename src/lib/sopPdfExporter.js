/**
 * sopPdfExporter — generates a professionally formatted PDF of a published
 * company SOP using jsPDF (client-side, no server upload, no DB writes).
 *
 * Input data is already authorized (resolveJob + resolveCompanyResources).
 * This module only lays out text; it does not modify, republish, or duplicate
 * any company record and never touches private storage / signed URLs.
 *
 * Output: { blob, filename } — caller creates an object URL for preview/share.
 */
import { jsPDF } from 'jspdf';
import { getResourceTypeConfig } from '@/components/resources/resourceTypes';

const DISPLAY_ORDER = ['scope', 'tools', 'materials', 'procedure', 'safety', 'quality'];

const SECTION_TITLES = {
  scope: 'Scope of Work',
  tools: 'Tools',
  materials: 'Materials',
  procedure: 'Procedure',
  safety: 'Safety',
  quality: 'Quality Standards',
};

const C = {
  navy: [23, 43, 70],
  blue: [15, 108, 189],
  text: [38, 45, 55],
  gray: [95, 105, 120],
  rule: [214, 220, 228],
  amber: [161, 74, 9],
};

function truncate(s, n) {
  s = (s || '').toString();
  return s.length > n ? s.slice(0, n - 1) + '...' : s;
}

function sanitizeFilename(s) {
  return (s || '').toString().replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'SOP';
}

function itemMarker(item, idx) {
  switch (item.contentType) {
    case 'numberedStep': return `${idx + 1}.`;
    case 'tool':
    case 'material':
    case 'qualityCheck': return '\u2022';
    case 'checklist': return '[ ]';
    default: return null; // text, documentationRequirement
  }
}

export function buildSopPdf({ job, contentBySection = {}, companyName, resources = [] }) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 54;
  const marginTop = 92;        // below the title header band on page 1
  const marginBottom = 60;
  const contentW = pageW - marginX * 2;
  const bottomLimit = pageH - marginBottom;
  let y = marginTop;

  // ── Page 1 title header band ──────────────────────────────────────────────
  const drawTitleHeader = () => {
    doc.setFillColor(...C.navy);
    doc.rect(0, 0, pageW, 64, 'F');
    doc.setFillColor(...C.blue);
    doc.rect(0, 64, pageW, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text('ESSENTIAL SOP', marginX, 28);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.text('Standard Operating Procedure', marginX, 44);
    if (companyName) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(truncate(companyName, 48), pageW - marginX, 28, { align: 'right' });
    }
  };
  drawTitleHeader();

  // ── Running header on subsequent pages ────────────────────────────────────
  const drawRunningHeader = () => {
    doc.setFillColor(...C.navy);
    doc.rect(0, 0, pageW, 26, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('ESSENTIAL SOP', marginX, 17);
    if (companyName) {
      doc.setFont('helvetica', 'normal');
      doc.text(truncate(companyName, 60), pageW - marginX, 17, { align: 'right' });
    }
  };

  const newPage = () => {
    doc.addPage();
    drawRunningHeader();
    y = 44;
  };

  // Write a pre-split block of lines, paginating as needed. Font/size/color set once.
  const writeBlock = (lines, x, size, font, color, lh) => {
    doc.setFont('helvetica', font);
    doc.setFontSize(size);
    doc.setTextColor(...(color || C.text));
    for (const line of lines) {
      if (y > bottomLimit) newPage();
      doc.text(line, x, y);
      y += lh;
    }
  };

  // ── Workspace line ────────────────────────────────────────────────────────
  if (companyName) {
    writeBlock(doc.splitTextToSize('Workspace: ' + companyName, contentW), marginX, 9, 'normal', C.gray, 12);
    y += 4;
  }

  // ── Title ─────────────────────────────────────────────────────────────────
  writeBlock(doc.splitTextToSize(job.title || 'Untitled SOP', contentW), marginX, 18, 'bold', C.navy, 22);

  // ── Short description ─────────────────────────────────────────────────────
  if (job.shortDescription) {
    writeBlock(doc.splitTextToSize(job.shortDescription, contentW), marginX, 10, 'normal', C.gray, 14);
    y += 3;
  }

  // ── Metadata (only present fields — never invented) ──────────────────────
  const metaParts = [];
  if (job.trade) metaParts.push('Trade: ' + job.trade);
  if (job.category) metaParts.push('Category: ' + job.category);
  if (job.skillLevel) metaParts.push('Skill Level: ' + job.skillLevel);
  if (job.estimatedDuration) metaParts.push('Est. Duration: ' + job.estimatedDuration);
  if (metaParts.length) {
    writeBlock(doc.splitTextToSize(metaParts.join('    '), contentW), marginX, 9, 'normal', C.gray, 12);
  }
  if (Array.isArray(job.tags) && job.tags.length) {
    writeBlock(doc.splitTextToSize('Tags: ' + job.tags.join(', '), contentW), marginX, 9, 'normal', C.gray, 12);
  }

  // ── Divider ──────────────────────────────────────────────────────────────
  y += 6;
  doc.setDrawColor(...C.rule); doc.setLineWidth(1);
  doc.line(marginX, y, pageW - marginX, y);
  y += 16;

  // ── Section heading + accent underline ───────────────────────────────────
  const drawSectionHeading = (title) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...C.navy);
    if (y + 34 > bottomLimit) newPage();
    doc.text(title, marginX, y);
    y += 5;
    doc.setDrawColor(...C.blue); doc.setLineWidth(1.4);
    doc.line(marginX, y, marginX + 40, y);
    doc.setDrawColor(...C.rule); doc.setLineWidth(1);
    doc.line(marginX + 44, y, pageW - marginX, y);
    y += 13;
  };

  const renderItem = (item, idx) => {
    if (item.contentType === 'warning') {
      const head = 'Warning' + (item.title ? ': ' + item.title : '');
      const headLines = doc.splitTextToSize(head, contentW);
      if (headLines.length) writeBlock(headLines, marginX, 10.5, 'bold', C.amber, 14);
      if (item.body) writeBlock(doc.splitTextToSize(item.body, contentW), marginX, 9.5, 'normal', C.gray, 13);
      y += 7;
      return;
    }
    const marker = itemMarker(item, idx);
    let head = (marker ? marker + '  ' : '') + (item.title || '');
    if (item.isRequired && (item.contentType === 'tool' || item.contentType === 'material' || item.contentType === 'checklist')) {
      head += ' (Required)';
    }
    const headLines = head ? doc.splitTextToSize(head, contentW) : [];
    const bodyLines = item.body ? doc.splitTextToSize(item.body, contentW) : [];
    // Keep the item title with at least its first body line when possible.
    const firstChunk = (headLines.length ? 14 : 0) + (bodyLines.length ? 13 : 0) + 6;
    if (headLines.length && y + firstChunk > bottomLimit) newPage();
    if (headLines.length) writeBlock(headLines, marginX, 10.5, 'bold', C.text, 14);
    if (headLines.length && bodyLines.length) y += 2;
    if (bodyLines.length) writeBlock(bodyLines, marginX, 9.5, 'normal', C.gray, 13);
    y += 7;
  };

  for (const st of DISPLAY_ORDER) {
    const items = contentBySection[st] || [];
    if (!items.length) continue; // skip missing optional sections — never invent
    drawSectionHeading(SECTION_TITLES[st] || st);
    items.forEach((item, idx) => renderItem(item, idx));
    y += 4;
  }

  // ── References (company resources) ────────────────────────────────────────
  if (resources.length) {
    drawSectionHeading('References');
    resources.forEach(r => {
      const head = '\u2022  ' + (r.title || 'Reference');
      if (y + 14 > bottomLimit) newPage();
      writeBlock(doc.splitTextToSize(head, contentW), marginX, 10, 'bold', C.text, 13);
      const typeLabel = getResourceTypeConfig(r.resourceType)?.label || r.resourceType || 'Resource';
      const sub = [typeLabel, r.url].filter(Boolean).join(' - ');
      if (sub) writeBlock(doc.splitTextToSize(sub, contentW), marginX, 8.5, 'normal', C.gray, 11);
      if (r.description) writeBlock(doc.splitTextToSize(r.description, contentW), marginX, 8.5, 'normal', C.gray, 11);
      y += 5;
    });
  }

  // ── Page numbers + brand footer on every page ────────────────────────────
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...C.gray);
    const left = 'Essential SOP' + (companyName ? '  -  ' + truncate(companyName, 40) : '');
    doc.text(left, marginX, pageH - 28);
    doc.text('Page ' + p + ' of ' + total, pageW - marginX, pageH - 28, { align: 'right' });
  }

  const blob = doc.output('blob');
  const filename = sanitizeFilename(companyName || 'Company') + '_' + sanitizeFilename(job.title || 'SOP') + '.pdf';
  return { blob, filename };
}