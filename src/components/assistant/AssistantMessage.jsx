import React from 'react';
import ReactMarkdown from 'react-markdown';

/**
 * AssistantMessage — renders an Assistant answer as compact, safely-styled
 * Markdown (headings, bold, bullet/numbered lists) instead of literal
 * asterisks. No raw HTML is rendered (react-markdown escapes by default).
 * Uses V1.0 tokens; no oversized decorative cards.
 */
export default function AssistantMessage({ text }) {
  return (
    <div className="text-sm text-app-text leading-relaxed
      [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
      [&_p]:my-1.5
      [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-1.5
      [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-1.5
      [&_li]:my-0.5
      [&_h1]:font-semibold [&_h1]:text-base [&_h1]:mt-2 [&_h1]:mb-1
      [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-2 [&_h2]:mb-1
      [&_h3]:font-semibold [&_h3]:text-sm [&_h3]:mt-3 [&_h3]:mb-1.5
      [&_h4]:font-semibold [&_h4]:text-sm [&_h4]:mt-2 [&_h4]:mb-1
      [&_strong]:font-semibold
      [&_a]:text-app-accent [&_a]:underline">
      <ReactMarkdown>{text || ''}</ReactMarkdown>
    </div>
  );
}