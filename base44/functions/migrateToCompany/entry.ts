/**
 * migrateToCompany — one-time migration that:
 *  1. Creates "Essential SOP Demo Company" if it does not already exist.
 *  2. Assigns the calling user as owner / general_manager.
 *  3. Stamps companyId onto all existing Job, JobSection, and SectionContent records
 *     that are missing companyId.
 *
 * Safe to call multiple times — idempotent.
 * Returns a report of what was migrated.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const DEMO_COMPANY_NAME = 'Essential SOP Demo Company';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Admin only.' }, { status: 403 });

    const report = {
      companyCreated: false,
      membershipCreated: false,
      companyId: null,
      jobsUpdated: 0,
      sectionsUpdated: 0,
      contentUpdated: 0,
      errors: [],
    };

    // ── 1. Find or create Demo Company ───────────────────────────────────────
    const now = new Date().toISOString();
    let companies = await base44.asServiceRole.entities.Company.filter({ name: DEMO_COMPANY_NAME });
    let company = companies && companies.length > 0 ? companies[0] : null;

    if (!company) {
      company = await base44.asServiceRole.entities.Company.create({
        name: DEMO_COMPANY_NAME,
        ownerUserId: user.id,
        status: 'active',
        accountType: 'standard',
      });
      report.companyCreated = true;
    }
    report.companyId = company.id;

    // ── 2. Ensure caller has active general_manager membership ────────────────
    const existing = await base44.asServiceRole.entities.CompanyMembership.filter({
      companyId: company.id,
      userId: user.id,
    });
    if (!existing || existing.length === 0) {
      await base44.asServiceRole.entities.CompanyMembership.create({
        companyId: company.id,
        userId: user.id,
        role: 'general_manager',
        status: 'active',
        joinedAt: now,
      });
      report.membershipCreated = true;
    }

    // ── 3. Stamp companyId on Jobs missing it ────────────────────────────────
    const jobs = await base44.asServiceRole.entities.Job.list();
    const unmigrated = (jobs || []).filter(j => !j.companyId);
    for (const job of unmigrated) {
      try {
        await base44.asServiceRole.entities.Job.update(job.id, { companyId: company.id });
        report.jobsUpdated++;
      } catch (e) {
        report.errors.push(`Job ${job.id}: ${e.message}`);
      }
    }

    // ── 4. Stamp companyId on JobSections missing it ─────────────────────────
    const sections = await base44.asServiceRole.entities.JobSection.list();
    const unmigratedSections = (sections || []).filter(s => !s.companyId);
    for (const sec of unmigratedSections) {
      try {
        await base44.asServiceRole.entities.JobSection.update(sec.id, { companyId: company.id });
        report.sectionsUpdated++;
      } catch (e) {
        report.errors.push(`Section ${sec.id}: ${e.message}`);
      }
    }

    // ── 5. Stamp companyId on SectionContent missing it (batch via updateMany) ─
    try {
      // updateMany applies the same change to all matching records in one call
      const updateResult = await base44.asServiceRole.entities.SectionContent.updateMany(
        { companyId: { $exists: false } },
        { $set: { companyId: company.id } }
      );
      report.contentUpdated = updateResult?.matched || updateResult?.modified || 0;
    } catch (e) {
      // Fall back to per-item update if updateMany not available
      const content = await base44.asServiceRole.entities.SectionContent.list('-sortOrder', 500);
      const unmigratedContent = (content || []).filter(c => !c.companyId);
      for (const item of unmigratedContent) {
        try {
          await base44.asServiceRole.entities.SectionContent.update(item.id, { companyId: company.id });
          report.contentUpdated++;
        } catch (err) {
          report.errors.push(`Content ${item.id}: ${err.message}`);
        }
      }
    }

    console.log('Migration complete:', JSON.stringify(report));
    return Response.json({ success: true, report });
  } catch (error) {
    console.error('migrateToCompany error:', error?.message);
    return Response.json({ error: error.message || 'Migration failed.' }, { status: 500 });
  }
}