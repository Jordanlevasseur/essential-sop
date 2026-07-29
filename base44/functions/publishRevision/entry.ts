import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, revisionId, companyId, reviewerNotes } = body;
    // action: publish | request_changes | reject

    if (!action || !revisionId || !companyId) {
      return Response.json({ error: 'action, revisionId, and companyId required' }, { status: 400 });
    }

    // Verify GM or PM
    const memberships = await base44.asServiceRole.entities.CompanyMembership.filter({ companyId, userId: user.id, status: 'active' });
    const isReviewer = (memberships || []).some(m => m.role === 'general_manager' || m.role === 'project_manager');
    if (!isReviewer) {
      return Response.json({ error: 'Only General Managers and Project Managers may publish revisions' }, { status: 403 });
    }

    const revision = await base44.asServiceRole.entities.JobRevision.get(revisionId);
    if (!revision || revision.companyId !== companyId) {
      return Response.json({ error: 'Revision not found in this company' }, { status: 404 });
    }
    if (revision.status !== 'submitted_for_review' && revision.status !== 'changes_requested') {
      return Response.json({ error: `Cannot act on revision with status: ${revision.status}` }, { status: 409 });
    }

    const job = await base44.asServiceRole.entities.Job.get(revision.jobId);
    if (!job || job.companyId !== companyId) {
      return Response.json({ error: 'Job not found in this company' }, { status: 404 });
    }

    const now = new Date().toISOString();

    if (action === 'publish') {
      // The draft snapshot represents the approved content state
      // Update the live Job's published status to reflect it's been updated
      await base44.asServiceRole.entities.Job.update(revision.jobId, { updated_date: now });

      await base44.asServiceRole.entities.JobRevision.update(revisionId, {
        status: 'published',
        publishedByUserId: user.id,
        publishedAt: now,
        reviewerNotes: reviewerNotes || '',
        reviewedAt: now,
      });

      await base44.asServiceRole.entities.EditRequest.update(revision.editRequestId, {
        status: 'published',
        completedAt: now,
      });

      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'revision_published',
        targetType: 'revision', targetId: revisionId,
        summary: `${user.full_name || user.email} published revision for "${job?.title}"`,
        timestamp: now,
      });

      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: revision.createdByUserId, type: 'revision_published',
        title: 'Your changes were published',
        body: `Your revision for "${job?.title}" has been reviewed and published.`,
        targetType: 'job', targetId: revision.jobId,
      });

      return Response.json({ success: true, action, message: 'Revision published.' });
    }

    if (action === 'request_changes') {
      await base44.asServiceRole.entities.JobRevision.update(revisionId, {
        status: 'changes_requested',
        reviewerNotes: reviewerNotes || '',
        reviewedAt: now,
      });

      await base44.asServiceRole.entities.EditRequest.update(revision.editRequestId, { status: 'changes_requested' });

      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'revision_changes_requested',
        targetType: 'revision', targetId: revisionId,
        summary: `${user.full_name || user.email} requested changes to revision for "${job?.title}"`,
        timestamp: now,
      });

      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: revision.createdByUserId, type: 'revision_changes_requested',
        title: 'Changes Requested',
        body: `${user.full_name || user.email} requested changes to your revision for "${job?.title}".${reviewerNotes ? ' Note: ' + reviewerNotes : ''}`,
        targetType: 'revision', targetId: revisionId,
      });

      return Response.json({ success: true, action });
    }

    if (action === 'reject') {
      await base44.asServiceRole.entities.JobRevision.update(revisionId, {
        status: 'rejected',
        reviewerNotes: reviewerNotes || '',
        reviewedAt: now,
        rejectedAt: now,
      });

      await base44.asServiceRole.entities.EditRequest.update(revision.editRequestId, { status: 'rejected' });

      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'revision_rejected',
        targetType: 'revision', targetId: revisionId,
        summary: `${user.full_name || user.email} rejected revision for "${job?.title}"`,
        timestamp: now,
      });

      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: revision.createdByUserId, type: 'revision_rejected',
        title: 'Revision Rejected',
        body: `Your revision for "${job?.title}" was not accepted.${reviewerNotes ? ' Reason: ' + reviewerNotes : ''}`,
        targetType: 'job', targetId: revision.jobId,
      });

      return Response.json({ success: true, action });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}