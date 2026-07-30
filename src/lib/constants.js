import { FileText, ListOrdered, Wrench, Package, ShieldAlert, Camera, ClipboardCheck, Briefcase, MessageSquare, User, Star, ArrowLeft, Search, SlidersHorizontal, Plus, ChevronRight, Pencil, Trash2, Save, ArrowUp, ArrowDown, Check, X, AlertTriangle, Info, AlertCircle, Copy, Eye, Send, Clock, Tag, Filter, Settings, LogOut, RotateCcw, ShieldCheck, HardHat, ChevronLeft, MoreVertical, GripVertical, CircleDot, Square, CheckCircle2, Circle, FileCheck } from 'lucide-react';

export const SECTION_DEFINITIONS = [
  { sectionType: 'tools', title: 'Tools', description: 'Review required and optional equipment.', icon: Wrench, sortOrder: 0 },
  { sectionType: 'materials', title: 'Materials', description: 'Confirm products, quantities, and specifications.', icon: Package, sortOrder: 1 },
  { sectionType: 'scope', title: 'Scope', description: 'Understand what work is included, excluded, and expected.', icon: FileText, sortOrder: 2 },
  { sectionType: 'procedure', title: 'Procedure', description: 'Follow the approved step-by-step process.', icon: ListOrdered, sortOrder: 3 },
  { sectionType: 'safety', title: 'Safety', description: 'Review hazards, PPE, and required precautions.', icon: ShieldAlert, sortOrder: 4 },
  { sectionType: 'quality', title: 'Quality Standards', description: 'Acceptable completed work standards for this job.', icon: ClipboardCheck, sortOrder: 5 },
];

export const SECTION_MAP = Object.fromEntries(SECTION_DEFINITIONS.map(s => [s.sectionType, s]));

export const TRADES = ['Plumbing', 'Carpentry', 'Electrical', 'Drywall', 'Roofing', 'Inspection', 'Waterproofing', 'HVAC', 'Painting', 'General'];
export const CATEGORIES = ['Water Systems', 'Doors & Windows', 'Ventilation', 'Crawlspace', 'Repairs', 'Decking', 'Electrical', 'Interior', 'Exterior'];
export const SKILL_LEVELS = ['Entry', 'Intermediate', 'Advanced'];
export const SEVERITY_LEVELS = [
  { value: 'Information', icon: Info, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  { value: 'Caution', icon: AlertCircle, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200' },
  { value: 'Warning', icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
  { value: 'Critical', icon: ShieldAlert, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
];
export const DOCUMENTATION_TYPES = ['Before photo', 'During photo', 'After photo', 'Measurement', 'Note', 'Signature', 'Form'];
export const SORT_OPTIONS = [
  { value: 'updated', label: 'Last Updated' },
  { value: 'title', label: 'Title (A-Z)' },
  { value: 'trade', label: 'Trade' },
];

export const DISCLAIMER = 'Verify local code, project specifications, and manufacturer instructions before proceeding.';

export const TRADE_EMOJI = {
  Plumbing: '🔧', Carpentry: '🪚', Electrical: '⚡', Drywall: '🧱',
  Inspection: '🔍', Waterproofing: '💧', Roofing: '🏠', HVAC: '❄️', Painting: '🎨',
};

export { FileText, ListOrdered, Wrench, Package, ShieldAlert, Camera, ClipboardCheck, Briefcase, MessageSquare, User, Star, ArrowLeft, Search, SlidersHorizontal, Plus, ChevronRight, Pencil, Trash2, Save, ArrowUp, ArrowDown, Check, X, AlertTriangle, Info, AlertCircle, Copy, Eye, Send, Clock, Tag, Filter, Settings, LogOut, RotateCcw, ShieldCheck, HardHat, ChevronLeft, MoreVertical, GripVertical, CircleDot, Square, CheckCircle2, Circle, FileCheck };