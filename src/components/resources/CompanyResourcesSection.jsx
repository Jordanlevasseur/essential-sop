import React, { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { Plus, Loader2, AlertCircle, Trash2 } from 'lucide-react';
import ResourceCard from './ResourceCard';
import ResourceFormDialog from './ResourceFormDialog';

/**
 * CompanyResourcesSection — company-authorized external resource links
 * displayed at the bottom of every SOP detail page.
 *
 * Loads resources through resolveCompanyResources (authorized backend path).
 * GM/PM (canManage) see Add, Edit, Remove, and Reorder controls. Project Leads
 * and Technicians see a read-only list. All mutations go through
 * manageCompanyResource, which re-verifies role + ownership server-side.
 */
export default function CompanyResourcesSection({ jobId }) {
  const [resources, setResources] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingResource, setEditingResource] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await base44.functions.invoke('resolveCompanyResources', { jobId });
      setResources(res.data?.resources || []);
      setCanManage(res.data?.canManage || false);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load resources');
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (formData) => {
    setSaving(true);
    setFormError('');
    try {
      if (editingResource) {
        const res = await base44.functions.invoke('manageCompanyResource', {
          action: 'update', jobId, resourceId: editingResource.id, data: formData,
        });
        if (!res.data?.resource) throw new Error(res.data?.error || 'Update failed');
        setResources(prev => prev.map(r => r.id === editingResource.id ? res.data.resource : r));
      } else {
        const res = await base44.functions.invoke('manageCompanyResource', {
          action: 'create', jobId, data: formData,
        });
        if (!res.data?.resource) throw new Error(res.data?.error || 'Create failed');
        setResources(prev => [...prev, res.data.resource]);
      }
      setShowForm(false);
      setEditingResource(null);
    } catch (err) {
      setFormError(err.response?.data?.error || err.message || 'Failed to save resource');
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setSaving(true);
    try {
      await base44.functions.invoke('manageCompanyResource', {
        action: 'delete', jobId, resourceId: deletingId,
      });
      setResources(prev => prev.filter(r => r.id !== deletingId));
      setDeletingId(null);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to delete resource');
    } finally {
      setSaving(false);
    }
  };

  const handleReorder = async (index, dir) => {
    const items = [...resources];
    const swap = index + dir;
    if (swap < 0 || swap >= items.length) return;
    [items[index], items[swap]] = [items[swap], items[index]];
    const orderedIds = items.map(r => r.id);
    setResources(items);
    try {
      await base44.functions.invoke('manageCompanyResource', {
        action: 'reorder', jobId, orderedIds,
      });
    } catch {
      load();
    }
  };

  return (
    <div className="px-3 pt-5 pb-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-app-text-muted uppercase tracking-wide">Company Resources</h3>
        {canManage && !loading && !error && (
          <button
            onClick={() => { setEditingResource(null); setShowForm(true); }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-app-accent text-app-accent-text rounded-lg text-xs font-medium no-select touch-active"
          >
            <Plus size={14} /> Add
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-6">
          <Loader2 size={20} className="animate-spin text-app-text-muted" />
        </div>
      )}

      {error && (
        <div className="bg-app-danger-bg border border-app-danger/30 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <AlertCircle size={14} className="text-app-danger flex-shrink-0 mt-0.5" />
          <p className="text-xs text-app-danger flex-1">{error}</p>
          <button onClick={load} className="text-xs text-app-danger font-medium underline">Retry</button>
        </div>
      )}

      {!loading && !error && resources.length === 0 && (
        <div className="bg-app-card border border-app-border rounded-xl px-4 py-6 text-center">
          <p className="text-sm text-app-text-muted">
            {canManage ? 'No resources yet. Tap Add to attach an external link.' : 'No company resources for this procedure.'}
          </p>
        </div>
      )}

      {!loading && !error && resources.length > 0 && (
        <div className="space-y-2.5">
          {resources.map((resource, index) => (
            <ResourceCard
              key={resource.id}
              resource={resource}
              canManage={canManage}
              index={index}
              total={resources.length}
              onEdit={() => { setEditingResource(resource); setShowForm(true); }}
              onDelete={() => setDeletingId(resource.id)}
              onReorder={handleReorder}
            />
          ))}
        </div>
      )}

      {showForm && (
        <ResourceFormDialog
          resource={editingResource}
          saving={saving}
          error={formError}
          onSave={handleSave}
          onClose={() => { setShowForm(false); setEditingResource(null); setFormError(''); }}
        />
      )}

      {deletingId && (
        <DeleteConfirmDialog
          deleting={saving}
          onCancel={() => setDeletingId(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function DeleteConfirmDialog({ deleting, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4" onClick={() => !deleting && onCancel()}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-app-surface border border-app-border rounded-2xl p-5 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-bold text-app-text mb-2">Remove this resource?</h3>
        <p className="text-sm text-app-text-2 mb-4">This removes the resource link from this procedure. The external content is not affected.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} disabled={deleting}
            className="flex-1 py-2.5 border border-app-border rounded-xl text-sm font-medium text-app-text-2 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={deleting}
            className="flex-1 py-2.5 bg-app-danger text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove
          </button>
        </div>
      </div>
    </div>
  );
}