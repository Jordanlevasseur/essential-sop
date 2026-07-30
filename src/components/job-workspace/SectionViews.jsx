/**
 * SectionViews — Pure presentational section renderers.
 *
 * These components are completely data-agnostic. They receive content items
 * and an optional actionsToolbar slot per item. They have no knowledge of
 * where the data came from (Company Job, Master SOP, or any future workspace).
 *
 * Each view accepts:
 *   items          — array of content items for this section
 *   renderItemActions(item, index, total) — optional slot, rendered below each item
 */
import React from 'react';
import { AlertTriangle, Info, AlertCircle, ShieldAlert } from 'lucide-react';

// ── Tools ─────────────────────────────────────────────────────────────────────

export function ToolsView({ items, renderItemActions }) {
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-sm text-app-text selectable">{item.title}</span>
            {item.isRequired === false && (
              <span className="text-xs text-app-text-muted flex-shrink-0">Optional</span>
            )}
          </div>
          {item.metadata?.quantity && item.metadata.quantity !== 1 && (
            <p className="text-xs text-app-text-muted mt-0.5">Qty: {item.metadata.quantity}</p>
          )}
          {item.body && (
            <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
          )}
          {renderItemActions?.(item, i, items.length)}
        </li>
      ))}
    </ul>
  );
}

// ── Materials ─────────────────────────────────────────────────────────────────

export function MaterialsView({ items, renderItemActions }) {
  return (
    <ul className="space-y-4">
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold text-sm text-app-text selectable">{item.title}</span>
            {item.isRequired === false && (
              <span className="text-xs text-app-text-muted flex-shrink-0">Optional</span>
            )}
          </div>
          {(item.metadata?.quantity || item.metadata?.unit) && (
            <p className="text-xs text-app-text-muted mt-0.5">
              Qty: {item.metadata.quantity || 1}{item.metadata.unit ? ` ${item.metadata.unit}` : ''}
            </p>
          )}
          {item.metadata?.specification && (
            <p className="text-xs text-app-accent mt-0.5 selectable">{item.metadata.specification}</p>
          )}
          {item.body && (
            <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
          )}
          {renderItemActions?.(item, i, items.length)}
        </li>
      ))}
    </ul>
  );
}

// ── Scope ─────────────────────────────────────────────────────────────────────

export function ScopeView({ items, renderItemActions }) {
  return (
    <div className="space-y-4">
      {items.map((item, i) => (
        <div key={item.id}>
          {item.title && (
            <h3 className="text-sm font-semibold text-app-text mb-1">{item.title}</h3>
          )}
          <p className={`text-sm leading-relaxed whitespace-pre-wrap selectable ${item.isCritical ? 'text-app-warning' : 'text-app-text-2'}`}>
            {item.body}
          </p>
          {renderItemActions?.(item, i, items.length)}
        </div>
      ))}
    </div>
  );
}

// ── Procedure ─────────────────────────────────────────────────────────────────

export function ProcedureView({ items, renderItemActions }) {
  return (
    <ol className="space-y-5">
      {items.map((item, i) => (
        <li key={item.id} className="flex gap-3">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-app-accent text-app-accent-text flex items-center justify-center text-xs font-bold mt-0.5">
            {i + 1}
          </span>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm text-app-text leading-snug selectable">{item.title}</p>
            {item.body && (
              <p className="text-sm text-app-text-2 mt-1 leading-relaxed selectable">{item.body}</p>
            )}
            {item.metadata?.warning && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-app-danger">
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <span className="selectable"><span className="font-semibold">Warning:</span> {item.metadata.warning}</span>
              </div>
            )}
            {item.metadata?.tip && (
              <div className="mt-1.5 flex items-start gap-1.5 text-xs text-app-info">
                <Info size={12} className="flex-shrink-0 mt-0.5" />
                <span className="selectable"><span className="font-semibold">Tip:</span> {item.metadata.tip}</span>
              </div>
            )}
            {renderItemActions?.(item, i, items.length)}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Safety ────────────────────────────────────────────────────────────────────

const SEV = {
  Critical:    { icon: ShieldAlert,   textCls: 'text-app-danger',  label: 'CRITICAL' },
  Warning:     { icon: AlertTriangle, textCls: 'text-app-warning', label: 'WARNING' },
  Caution:     { icon: AlertCircle,   textCls: 'text-app-warning', label: 'CAUTION' },
  Information: { icon: Info,          textCls: 'text-app-info',    label: null },
};

export function SafetyView({ items, renderItemActions }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => {
        const sev = SEV[item.metadata?.severity] || SEV.Information;
        const Icon = sev.icon;
        const isCritical = item.metadata?.severity === 'Critical';
        return (
          <li key={item.id}>
            <div className="flex items-start gap-2">
              <Icon size={14} className={`flex-shrink-0 mt-0.5 ${sev.textCls}`} />
              <div className="flex-1 min-w-0">
                {isCritical && (
                  <span className={`text-xs font-bold uppercase tracking-wide mr-1.5 ${sev.textCls}`}>CRITICAL —</span>
                )}
                <span className="text-sm font-semibold text-app-text selectable">{item.title}</span>
                {item.body && (
                  <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
                )}
                {item.metadata?.requiredAction && (
                  <p className="text-xs text-app-text-2 mt-1 selectable">
                    <span className="font-semibold">Required Action:</span> {item.metadata.requiredAction}
                  </p>
                )}
              </div>
            </div>
            {renderItemActions?.(item, i, items.length)}
          </li>
        );
      })}
    </ul>
  );
}

// ── Quality Standards ─────────────────────────────────────────────────────────

export function QualityView({ items, renderItemActions }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={item.id}>
          <div className="flex items-start gap-2">
            {item.isCritical && (
              <span className="flex-shrink-0 text-xs font-bold text-app-danger uppercase mt-0.5">Critical</span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm text-app-text selectable">{item.title}</p>
              {item.body && (
                <p className="text-sm text-app-text-2 mt-0.5 leading-relaxed selectable">{item.body}</p>
              )}
            </div>
          </div>
          {renderItemActions?.(item, i, items.length)}
        </li>
      ))}
    </ul>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function SectionViewDispatcher({ sectionType, items, renderItemActions }) {
  const props = { items, renderItemActions };
  if (sectionType === 'tools')     return <ToolsView {...props} />;
  if (sectionType === 'materials') return <MaterialsView {...props} />;
  if (sectionType === 'scope')     return <ScopeView {...props} />;
  if (sectionType === 'procedure') return <ProcedureView {...props} />;
  if (sectionType === 'safety')    return <SafetyView {...props} />;
  if (sectionType === 'quality')   return <QualityView {...props} />;
  return null;
}