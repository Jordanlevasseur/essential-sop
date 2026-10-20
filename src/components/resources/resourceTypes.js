import { Youtube, BookOpen, FileText, BookText, GraduationCap, Globe, Link } from 'lucide-react';

/**
 * Resource type configuration shared between the resources section and the
 * add/edit form. Each type has a display label and a lucide icon for visual
 * recognition.
 */
export const RESOURCE_TYPES = [
  { value: 'youtube', label: 'YouTube Video', icon: Youtube },
  { value: 'manual', label: 'Manufacturer Manual', icon: BookOpen },
  { value: 'pdf', label: 'PDF Document', icon: FileText },
  { value: 'documentation', label: 'Product Documentation', icon: BookText },
  { value: 'training', label: 'Training Website', icon: GraduationCap },
  { value: 'website', label: 'Website', icon: Globe },
  { value: 'other', label: 'Other Resource', icon: Link },
];

const TYPE_MAP = Object.fromEntries(RESOURCE_TYPES.map(t => [t.value, t]));

export function getResourceTypeConfig(type) {
  return TYPE_MAP[type] || RESOURCE_TYPES[6]; // fall back to 'other'
}

/** Client-side HTTPS URL validation mirroring the server-side check. */
export function isValidHttpsUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (/^\s*(javascript|data|vbscript|file):/i.test(trimmed)) return false;
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}