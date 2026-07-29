import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { revisionId, companyId, changeSummary } = body;

    if (!revisionId || !companyId || !changeSummary) {
      return Response.json({ error: 'revisionId, companyId, and changeSummary are required' }, { status: 400 });
    }

    // Verify revision belongs to user and company
    const revision = await base44.asServiceRole.entities.JobRevision.get(revisionId);
    if (!revision || revision.companyId !== companyId) {
      return Response.json({ error: 'Revision not found in this company' }, { status: 404 });
    }
    if (revision.createdByUserId !== user.id) {
      return Response.json({ error: 'You may only submit your own revision' }, { status: 403 });
    }
    if (revision.status !== 'draft' && revision.status !== 'changes_requested') {
      return Response.json({ error: `Cannot submit a revision with status: ${revision.status}` }, { status: 409 });
    }

    // Verify active grant exists and is still valid
    const grants = await base44.asServiceRole.entities.TemporaryEditGrant.filter({
      editRequestId: revision.editRequestId, userId: user.id, status: 'active'
    });
    const validGrant = (grants || []).find(g => new Date(g.expiresAt) > new Date());
    if (!validGrant) {
      return Response.json({ error: 'No active editing permission. Your access may have expired.' }, { status: 403 });
    }

    const now = new Date().toISOString();

    // Snapshot current draft content
    const currentContent = await base44.asServiceRole.entities.SectionContent.filter({ jobId: revision.jobId });
    const draftSnapshot = {};
    for (const item of (currentContent || [])) {
      if (!draftSnapshot[item.sectionType]) draftSnapshot[item.sectionType] = [];
      draftSnapshot[item.sectionType].push(item);
    }

    // Update revision
    await base44.asServiceRole.entities.JobRevision.update(revisionId, {
      status: 'submitted_for_review',
      changeSummary,
      draftContentSnapshot: draftSnapshot,
      submittedAt: now,
    });

    // Close grant and edit request
    await base44.asServiceRole.entities.TemporaryEditGrant.update(validGrant.id, { status: 'submitted', submittedAt: now });
    await base44.asServiceRole.entities.EditRequest.update(revision.editRequestId, { status: 'submitted_for_review', changesSubmittedAt: now });

    const job = await base44.asServiceRole.entities.Job.get(revision.jobId);

    await base44.asServiceRole.entities.ActivityLog.create({
      companyId, actingUserId: user.id, actionType: 'revision_submitted',
      targetType: 'revision', targetId: revisionId,
      summary: `${user.full_name || user.email} submitted revision for review on "${job?.title}"`,
      timestamp: now,
    });

    // Notify reviewers
    const reviewers = await base44.asServiceRole.entities.CompanyMembership.filter({ companyId, status: 'active' });
    for (const m of (reviewers || [])) {
      if (m.role === 'general_manager' || m.role === 'project_manager') {
        await base44.asServiceRole.entities.Notification.create({
          companyId, userId: m.userId, type: 'revision_submitted',
          title: 'Revision Ready for Review',
          body: `${user.full_name || user.email} submitted changes to "${job?.title}" for review.`,
          targetType: 'revision', targetId: revisionId,
        });
      }
    }

    return Response.json({
      success: true,
      message: 'Changes submitted for review. Your temporary editing access has ended. The published Job has not changed yet.',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}