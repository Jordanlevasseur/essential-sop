import { base44 } from '@/api/base44Client';
import { SECTION_DEFINITIONS } from './constants';
import { demoJobs } from './demoData';

/**
 * Seed demo jobs for a given companyId if none exist for that company.
 */
export async function ensureSeeded(companyId) {
  if (!companyId) return;
  const existing = await base44.entities.Job.filter({ companyId }, '-updated_date', 5);
  if (existing && existing.length > 0) return;

  for (const demoJob of demoJobs) {
    const job = await base44.entities.Job.create({ ...demoJob.job, companyId });

    const sectionsToCreate = SECTION_DEFINITIONS.map(sd => {
      const items = demoJob.sections[sd.sectionType] || [];
      const status = items.length === 0 ? 'Empty' : items.length >= 4 ? 'Complete' : 'In Progress';
      return {
        companyId,
        jobId: job.id,
        sectionType: sd.sectionType,
        title: sd.title,
        description: sd.description,
        sortOrder: sd.sortOrder,
        completionStatus: status,
      };
    });
    const sections = await base44.entities.JobSection.bulkCreate(sectionsToCreate);

    const allContent = [];
    for (const section of sections) {
      const items = demoJob.sections[section.sectionType] || [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        allContent.push({
          companyId,
          sectionId: section.id,
          jobId: job.id,
          sectionType: section.sectionType,
          contentType: item.contentType,
          title: item.title || '',
          body: item.body || '',
          sortOrder: item.sortOrder ?? i,
          isRequired: item.isRequired || false,
          isCritical: item.isCritical || false,
          metadata: item.metadata || {},
        });
      }
    }
    if (allContent.length > 0) {
      await base44.entities.SectionContent.bulkCreate(allContent);
    }
  }
}

export async function resetDemoData(companyId) {
  if (!companyId) throw new Error('companyId required for reset');
  await base44.entities.SectionContent.deleteMany({ companyId });
  await base44.entities.JobSection.deleteMany({ companyId });
  await base44.entities.Job.deleteMany({ companyId });
  await ensureSeeded(companyId);
}

export async function createJobWithSections(jobData, companyId) {
  const job = await base44.entities.Job.create({ ...jobData, companyId });
  const sections = await base44.entities.JobSection.bulkCreate(
    SECTION_DEFINITIONS.map(sd => ({
      companyId,
      jobId: job.id,
      sectionType: sd.sectionType,
      title: sd.title,
      description: sd.description,
      sortOrder: sd.sortOrder,
      completionStatus: 'Empty',
    }))
  );
  return { job, sections };
}