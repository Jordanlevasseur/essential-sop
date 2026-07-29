/**
 * createCompany — create a new company and assign the caller as owner/general_manager.
 *
 * Input: { name: string }
 * Output: { success: true, company, membership }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return Response.json({ error: 'Company name is required.' }, { status: 400 });

    const now = new Date().toISOString();

    // Create company
    const company = await base44.asServiceRole.entities.Company.create({
      name,
      ownerUserId: user.id,
      status: 'active',
      accountType: 'standard',
    });

    // Create membership for the creator
    const membership = await base44.asServiceRole.entities.CompanyMembership.create({
      companyId: company.id,
      userId: user.id,
      role: 'general_manager',
      status: 'active',
      joinedAt: now,
    });

    console.log(`Company created: id=${company.id} name="${name}" owner=${user.id}`);

    return Response.json({ success: true, company, membership });
  } catch (error) {
    console.error('createCompany error:', error?.message);
    return Response.json({ error: error.message || 'Failed to create company.' }, { status: 500 });
  }
}