import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

const VALID_SECTIONS = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality_standards'];
const VALID_URGENCY = ['normal', 'important', 'urgent_safety_correction'];

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { companyId, jobId, requestedSectionTypes, reason, proposedChangeSummary, urgency, supportingNote } = body;

    if (!companyId || !jobId || !requestedSectionTypes?.length || !reason || !proposedChangeSummary) {
      return Response.json({ error: 'Required fields missing' }, { status: 400 });
    }

    // Validate sections
    const invalidSections = requestedSectionTypes.filter(s => !VALID_SECTIONS.includes(s));
    if (invalidSections.length > 0) {
      return Response.json({ error: `Invalid sections: ${invalidSections.join(', ')}` }, { status: 400 });
    }
    if (!VALID_URGENCY.includes(urgency || 'normal')) {
      return Response.json({ error: 'Invalid urgency' }, { status: 400 });
    }

    // Verify user is an active Project Lead in this company
    const memberships = await base44.asServiceRole.entities.CompanyMembership.filter({
      companyId, userId: user.id, status: 'active'
    });
    const membership = (memberships || []).find(m => m.role === 'project_lead');
    if (!membership) {
      return Response.json({ error: 'Only active Project Leads may submit edit requests' }, { status: 403 });
    }

    // Verify job belongs to company
    const job = await base44.asServiceRole.entities.Job.get(jobId);
    if (!job || job.companyId !== companyId) {
      return Response.json({ error: 'Job not found in this company' }, { status: 404 });
    }
    if (job.status !== 'Published') {
      return Response.json({ error: 'Edit requests may only be submitted for published Jobs' }, { status: 409 });
    }

    // Prevent duplicate active requests
    const existing = await base44.asServiceRole.entities.EditRequest.filter({ companyId, jobId, requestedByUserId: user.id });
    const activeStatuses = ['pending', 'approved', 'editing', 'submitted_for_review', 'changes_requested'];
    const hasActive = (existing || []).some(r => activeStatuses.includes(r.status));
    if (hasActive) {
      return Response.json({ error: 'You already have an active request for this Job' }, { status: 409 });
    }

    const now = new Date().toISOString();
    const editRequest = await base44.asServiceRole.entities.EditRequest.create({
      companyId, jobId, requestedByUserId: user.id,
      requestedSectionTypes,
      reason, proposedChangeSummary,
      urgency: urgency || 'normal',
      supportingNote: supportingNote || '',
      status: 'pending',
      submittedAt: now,
    });

    // Log activity
    await base44.asServiceRole.entities.ActivityLog.create({
      companyId, actingUserId: user.id, actionType: 'edit_request_submitted',
      targetType: 'edit_request', targetId: editRequest.id,
      summary: `${user.full_name || user.email} requested to edit "${job.title}"`,
      metadata: { jobId, jobTitle: job.title, sections: requestedSectionTypes },
      timestamp: now,
    });

    // Notify GMs and PMs
    const reviewers = await base44.asServiceRole.entities.CompanyMembership.filter({ companyId, status: 'active' });
    for (const m of (reviewers || [])) {
      if (m.role === 'general_manager' || m.role === 'project_manager') {
        await base44.asServiceRole.entities.Notification.create({
          companyId, userId: m.userId, type: 'edit_request_submitted',
          title: 'Edit Request Submitted',
          body: `${user.full_name || user.email} requested to edit "${job.title}" — ${requestedSectionTypes.join(', ')}`,
          targetType: 'edit_request', targetId: editRequest.id,
        });
      }
    }

    return Response.json({ success: true, editRequest });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}