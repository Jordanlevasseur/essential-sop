import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveCompanyKnowledge } from '../../shared/companyKnowledgeEngine.ts';
import { selectAiContext } from '../../shared/aiContextSelector.ts';
import { routeAssistantRequest } from '../../shared/assistantRouter.ts';

/**
 * _stage4ContextTest — Stage 4 runtime verification.
 *
 * Creates isolated test fixtures with rich metadata (safety severity, warnings,
 * quantities, specs, required/critical flags) and verifies the context selector
 * produces correct, metadata-preserving, size-controlled context for various
 * question types. Also verifies the full askAssistant pipeline (AI call counts,
 * response shape). Cleans up all fixtures afterward.
 *
 * NON-SENSITIVE: logs only route, counts, sizes, and metadata key presence —
 * never SOP bodies, user content, or conversation text.
 */

export default async function (req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const SR = base44.asServiceRole;

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Find a company where the user is a member
    const memberships = await base44.entities.CompanyMembership.filter({
      userId: user.id, status: 'active',
    }, '-created_date', 10);
    if (!memberships || memberships.length === 0) {
      return Response.json({ error: 'No company membership found for testing.' }, { status: 400 });
    }
    const companyId = memberships[0].companyId;

    // ── Create test fixtures ──────────────────────────────────────────────
    const FIXTURE_TAG = 'stage4_test_fixture';

    // Master A: Deck Stair Repair
    const masterA = await SR.entities.EssentialSOPMaster.create({
      title: 'Stage4 Test: Deck Stair Repair',
      slug: `stage4-test-deck-stair-repair-${Date.now()}`,
      category: 'Exterior',
      trade: 'Carpentry',
      tags: [FIXTURE_TAG],
      status: 'active',
      distributionStatus: 'internal',
      defaultDistributionPolicy: 'MANUAL',
    });

    const versionA = await SR.entities.EssentialSOPVersion.create({
      masterId: masterA.id,
      versionNumber: 1,
      status: 'published',
      publishedAt: new Date().toISOString(),
      publishedByUserId: user.id,
    });

    await SR.entities.EssentialSOPMaster.update(masterA.id, {
      currentPublishedVersionId: versionA.id,
    });

    // Sections with rich metadata
    await SR.entities.EssentialSOPSection.create({
      masterId: masterA.id, versionId: versionA.id,
      sectionType: 'safety', title: 'Safety', sortOrder: 0,
      contentItems: [
        { logicalItemId: 'lid_a_s1', contentType: 'warning', title: 'Fall Protection Required',
          body: 'Always wear a safety harness when working on stairs above 6 feet.',
          isRequired: true, isCritical: true,
          metadata: { severity: 'high', requiredAction: 'Inspect harness before each use.' } },
        { logicalItemId: 'lid_a_s2', contentType: 'warning', title: 'Sharp Tool Handling',
          body: 'Use push sticks when cutting with a table saw.',
          isRequired: true, isCritical: false,
          metadata: { severity: 'medium', requiredAction: 'Keep hands 6 inches from blade.' } },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterA.id, versionId: versionA.id,
      sectionType: 'tools', title: 'Tools', sortOrder: 1,
      contentItems: [
        { logicalItemId: 'lid_a_t1', contentType: 'tool', title: 'Cordless Drill',
          body: '18V or higher', isRequired: true,
          metadata: { quantity: '2', specification: '1/2 inch chuck' } },
        { logicalItemId: 'lid_a_t2', contentType: 'tool', title: 'Circular Saw',
          body: 'With carbide blade', isRequired: true,
          metadata: { quantity: '1', specification: '7-1/4 inch' } },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterA.id, versionId: versionA.id,
      sectionType: 'materials', title: 'Materials', sortOrder: 2,
      contentItems: [
        { logicalItemId: 'lid_a_m1', contentType: 'material', title: 'Pressure-Treated Stringers',
          body: '2x12 PT lumber, pre-cut', isRequired: true,
          metadata: { quantity: '3', specification: '2x12x16 ft' } },
        { logicalItemId: 'lid_a_m2', contentType: 'material', title: 'Decking Screws',
          body: 'Exterior-grade', isRequired: true,
          metadata: { quantity: '1 box', specification: '#9 x 3 inch' } },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterA.id, versionId: versionA.id,
      sectionType: 'procedure', title: 'Procedure', sortOrder: 3,
      contentItems: [
        { logicalItemId: 'lid_a_p1', contentType: 'numberedStep', title: 'Remove old stringers',
          body: 'Carefully demolish existing stair stringers, preserving the deck frame.',
          sortOrder: 0,
          metadata: { warning: 'Check for wasp nests before reaching into enclosed areas.' } },
        { logicalItemId: 'lid_a_p2', contentType: 'numberedStep', title: 'Cut new stringers',
          body: 'Using the framing square, mark and cut three identical stringers.',
          sortOrder: 1,
          metadata: { tip: 'Use a stair gauge to ensure consistent rise and run.' } },
        { logicalItemId: 'lid_a_p3', contentType: 'numberedStep', title: 'Install stringers',
          body: 'Attach stringers to the deck frame with hurricane ties and structural screws.',
          sortOrder: 2,
          metadata: { warning: 'Verify stringer spacing does not exceed 16 inches OC.' } },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterA.id, versionId: versionA.id,
      sectionType: 'quality', title: 'Quality Standards', sortOrder: 4,
      contentItems: [
        { logicalItemId: 'lid_a_q1', contentType: 'qualityCheck', title: 'Rise consistency',
          body: 'Maximum variation between risers: 3/8 inch.', isRequired: true },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterA.id, versionId: versionA.id,
      sectionType: 'scope', title: 'Scope', sortOrder: 5,
      contentItems: [
        { logicalItemId: 'lid_a_sc1', contentType: 'text', title: 'Overview',
          body: 'This procedure covers the complete replacement of residential deck stairs.' },
      ],
    });

    // Job A
    const jobA = await SR.entities.Job.create({
      companyId, title: 'Stage4 Test: Deck Stair Repair',
      trade: 'Carpentry', category: 'Exterior',
      shortDescription: 'Complete deck stair replacement procedure.',
      status: 'Published', sourceType: 'essential_sop',
      sourceMasterId: masterA.id, sourceVersionId: versionA.id,
      isArchived: false, tags: [FIXTURE_TAG],
    });

    await SR.entities.ProvisioningRecord.create({
      provisioningKey: `ESOP_PROVISION:${companyId}:${masterA.id}`,
      companyId, masterId: masterA.id, companyJobId: jobA.id,
      assignmentStatus: 'ACTIVE', assignedAt: new Date().toISOString(),
      assignedBy: user.id, assignmentSource: 'MANUAL',
      distributionEventId: null,
      provisioningStatus: 'COMPLETED', operationType: 'CREATE_NEW_COMPANY_JOB',
      lastProvisionedVersionId: versionA.id,
      lastProvisionedAt: new Date().toISOString(),
      attemptCount: 1, lastAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    // Master B: Drywall Patch Repair
    const masterB = await SR.entities.EssentialSOPMaster.create({
      title: 'Stage4 Test: Drywall Patch Repair',
      slug: `stage4-test-drywall-patch-${Date.now()}`,
      category: 'Interior', trade: 'Drywall',
      tags: [FIXTURE_TAG], status: 'active',
      distributionStatus: 'internal', defaultDistributionPolicy: 'MANUAL',
    });

    const versionB = await SR.entities.EssentialSOPVersion.create({
      masterId: masterB.id, versionNumber: 1, status: 'published',
      publishedAt: new Date().toISOString(), publishedByUserId: user.id,
    });
    await SR.entities.EssentialSOPMaster.update(masterB.id, { currentPublishedVersionId: versionB.id });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterB.id, versionId: versionB.id,
      sectionType: 'safety', title: 'Safety', sortOrder: 0,
      contentItems: [
        { logicalItemId: 'lid_b_s1', contentType: 'warning', title: 'Dust Protection',
          body: 'Wear a N95 dust mask when sanding drywall compound.',
          isRequired: true, isCritical: true,
          metadata: { severity: 'high', requiredAction: 'Seal off HVAC returns before sanding.' } },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterB.id, versionId: versionB.id,
      sectionType: 'materials', title: 'Materials', sortOrder: 1,
      contentItems: [
        { logicalItemId: 'lid_b_m1', contentType: 'material', title: 'Joint Compound',
          body: 'All-purpose premix', isRequired: true,
          metadata: { quantity: '1 gallon', specification: '5-gal bucket' } },
        { logicalItemId: 'lid_b_m2', contentType: 'material', title: 'Drywall Tape',
          body: 'Paper or fiberglass mesh', isRequired: true,
          metadata: { quantity: '1 roll', specification: '250 ft' } },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterB.id, versionId: versionB.id,
      sectionType: 'procedure', title: 'Procedure', sortOrder: 2,
      contentItems: [
        { logicalItemId: 'lid_b_p1', contentType: 'numberedStep', title: 'Cut and clean the hole',
          body: 'Square up the damaged area with a utility knife.', sortOrder: 0,
          metadata: { warning: 'Check for electrical wiring behind the wall before cutting.' } },
        { logicalItemId: 'lid_b_p2', contentType: 'numberedStep', title: 'Install the patch',
          body: 'Apply compound in three thin coats, feathering edges.', sortOrder: 1,
          metadata: { tip: 'Let each coat dry completely before applying the next.' } },
      ],
    });

    await SR.entities.EssentialSOPSection.create({
      masterId: masterB.id, versionId: versionB.id,
      sectionType: 'scope', title: 'Scope', sortOrder: 3,
      contentItems: [
        { logicalItemId: 'lid_b_sc1', contentType: 'text', title: 'Overview',
          body: 'This procedure covers patching small to medium holes in drywall.' },
      ],
    });

    const jobB = await SR.entities.Job.create({
      companyId, title: 'Stage4 Test: Drywall Patch Repair',
      trade: 'Drywall', category: 'Interior',
      shortDescription: 'Drywall hole patching procedure.',
      status: 'Published', sourceType: 'essential_sop',
      sourceMasterId: masterB.id, sourceVersionId: versionB.id,
      isArchived: false, tags: [FIXTURE_TAG],
    });

    await SR.entities.ProvisioningRecord.create({
      provisioningKey: `ESOP_PROVISION:${companyId}:${masterB.id}`,
      companyId, masterId: masterB.id, companyJobId: jobB.id,
      assignmentStatus: 'ACTIVE', assignedAt: new Date().toISOString(),
      assignedBy: user.id, assignmentSource: 'MANUAL',
      distributionStatus: null, distributionEventId: null,
      provisioningStatus: 'COMPLETED', operationType: 'CREATE_NEW_COMPANY_JOB',
      lastProvisionedVersionId: versionB.id,
      lastProvisionedAt: new Date().toISOString(),
      attemptCount: 1, lastAttemptAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });

    // Company Resource on jobA
    const resource = await SR.entities.CompanyResource.create({
      companyId, jobId: jobA.id,
      title: 'Trex Installation Manual (Stage4 Test)',
      url: 'https://example.com/trex-manual-stage4-test',
      resourceType: 'manual',
      description: 'Test fixture for resource metadata verification.',
      displayOrder: 0, createdByUserId: user.id,
    });

    // Archived job (for stale-focus test)
    const jobArchived = await SR.entities.Job.create({
      companyId, title: 'Stage4 Test: Archived SOP',
      trade: 'Carpentry', category: 'Exterior',
      status: 'Published', sourceType: 'essential_sop',
      sourceMasterId: masterA.id, sourceVersionId: versionA.id,
      isArchived: true, tags: [FIXTURE_TAG],
    });

    // ── Resolve knowledge ──────────────────────────────────────────────────
    const knowledge = await resolveCompanyKnowledge(SR, companyId);

    // Verify fixtures are in the eligible set
    const fixtureJobs = knowledge.jobs.filter((j: any) =>
      j.tags && j.tags.includes(FIXTURE_TAG) && !j.isArchived
    );
    const jobAId = fixtureJobs.find((j: any) => j.title.includes('Deck Stair'))?.id;
    const jobBId = fixtureJobs.find((j: any) => j.title.includes('Drywall'))?.id;

    const tests: any = {};

    // ── Test A: Targeted safety question ───────────────────────────────────
    {
      const decision = routeAssistantRequest(knowledge, 'What safety precautions are needed for the stage4 test deck stair repair?', [jobAId]);
      const result = selectAiContext(knowledge, 'What safety precautions are needed for the stage4 test deck stair repair?', decision, [jobAId], []);
      const ctx = result.contextText;
      tests.A_safety_targeted = {
        route: decision.route,
        queryMode: result.stats.queryMode,
        sopCount: result.stats.sopCount,
        sectionCount: result.stats.sectionCount,
        contextChars: result.stats.contextChars,
        includesSafety: ctx.includes('Safety'),
        includesProcedure: ctx.includes('Procedure'),
        includesScope: ctx.includes('Scope'),
        excludesTools: !ctx.includes('## Tools'),
        excludesMaterials: !ctx.includes('## Materials'),
        hasSeverity: ctx.includes('Severity: high'),
        hasCritical: ctx.includes('Critical'),
        hasRequiredAction: ctx.includes('Required action'),
      };
    }

    // ── Test B: Targeted materials question ────────────────────────────────
    {
      const decision = routeAssistantRequest(knowledge, 'What materials are needed for the stage4 test drywall patch repair?', [jobBId]);
      const result = selectAiContext(knowledge, 'What materials are needed for the stage4 test drywall patch repair?', decision, [jobBId], []);
      const ctx = result.contextText;
      tests.B_materials_targeted = {
        route: decision.route,
        queryMode: result.stats.queryMode,
        sopCount: result.stats.sopCount,
        includesMaterials: ctx.includes('## Materials'),
        excludesProcedure: !ctx.includes('## Procedure'),
        hasQuantity: ctx.includes('Qty:'),
        hasSpec: ctx.includes('Spec:'),
      };
    }

    // ── Test C: Complete procedure walkthrough ──────────────────────────────
    {
      const decision = routeAssistantRequest(knowledge, 'Walk me through the complete stage4 test deck stair repair procedure', []);
      const result = selectAiContext(knowledge, 'Walk me through the complete stage4 test deck stair repair procedure', decision, [], []);
      const ctx = result.contextText;
      tests.C_comprehensive = {
        route: decision.route,
        queryMode: result.stats.queryMode,
        sopCount: result.stats.sopCount,
        hasAllSections: ['Scope', 'Tools', 'Materials', 'Procedure', 'Safety', 'Quality Standards']
          .every(s => ctx.includes(s)),
        contextChars: result.stats.contextChars,
      };
    }

    // ── Test D: Multi-SOP comparison ───────────────────────────────────────
    {
      const q = 'Compare the safety requirements of the stage4 test deck stair repair and stage4 test drywall patch repair procedures';
      const decision = routeAssistantRequest(knowledge, q, []);
      const result = selectAiContext(knowledge, q, decision, [], []);
      const ctx = result.contextText;
      tests.D_comparison = {
        route: decision.route,
        queryMode: result.stats.queryMode,
        sopCount: result.stats.sopCount,
        includesBothSops: result.includedSopIds.includes(jobAId) && result.includedSopIds.includes(jobBId),
        hasSeparateSopBlocks: (ctx.match(/=== src-/g) || []).length >= 2,
      };
    }

    // ── Test E: Metadata survives context construction ─────────────────────
    {
      const decision = routeAssistantRequest(knowledge, 'What safety precautions are needed for the stage4 test deck stair repair?', [jobAId]);
      const result = selectAiContext(knowledge, 'What safety precautions are needed for the stage4 test deck stair repair?', decision, [jobAId], []);
      const ctx = result.contextText;
      tests.E_metadata = {
        hasSeverity: ctx.includes('Severity: high'),
        hasCritical: ctx.includes('Critical'),
        hasRequiredAction: ctx.includes('Required action:'),
        hasQuantity: ctx.includes('Qty:'),
        hasSpec: ctx.includes('Spec:'),
        hasWarning: ctx.includes('Warning:'),
        hasTip: ctx.includes('Tip:'),
        hasRequired: ctx.includes('Required'),
      };
    }

    // ── Test F: Follow-up with focus ──────────────────────────────────────
    {
      const history = [
        { role: 'user' as const, text: 'What tools do I need for the stage4 test deck stair repair?' },
        { role: 'assistant' as const, text: 'You need a cordless drill and circular saw.' },
      ];
      const q = 'What about the safety requirements for it?';
      const decision = routeAssistantRequest(knowledge, q, [jobAId]);
      const result = selectAiContext(knowledge, q, decision, [jobAId], history);
      tests.F_followup = {
        route: decision.route,
        includesFocus: result.includedSopIds.includes(jobAId),
        hasHistory: result.historyText !== '(none)',
        historyChars: result.stats.historyChars,
      };
    }

    // ── Test G: Subject change ─────────────────────────────────────────────
    {
      const history = [
        { role: 'user' as const, text: 'Tell me about the stage4 test deck stair repair procedure' },
        { role: 'assistant' as const, text: 'The deck stair repair involves removing old stringers...' },
        { role: 'user' as const, text: 'What tools are needed?' },
        { role: 'assistant' as const, text: 'You need a drill and saw.' },
      ];
      const q = 'How do I install vinyl siding?';
      const result = selectAiContext(knowledge, q, routeAssistantRequest(knowledge, q, []), [], history);
      tests.G_subject_change = {
        historyText: result.historyText,
        historyChars: result.stats.historyChars,
        trimmedHistory: result.stats.historyChars < 200,
      };
    }

    // ── Test H: Stale focus (archived SOP) ─────────────────────────────────
    {
      const staleFocus = [jobArchived.id];
      const q = 'What safety precautions are needed?';
      const result = selectAiContext(knowledge, q, routeAssistantRequest(knowledge, q, staleFocus), staleFocus, []);
      tests.H_stale_focus = {
        staleJobExcluded: !result.includedSopIds.includes(jobArchived.id),
        includedSopIds: result.includedSopIds.length,
      };
    }

    // ── Test J: Resource metadata only ────────────────────────────────────
    {
      const q = 'Is there a manual for the stage4 test deck stair repair?';
      const decision = routeAssistantRequest(knowledge, q, [jobAId]);
      const result = selectAiContext(knowledge, q, decision, [jobAId], []);
      const ctx = result.contextText;
      tests.J_resources = {
        route: decision.route,
        includesResourceMetadata: ctx.includes('## Resources'),
        includesResourceUrl: ctx.includes('example.com'),
        hasUnverifiedNote: ctx.includes('not been verified'),
      };
    }

    // ── Test K: Full pipeline — generative AI call count ───────────────────
    {
      const q = 'Explain the complete procedure for the stage4 test deck stair repair';
      const invokeRes = await base44.functions.invoke('askAssistant', {
        companyId, question: q, focusJobIds: [jobAId],
      });
      const data = await invokeRes.json();
      tests.K_generative_pipeline = {
        route: data.route,
        aiCalls: data._routingMetrics?.aiCalls,
        hasAnswer: typeof data.answer === 'string' && data.answer.length > 20,
        hasSources: Array.isArray(data.sources),
        sourceCount: data.sources?.length,
        contextSopCount: data._contextStats?.sopCount,
        contextQueryMode: data._contextStats?.queryMode,
        contextChars: data._contextStats?.contextChars,
      };
    }

    // ── Test L: Direct route — zero AI calls ───────────────────────────────
    {
      const q = 'What tools are needed for the stage4 test deck stair repair?';
      const invokeRes = await base44.functions.invoke('askAssistant', {
        companyId, question: q,
      });
      const data = await invokeRes.json();
      tests.L_direct_pipeline = {
        route: data.route,
        aiCalls: data._routingMetrics?.aiCalls,
        hasAnswer: typeof data.answer === 'string' && data.answer.length > 10,
        hasSources: Array.isArray(data.sources),
      };
    }

    // ── Test M: Response shape compatibility ─────────────────────────────
    {
      const q = 'Walk me through the complete stage4 test drywall patch repair';
      const invokeRes = await base44.functions.invoke('askAssistant', {
        companyId, question: q,
      });
      const data = await invokeRes.json();
      const sourceShape = data.sources?.[0] ? Object.keys(data.sources[0]).sort() : [];
      tests.M_response_shape = {
        hasAnswer: typeof data.answer === 'string',
        hasSources: Array.isArray(data.sources),
        hasRoute: typeof data.route === 'string',
        hasRoutingMetrics: !!data._routingMetrics,
        hasContextStats: !!data._contextStats,
        sourceKeys: sourceShape,
        expectedKeys: ['jobId', 'jobTitle', 'item', 'section', 'sectionType'].sort(),
        shapeCompatible: JSON.stringify(sourceShape) === JSON.stringify(['jobId', 'jobTitle', 'item', 'section', 'sectionType'].sort()),
      };
    }

    // ── Cleanup ────────────────────────────────────────────────────────────
    await SR.entities.CompanyResource.delete(resource.id);
    await SR.entities.Job.delete(jobA.id);
    await SR.entities.Job.delete(jobB.id);
    await SR.entities.Job.delete(jobArchived.id);

    // Delete provisioning records
    const provisioningRecords = await SR.entities.ProvisioningRecord.filter({ companyId, masterId: { $in: [masterA.id, masterB.id] } }, '-createdAt', 10);
    for (const pr of provisioningRecords) await SR.entities.ProvisioningRecord.delete(pr.id);

    // Delete sections
    const sectionsA = await SR.entities.EssentialSOPSection.filter({ masterId: masterA.id }, '-sortOrder', 10);
    for (const s of sectionsA) await SR.entities.EssentialSOPSection.delete(s.id);
    const sectionsB = await SR.entities.EssentialSOPSection.filter({ masterId: masterB.id }, '-sortOrder', 10);
    for (const s of sectionsB) await SR.entities.EssentialSOPSection.delete(s.id);

    await SR.entities.EssentialSOPVersion.delete(versionA.id);
    await SR.entities.EssentialSOPVersion.delete(versionB.id);
    await SR.entities.EssentialSOPMaster.delete(masterA.id);
    await SR.entities.EssentialSOPMaster.delete(masterB.id);

    return Response.json({
      companyId,
      fixtureJobs: { jobAId, jobBId },
      eligibleJobCount: knowledge.jobs.length,
      tests,
    });
  } catch (error: any) {
    return Response.json({ error: error.message || 'Test failed', stack: error.stack }, { status: 500 });
  }
}