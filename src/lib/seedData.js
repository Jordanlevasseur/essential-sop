/**
 * seedData.js — Seeding and job-creation helpers.
 *
 * SECURITY PHASE 2 MIGRATION:
 *   - ensureSeeded: NO-OP. Automatic demo-data seeding for new companies has
 *     been stopped. The existing demo company's data is preserved in the
 *     database and is unaffected. New companies start empty.
 *   - createJobWithSections: Delegates to the saveCompanyJob backend function,
 *     which performs server-side authorization (GM/PM role check) and creates
 *     the Job + six JobSections through the service role.
 */
import { base44 } from '@/api/base44Client';

export async function ensureSeeded(_companyId) {
  // No-op: new companies start with an empty library. The existing demo
  // company's data is preserved in the database and is unaffected.
  return;
}

export async function createJobWithSections(jobData, companyId) {
  const res = await base44.functions.invoke('saveCompanyJob', {
    action: 'create',
    companyId,
    jobData,
  });
  if (!res?.data?.job) {
    throw new Error(res?.data?.error || 'Failed to create job');
  }
  return { job: res.data.job, sections: res.data.sections || [] };
}