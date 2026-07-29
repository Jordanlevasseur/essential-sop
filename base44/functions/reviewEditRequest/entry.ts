import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const DURATION_HOURS = { '1h': 1, '4h': 4, '8h': 8, '24h': 24 };

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { action, editRequestId, companyId, approvedSectionTypes, duration, reviewerNotes } = body;
    // action: approve | deny | revoke_access

    if (!action || !editRequestId || !companyId) {
      return Response.json({ error: 'action, editRequestId, and companyId required' }, { status: 400 });
    }

    // Verify reviewer is GM or PM
    const memberships = await base44.asServiceRole.entities.CompanyMembership.filter({ companyId, userId: user.id, status: 'active' });
    const isReviewer = (memberships || []).some(m => m.role === 'general_manager' || m.role === 'project_manager');
    if (!isReviewer) {
      return Response.json({ error: 'Only General Managers and Project Managers may review edit requests' }, { status: 403 });
    }

    const request = await base44.asServiceRole.entities.EditRequest.get(editRequestId);
    if (!request || request.companyId !== companyId) {
      return Response.json({ error: 'Edit request not found in this company' }, { status: 404 });
    }

    const now = new Date();
    const nowISO = now.toISOString();

    if (action === 'approve') {
      if (request.status !== 'pending' && request.status !== 'changes_requested') {
        return Response.json({ error: `Cannot approve a request with status: ${request.status}` }, { status: 409 });
      }

      const sectionsToGrant = approvedSectionTypes?.length
        ? approvedSectionTypes.filter(s => request.requestedSectionTypes.includes(s))
        : request.requestedSectionTypes;

      if (sectionsToGrant.length === 0) {
        return Response.json({ error: 'No valid sections to approve' }, { status: 400 });
      }

      const durationHours = DURATION_HOURS[duration] || 24;
      const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString();

      // Create temporary grant
      const grant = await base44.asServiceRole.entities.TemporaryEditGrant.create({
        companyId,
        editRequestId,
        jobId: request.jobId,
        userId: request.requestedByUserId,
        approvedSectionTypes: sectionsToGrant,
        grantedByUserId: user.id,
        status: 'active',
        grantedAt: nowISO,
        expiresAt,
      });

      // Create revision record (draft)
      const job = await base44.asServiceRole.entities.Job.get(request.jobId);
      // Snapshot existing published content
      const publishedContent = await base44.asServiceRole.entities.SectionContent.filter({ jobId: request.jobId });
      const snapshot = {};
      for (const item of (publishedContent || [])) {
        if (!snapshot[item.sectionType]) snapshot[item.sectionType] = [];
        snapshot[item.sectionType].push(item);
      }

      const revision = await base44.asServiceRole.entities.JobRevision.create({
        companyId,
        jobId: request.jobId,
        createdByUserId: request.requestedByUserId,
        editRequestId,
        revisionNumber: 1,
        status: 'draft',
        changeSummary: '',
        publishedContentSnapshot: snapshot,
        draftContentSnapshot: snapshot,
      });

      await base44.asServiceRole.entities.EditRequest.update(editRequestId, {
        status: 'approved',
        reviewedByUserId: user.id,
        reviewerNotes: reviewerNotes || '',
        reviewedAt: nowISO,
        accessGrantedAt: nowISO,
        accessExpiresAt: expiresAt,
        revisionId: revision.id,
      });

      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'edit_request_approved',
        targetType: 'edit_request', targetId: editRequestId,
        summary: `${user.full_name || user.email} approved edit access for "${job?.title}"`,
        timestamp: nowISO,
      });

      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: request.requestedByUserId, type: 'edit_request_approved',
        title: 'Edit Access Approved',
        body: `Your request to edit "${job?.title}" has been approved. Access expires in ${durationHours} hour(s).`,
        targetType: 'edit_request', targetId: editRequestId,
      });

      return Response.json({ success: true, action, grant, revision, expiresAt, sectionsToGrant });
    }

    if (action === 'deny') {
      await base44.asServiceRole.entities.EditRequest.update(editRequestId, {
        status: 'denied',
        reviewedByUserId: user.id,
        reviewerNotes: reviewerNotes || '',
        reviewedAt: nowISO,
      });

      const job = await base44.asServiceRole.entities.Job.get(request.jobId);
      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'edit_request_denied',
        targetType: 'edit_request', targetId: editRequestId,
        summary: `${user.full_name || user.email} denied edit request for "${job?.title}"`,
        timestamp: nowISO,
      });

      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: request.requestedByUserId, type: 'edit_request_denied',
        title: 'Edit Request Denied',
        body: `Your request to edit "${job?.title}" was not approved.${reviewerNotes ? ' Note: ' + reviewerNotes : ''}`,
        targetType: 'edit_request', targetId: editRequestId,
      });

      return Response.json({ success: true, action });
    }

    if (action === 'revoke_access') {
      // Revoke active grant
      const grants = await base44.asServiceRole.entities.TemporaryEditGrant.filter({ editRequestId, status: 'active' });
      for (const grant of (grants || [])) {
        await base44.asServiceRole.entities.TemporaryEditGrant.update(grant.id, { status: 'revoked', revokedAt: nowISO });
      }
      await base44.asServiceRole.entities.EditRequest.update(editRequestId, { status: 'revoked', revokedAt: nowISO });

      const job = await base44.asServiceRole.entities.Job.get(request.jobId);
      await base44.asServiceRole.entities.ActivityLog.create({
        companyId, actingUserId: user.id, actionType: 'temporary_access_revoked',
        targetType: 'edit_request', targetId: editRequestId,
        summary: `${user.full_name || user.email} revoked temporary editing access for "${job?.title}"`,
        timestamp: nowISO,
      });

      await base44.asServiceRole.entities.Notification.create({
        companyId, userId: request.requestedByUserId, type: 'temporary_access_revoked',
        title: 'Editing Access Revoked',
        body: `Your temporary editing access for "${job?.title}" has been revoked.${reviewerNotes ? ' Note: ' + reviewerNotes : ''}`,
        targetType: 'edit_request', targetId: editRequestId,
      });

      return Response.json({ success: true, action });
    }

    return Response.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}