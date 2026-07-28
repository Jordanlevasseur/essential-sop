import { base44 } from '@/api/base44Client';
import { SECTION_DEFINITIONS } from './constants';
import { demoJobs } from './demoData';

export async function ensureSeeded() {
  const existing = await base44.entities.Job.list();
  if (existing && existing.length > 0) return;

  for (const demoJob of demoJobs) {
    const job = await base44.entities.Job.create(demoJob.job);

    const sectionsToCreate = SECTION_DEFINITIONS.map(sd => {
      const items = demoJob.sections[sd.sectionType] || [];
      const status = items.length === 0 ? 'Empty' : items.length >= 4 ? 'Complete' : 'In Progress';
      return {
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

export async function resetDemoData() {
  await base44.entities.SectionContent.deleteMany({});
  await base44.entities.JobSection.deleteMany({});
  await base44.entities.Job.deleteMany({});
  await ensureSeeded();
}

export async function createJobWithSections(jobData) {
  const job = await base44.entities.Job.create(jobData);
  const sections = await base44.entities.JobSection.bulkCreate(
    SECTION_DEFINITIONS.map(sd => ({
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