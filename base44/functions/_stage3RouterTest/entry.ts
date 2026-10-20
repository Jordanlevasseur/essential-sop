import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { resolveCompanyKnowledge } from '../../shared/companyKnowledgeEngine.ts';
import { routeAssistantRequest } from '../../shared/assistantRouter.ts';
import { buildDirectAnswer } from '../../shared/directAnswerBuilder.ts';

/**
 * Stage 3 router test — temporary verification function.
 * Tests routing decisions and direct answer building for all required cases.
 * Creates and cleans up a disposable CompanyResource fixture.
 */
export default async function(req: Request): Promise<Response> {
  const base44 = createClientFromRequest(req);
  const SR = base44.asServiceRole;
  const companyId = '6a6c36a65099d5b3924eaa0d';

  const results: any = { tests: {}, summary: {} };

  // ── Resolve knowledge once ──
  const knowledge = await resolveCompanyKnowledge(SR, companyId);
  results.summary.eligibleJobCount = knowledge.jobs.length;
  results.summary.contentItemCount = knowledge.contentIndex.length;
  results.summary.resourceCount = knowledge.resources.length;
  results.summary.knowledgeComplete = knowledge.metrics.complete;
  results.summary.metricsLimits = knowledge.metrics.limits;

  // Find specific SOPs for testing
  const deckStair = knowledge.jobs.find(j => j.title === 'Deck Stair Repair');
  const drywall = knowledge.jobs.find(j => j.title === 'Drywall Patch and Repair');
  const waterHeater = knowledge.jobs.find(j => j.title === 'Water Heater Replacement');
  const exteriorDoor = knowledge.jobs.find(j => j.title === 'Exterior Door Replacement');
  results.summary.testSops = {
    deckStair: deckStair?.id,
    drywall: drywall?.id,
    waterHeater: waterHeater?.id,
    exteriorDoor: exteriorDoor?.id,
  };

  // Helper: run a routing test
  function runTest(name: string, question: string, focusJobIds: string[] = []) {
    const decision = routeAssistantRequest(knowledge, question, focusJobIds);
    let built: any = null;
    if (decision.route === 'direct' || decision.route === 'clarification') {
      built = buildDirectAnswer(knowledge, decision);
    }
    results.tests[name] = {
      question,
      route: decision.route,
      directKind: decision.directKind || null,
      targetJobId: decision.targetJobId || null,
      sectionType: decision.sectionType || null,
      stepNumber: decision.stepNumber || null,
      tradeFilter: decision.tradeFilter || null,
      categoryFilter: decision.categoryFilter || null,
      confidence: decision.confidence,
      reason: decision.reason,
      ambiguousJobIds: decision.ambiguousJobIds || null,
      aiCalls: (decision.route === 'generative') ? 1 : 0,
      answerPreview: built?.answer?.slice(0, 300) || null,
      sources: built?.sources || null,
    };
  }

  // ── A. Exact SOP discovery → direct, 0 AI calls ──
  runTest('A_sop_discovery', 'Find the Deck Stair Repair SOP');

  // ── B. Tools request → direct, 0 AI calls ──
  runTest('B_tools', 'What tools do I need for Deck Stair Repair?');

  // ── C. Materials request → direct, 0 AI calls ──
  runTest('C_materials', 'List the materials for Deck Stair Repair');

  // ── D1. Safety request → direct ──
  runTest('D1_safety', 'What are the safety requirements for Deck Stair Repair?');

  // ── D2. Quality request → direct ──
  runTest('D2_quality', 'What are the quality standards for Deck Stair Repair?');

  // ── D3. Scope request → direct ──
  runTest('D3_scope', 'What is the scope of Deck Stair Repair?');

  // ── E. Specific procedure step → direct ──
  runTest('E_specific_step', 'What is step 2 of Deck Stair Repair?');

  // ── E2. Specific step out of range ──
  runTest('E2_step_out_of_range', 'What is step 99 of Deck Stair Repair?');

  // ── F. Alternative terminology (drywall/sheetrock) ──
  runTest('F_synonym', 'What tools do I need for sheetrock repair?');

  // ── F2. Alternative terminology (water heater/boiler) ──
  runTest('F2_synonym_water', 'Show me the tools for boiler replacement');

  // ── G. Conversational follow-up → uses focus SOP ──
  runTest('G_followup', 'What tools do I need for that?', [deckStair?.id]);

  // ── G2. Follow-up with stale focus (ineligible jobId) ──
  runTest('G2_stale_focus', 'What tools do I need for that?', ['nonexistent_job_id_12345']);

  // ── H. Explanation request → generative ──
  runTest('H_explain', 'Explain how to repair deck stairs');

  // ── H2. "How do I" → generative ──
  runTest('H2_how_to', 'How do I install a water heater?');

  // ── I. Multi-SOP comparison → generative ──
  runTest('I_compare', 'Compare deck stair repair vs deck board replacement');

  // ── J. Ambiguous target → clarification ──
  // "door" matches both "Exterior Door Replacement" and potentially others
  runTest('J_ambiguous', 'What tools do I need for door replacement');

  // ── J2. Section without target → clarification ──
  runTest('J2_no_target', 'What tools do I need?');

  // ── K. Missing info (nonexistent SOP) → no_match ──
  runTest('K_missing', 'Find the Nuclear Reactor Maintenance SOP');

  // ── K2. Fabrication prevention (safety claim) → generative or no_match ──
  runTest('K2_fabrication', 'What is the OSHA requirement for deck stairs?');

  // ── L. Company Resource discovery ── (tested after creating fixture below)

  // ── N. Stale focusJobId (archived SOP) ──
  // Use an ID that doesn't exist in the eligible set
  runTest('N_stale_focus_archived', 'What tools do I need for that?', ['6a9781ff5b08fcff2a398fb5_nonexistent']);

  // ── Trade listing → direct ──
  runTest('trade_listing', 'Show me all Carpentry SOPs');

  // ── Category listing → direct ──
  runTest('category_listing', 'List all SOPs in Exterior category');

  // ── Count all SOPs → direct ──
  runTest('count_all', 'How many SOPs do we have?');

  // ── Count section items → direct ──
  runTest('count_section', 'How many tools does Deck Stair Repair have?');

  // ── Procedure listing → direct (explicit "list") ──
  runTest('procedure_list', 'List the steps for Deck Stair Repair');

  // ── Procedure explanation → generative ──
  runTest('procedure_explain', 'What is the procedure for Deck Stair Repair?');

  // ── Resource request (before fixture) → no resources ──
  runTest('resource_before', 'Is there a manual for Deck Stair Repair?', [deckStair?.id]);

  // ════════════════════════════════════════════════════════════════════════════
  // ── L & M: Company Resource fixture tests ──────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════

  if (deckStair) {
    // Create a disposable resource fixture on Deck Stair Repair
    const fixtureResource = await SR.entities.CompanyResource.create({
      companyId,
      jobId: deckStair.id,
      title: 'Trex Installation Manual (Test Fixture)',
      url: 'https://example.com/trex-manual-test',
      resourceType: 'manual',
      description: 'Disposable test fixture for Stage 3 resource discovery verification.',
      displayOrder: 999,
      createdByUserId: 'stage3_test_fixture',
    });

    // Re-resolve knowledge to pick up the new resource
    const knowledgeWithResource = await resolveCompanyKnowledge(SR, companyId);

    // L. Resource discovery → should find the fixture
    const decisionL = routeAssistantRequest(knowledgeWithResource, 'Is there a manufacturer manual for Deck Stair Repair?', [deckStair.id]);
    let builtL: any = null;
    if (decisionL.route === 'direct' || decisionL.route === 'clarification') {
      builtL = buildDirectAnswer(knowledgeWithResource, decisionL);
    }
    results.tests['L_resource_discovery'] = {
      question: 'Is there a manufacturer manual for Deck Stair Repair?',
      route: decisionL.route,
      directKind: decisionL.directKind,
      targetJobId: decisionL.targetJobId,
      aiCalls: 0,
      answerPreview: builtL?.answer?.slice(0, 400),
      sources: builtL?.sources,
      resourceCount: knowledgeWithResource.resources.filter(r => r.jobId === deckStair.id).length,
    };

    // M. Archived/revoked resource parent → resource unavailable
    // Create a resource on an archived/non-existent job, then verify it's excluded
    const archivedJob = await SR.entities.Job.create({
      companyId,
      title: 'Test Archived SOP (Stage 3 Fixture)',
      status: 'Draft',
      isArchived: true,
    });
    const fixtureResource2 = await SR.entities.CompanyResource.create({
      companyId,
      jobId: archivedJob.id,
      title: 'Manual for Archived SOP (Test Fixture)',
      url: 'https://example.com/archived-manual-test',
      resourceType: 'manual',
      description: 'Should NOT appear in knowledge (archived parent).',
      displayOrder: 999,
      createdByUserId: 'stage3_test_fixture',
    });

    // Re-resolve knowledge — the archived job's resource should be excluded
    const knowledgeArchived = await resolveCompanyKnowledge(SR, companyId);
    const archivedResources = knowledgeArchived.resources.filter(r => r.jobId === archivedJob.id);
    results.tests['M_archived_resource'] = {
      question: 'Resource attached to archived parent — should be excluded',
      archivedJobEligible: knowledgeArchived.jobs.some(j => j.id === archivedJob.id),
      archivedResourceCount: archivedResources.length,
      expectedExclusion: true,
      passed: archivedResources.length === 0,
    };

    // Cleanup fixtures
    await SR.entities.CompanyResource.delete(fixtureResource.id);
    await SR.entities.CompanyResource.delete(fixtureResource2.id);
    await SR.entities.Job.delete(archivedJob.id);
    results.tests._cleanup = { cleaned: true };
  }

  // ── O. Incomplete retrieval simulation ──
  // Simulate incomplete knowledge by overriding metrics.complete
  const incompleteKnowledge = { ...knowledge, metrics: { ...knowledge.metrics, complete: false } };
  const decisionO = routeAssistantRequest(incompleteKnowledge, 'How many SOPs do we have?');
  results.tests['O_incomplete_count'] = {
    question: 'How many SOPs do we have?',
    route: decisionO.route,
    reason: decisionO.reason,
    expectedRoute: 'generative',
    passed: decisionO.route === 'generative',
  };

  // ── P. Response compatibility check ──
  // Verify a direct response has the { answer, sources } shape
  const decisionP = routeAssistantRequest(knowledge, 'What tools do I need for Deck Stair Repair?');
  const builtP = buildDirectAnswer(knowledge, decisionP);
  results.tests['P_compatibility'] = {
    hasAnswer: typeof builtP.answer === 'string' && builtP.answer.length > 0,
    hasSources: Array.isArray(builtP.sources),
    sourceShape: builtP.sources?.[0] ? Object.keys(builtP.sources[0]) : null,
    expectedKeys: ['jobId', 'jobTitle', 'sectionType', 'section', 'item'],
    passed: builtP.sources?.[0] &&
      ['jobId', 'jobTitle', 'sectionType', 'section', 'item'].every(k => k in builtP.sources[0]),
  };

  // ── Summary ──
  let directCount = 0, genCount = 0, noMatchCount = 0, clarifyCount = 0;
  for (const [name, t] of Object.entries(results.tests)) {
    if (name.startsWith('_')) continue;
    const test = t as any;
    if (test.route === 'direct') directCount++;
    else if (test.route === 'generative') genCount++;
    else if (test.route === 'no_match') noMatchCount++;
    else if (test.route === 'clarification') clarifyCount++;
  }
  results.summary.routeCounts = { direct: directCount, generative: genCount, no_match: noMatchCount, clarification: clarifyCount };

  return Response.json(results);
}