# Essential SOP v0.4 Restoration Guide

**Version:** v0.4.0  
**Milestone:** Phase 4 Foundation Complete  
**Date Created:** 2026-07-29

---

## How to Locate the v0.4 Snapshot

Base44 does not currently support native snapshots, branches, or version-history checkpoints. The v0.4 baseline is preserved as:

1. **In-repository documentation** — `docs/v0.4/` directory (this file and companions)
2. **Entity schemas** — `base44/entities/*.jsonc` (source of truth for all data models)
3. **Backend functions** — `base44/functions/*/entry.ts`
4. **Frontend source** — `src/pages/`, `src/components/`, `src/lib/`

The git commit hash at the time `docs/v0.4/BACKUP_MANIFEST.md` was first committed is the exact restorable point. To restore to that commit, contact Base44 support and reference version `v0.4.0` and this manifest.

---

## Step-by-Step Restoration

### Step 1 — Restore Application Code

If code has been modified and needs to be rolled back, restore the following files to their v0.4 state (compare against this docs directory for intent, or use git history):

**Core routing and context:**
- `src/App.jsx`
- `src/lib/AppContext.jsx`
- `src/lib/CompanyContext.jsx`
- `src/lib/ThemeContext.jsx`
- `src/lib/AuthContext.jsx`
- `src/lib/constants.js`
- `src/lib/roleLabels.js`
- `src/lib/plans.js`
- `src/lib/appSettings.js`
- `src/lib/seedData.js`

**Layout:**
- `src/components/Layout.jsx`

**Pages (all routes):**
- `src/pages/Jobs.jsx`
- `src/pages/JobDetail.jsx`
- `src/pages/SectionDetail.jsx`
- `src/pages/CreateJob.jsx`
- `src/pages/Assistant.jsx`
- `src/pages/Profile.jsx`
- `src/pages/TeamMembers.jsx`
- `src/pages/EditRequests.jsx`
- `src/pages/ActivityHistory.jsx`
- `src/pages/Notifications.jsx`
- `src/pages/CompanyProfile.jsx`
- `src/pages/RoleLabels.jsx`
- `src/pages/OwnershipAndAccount.jsx`
- `src/pages/Subscription.jsx`
- `src/pages/Plans.jsx`
- `src/pages/AcceptInvitation.jsx`
- `src/pages/Login.jsx`
- `src/pages/Register.jsx`
- `src/pages/ForgotPassword.jsx`
- `src/pages/ResetPassword.jsx`
- `src/pages/DeletionRequests.jsx`
- `src/pages/PrivacyPolicy.jsx`
- `src/pages/TermsOfService.jsx`

**Components:**
- `src/components/NotificationBell.jsx`
- `src/components/EditRequestForm.jsx`
- `src/components/CompanySelector.jsx`
- `src/components/NoCompanyScreen.jsx`
- `src/components/DeleteAccountModal.jsx`
- `src/components/AuthLayout.jsx`
- `src/components/AuthLegalFooter.jsx`
- `src/components/OfflineBanner.jsx`
- `src/components/ProtectedRoute.jsx`
- `src/components/ScrollToTop.jsx`
- `src/components/UserNotRegisteredError.jsx`
- `src/components/sections/ContentEditDialog.jsx`
- `src/components/sections/SectionCard.jsx`
- `src/components/jobs/JobCard.jsx`
- `src/components/jobs/FilterSheet.jsx`

### Step 2 — Restore Entity Schemas

Entity schemas live in `base44/entities/*.jsonc`. These are the authoritative v0.4 schemas:

- `Company.jsonc`
- `CompanyMembership.jsonc`
- `CompanyInvitation.jsonc`
- `Job.jsonc`
- `JobSection.jsonc`
- `SectionContent.jsonc`
- `EditRequest.jsonc`
- `TemporaryEditGrant.jsonc`
- `JobRevision.jsonc`
- `Notification.jsonc`
- `ActivityLog.jsonc`
- `DeletionRequest.jsonc`
- `User.jsonc` (built-in; customized with `customRoleLabels` awareness)

⚠️ Do not alter schemas during restoration. Any schema change is a Phase 5+ change.

### Step 3 — Restore Backend Functions

Backend functions in `base44/functions/*/entry.ts`:

- `createCompany/entry.ts`
- `deleteAccount/entry.ts`
- `inviteMember/entry.ts`
- `manageMember/entry.ts`
- `managePlan/entry.ts`
- `migrateToCompany/entry.ts`
- `publishRevision/entry.ts`
- `reviewEditRequest/entry.ts`
- `seatCheck/entry.ts`
- `submitEditRequest/entry.ts`
- `submitRevision/entry.ts`

Shared utilities in `base44/shared/planUtils.js`.

Do not weaken authentication checks during restoration.

### Step 4 — Restore Demo Data

If the 15 demo jobs are missing, trigger the seed function:

1. Open the app as the General Manager user
2. Navigate to Profile → Prototype Controls → Reset Demo Data
3. Confirm the reset
4. The app will reload with 15 demo Jobs restored

Alternatively, run `resetDemoData(companyId)` from `src/lib/seedData.js` via the developer console.

### Step 5 — Reconnect Environment Variables

Verify the following environment bindings are intact in the Base44 dashboard (Settings → Environment):

- No secret keys should appear in client-side source code
- Backend function secrets (if any API keys were added for email/billing) must be re-entered in the Base44 secrets panel
- The app should NOT automatically send real emails or process real charges after restoration

### Step 6 — Avoid Duplicate External Actions

After restoration:
- Do NOT trigger the invitation email flow for test/synthetic users
- Do NOT activate Stripe billing in production mode
- The `subscriptionStatus: 'prototype'` flag keeps billing in sandbox mode — verify it is still set
- Email delivery is not connected in v0.4 — no risk of duplicate emails

### Step 7 — Run the Phase 4 Acceptance Suite

Re-run the acceptance test script from the developer console or via exec_tool:

```
COMPANY_ID = '6a695715552c892bd5064008'
```

The suite verifies:
- Documentation isolation (8 checks)
- Security rejection of unauthenticated requests (1 check)
- Project Lead functional workflow end-to-end (7 checks)
- Infrastructure integrity (9 checks)

Expected result: **25 PASS · 2 Expected Security Rejections · 0 FAIL**

---

## Restoration Acceptance Checklist

Run through every item below after restoration. Mark each ✅ or ❌.

- [ ] Application loads without a fatal error
- [ ] Authentication works (login, logout, OTP flow)
- [ ] Jobs, Assistant, and Profile are the only three bottom navigation tabs
- [ ] All 15 demo Jobs exist and are Published
- [ ] Each Job displays exactly six sections: Tools, Materials, Scope, Procedure, Safety, Quality Standards
- [ ] Documentation section is not visible on any Job page
- [ ] Jobs search excludes Documentation match labels
- [ ] Assistant excludes Documentation from answers and sources
- [ ] General Manager can invite, suspend, and remove team members
- [ ] Project Manager cannot manage team members (invite/suspend/remove blocked)
- [ ] Project Lead is read-only on Jobs without an approved TemporaryEditGrant
- [ ] Technician is viewer-only on all Job content
- [ ] The final General Manager cannot be removed, suspended, or demoted (backend safeguard)
- [ ] Company A records are not visible to Company B users (companyId isolation)
- [ ] Notifications are scoped to the user's own company
- [ ] Activity History is role-restricted (GM/PM only for sensitive management events)
- [ ] Subscription seat limits are enforced by `seatCheck` backend function
- [ ] No secret API keys appear in any client-side source file

---

## Verify 15 Jobs Are Present

```js
const jobs = await base44.entities.Job.filter({ companyId }, '-updated_date', 200);
const published = jobs.filter(j => !j.isArchived && j.status === 'Published');
console.log(published.length); // Expected: 15
```

## Verify Six Visible Sections Per Job

```js
const sections = await base44.entities.JobSection.filter({ jobId: someJobId });
const visible = sections.filter(s => s.sectionType !== 'documentation');
console.log(visible.length); // Expected: 6
```

## Verify Documentation Excluded

```js
const content = await base44.entities.SectionContent.filter({ jobId: someJobId });
const doc = content.filter(c => c.sectionType === 'documentation');
console.log(doc.length); // Expected: 0 visible (archived records may exist in DB but are never surfaced)
```

## Verify Last GM Safeguard

Attempt to remove or demote the only General Manager via the Team Members page. The action should be blocked with an error message. The `manageMember` backend function enforces this.

---

## Post-Restoration Version Naming

After confirming restoration, continue using:

- `v0.4.0` — this stable baseline (READ ONLY)
- `v0.5.0` — first Phase 5 change
- Never overwrite `docs/v0.4/