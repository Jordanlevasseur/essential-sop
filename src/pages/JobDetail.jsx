import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { useApp } from '@/lib/AppContext';
import { ArrowLeft, Star, Clock, Pencil } from 'lucide-react';
import { SECTION_DEFINITIONS } from '@/lib/constants';
import SectionCard from '@/components/sections/SectionCard';

export default function JobDetail() {
  const { jobId } = useParams();
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite, addRecentlyViewed, isAdmin } = useApp();
  const [job, setJob] = useState(null);
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      base44.entities.Job.get(jobId),
      base44.entities.JobSection.filter({ jobId }, 'sortOrder', 10),
    ]).then(([j, s]) => {
      setJob(j);
      setSections(s || []);
      addRecentlyViewed(j.id, j.title);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [jobId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-4 border-neutral-200 border-t-blue-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!job) return <div className="p-4 text-center text-neutral-400">Job not found.</div>;

  const sortedSections = [...sections].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="min-h-screen bg-neutral-50">
      <div className="bg-white border-b border-neutral-200 sticky top-0 z-40">
        <div className="px-4 py-3 flex items-center gap-3">
          <button onClick={() => navigate(-1)}>
            <ArrowLeft size={22} className="text-neutral-700" />
          </button>
          <h1 className="font-semibold text-neutral-900 flex-1 truncate">Job Overview</h1>
          {isAdmin && (
            <button onClick={() => navigate(`/create-job?edit=${jobId}`)}>
              <Pencil size={18} className="text-blue-600" />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-4">
        <div className="bg-white border border-neutral-200 rounded-xl p-4 mb-4">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h2 className="text-xl font-bold text-neutral-900 flex-1">{job.title}</h2>
            <button onClick={() => toggleFavorite(job.id)}>
              <Star size={22} className={isFavorite(job.id) ? 'text-yellow-500 fill-yellow-500' : 'text-neutral-300'} />
            </button>
          </div>
          <p className="text-sm text-neutral-600 mb-3">{job.shortDescription}</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <Info label="Trade" value={job.trade} />
            <Info label="Category" value={job.category} />
            <Info label="Duration" value={job.estimatedDuration} icon={Clock} />
            <Info label="Skill Level" value={job.skillLevel} />
          </div>
          {job.tags && job.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {job.tags.map(tag => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded-full">#{tag}</span>
              ))}
            </div>
          )}
          <p className="text-xs text-neutral-400 mt-3">Last updated: {new Date(job.updated_date).toLocaleDateString()}</p>
        </div>

        <h3 className="text-sm font-semibold text-neutral-700 mb-2">Job Sections</h3>
        <div className="space-y-2.5">
          {sortedSections.map(section => {
            const def = SECTION_DEFINITIONS.find(d => d.sectionType === section.sectionType);
            return (
              <SectionCard
                key={section.id}
                section={section}
                icon={def?.icon}
                onClick={() => navigate(`/jobs/${jobId}/${section.sectionType}`)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, icon: Icon }) {
  return (
    <div className="flex flex-col">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-700 font-medium flex items-center gap-1">
        {Icon && <Icon size={12} />}{value || '—'}
      </span>
    </div>
  );
}