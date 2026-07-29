# Essential SOP v0.4 Restoration Guide

**Version:** v0.4.0  
**Milestone:** Phase 4 Foundation Complete  
**Date Created:** 2026-07-29

---

## Authoritative Source Version

```
Authoritative Source Version:
0ebe53c39ea2f2811669bfae291e13f07ab9d0f8

Version Label:
v0.4.0

Milestone:
Essential SOP v0.4 — Phase 4 Foundation Complete

Milestone Timestamp (UTC):
2026-07-29T04:01:21.306Z

Milestone Timestamp (Local / Alaska):
2026-07-28T20:01:21 AKDT
```

> This git commit hash was read directly from `.git/HEAD` in the Base44 sandbox on 2026-07-29T04:01:21Z. Reference this hash when contacting Base44 support for restoration.

---

## How to Locate the v0.4 Snapshot

Base44 does not currently support native snapshots, branches, or version-history checkpoints through any exposed tool or UI. The v0.4 baseline is preserved as:

1. **Git commit** — `0ebe53c39ea2f2811669bfae291e13f07ab9d0f8` (contact Base44 support to restore to this commit)
2. **In-repository documentation** — `docs/v0.4/` directory (this file and companions)
3. **Entity schemas** — `base44/entities/*.jsonc`
4. **Backend functions** — `base44/functions/*/entry.ts`
5. **Frontend source** — `src/pages/`, `src/components/`, `src/lib/`

---

## Step-by-Step Restoration

### Step 1 — Contact Base44 Support

Use the template in `docs/v0.4/BASE44_RESTORE_REQUEST_TEMPLATE.md`. Reference:

- Commit: `0ebe53c39ea2f2811669bfae291e13f07ab9d0f8`
- Timestamp: `2026-07-29T04:01:21.306Z`
- Version label: `v0.4.0`

### Step 2 — Restore Application Code

If code has been modified and needs to be rolled back, restore the following files to their v0.4 state:

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

### Step 3 — Restore Entity Schemas

Entity schemas live in `base44/entities/*.jsonc`. Authoritative v0.4 schemas:

- `Company.jsonc`
- `CompanyMembership.jsonc` ← includes `isTestMembership` field (added v0.4)
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

⚠️ Do not alter schemas during restoration. Any schema change is a Phase 5+ change.

### Step 4 — Restore Backend Functions

`base44/functions/*/entry.ts`:

- `createCompany`, `deleteAccount`, `inviteMember`, `manageMember`
- `managePlan`, `migrateToCompany`, `publishRevision`, `reviewEditRequest`
- `seatCheck`, `submitEditRequest`, `submitRevision`

Shared utilities: `base44/shared/planUtils.js`

Do not weaken authentication checks during restoration.

### Step 5 — Restore Demo Data

If the 15 demo jobs are missing:
1. Open the app as the General Manager user
2. Navigate to Profile → Prototype Controls → Reset Demo Data
3. Confirm the reset — app reloads with 15 demo Jobs

If synthetic test memberships were removed, re-create them:

```js
const COMPANY_ID = '6a695715552c892bd5064008';
const now = new Date().toISOString();
await base44.asServiceRole.entities.CompanyMembership.bulkCreate([
  { companyId: COMPANY_ID, userId: 'test-project-lead-user',    role: 'project_lead',    status: 'active', joinedAt: now, isTestMembership: true },
  { companyId: COMPANY_ID, userId: 'test-project-manager-user', role: 'project_manager', status: 'active', joinedAt: now, isTestMembership: true },
  { companyId: COMPANY_ID, userId: 'test-technician-user',      role: 'technician',      status: 'active', joinedAt: now, isTestMembership: true },
]);
```

### Step 6 — Reconnect Environment Variables

- Verify no secret keys appear in client-side source code
- Re-enter any backend function API keys via the Base44 secrets panel
- Confirm `subscriptionStatus: 'prototype'` is still set on the Company record (prevents live billing)

### Step 7 — Avoid Duplicate External Actions

- Do NOT trigger invitation emails for test/synthetic users
- Do NOT activate Stripe billing in production mode
- `subscriptionStatus: 'prototype'` keeps billing in sandbox — verify it is set before doing anything else

### Step 8 — Run the Phase 4 Acceptance Suite

Run the acceptance test script with:
```
COMPANY_ID = '6a695715552c892bd5064008'
```

Expected result: **25 PASS · 2 Expected Security Rejections · 0 FAIL**

---

## External Backup Checklist

Complete these steps to create an external copy of the v0.4 source outside Base44:

- [ ] Contact Base44 support or use GitHub Sync (if enabled) to download the full project source at commit `0ebe53c39ea2f2811669bfae291e13f07ab9d0f8`
- [ ] Save the export outside Base44 — do not rely solely on the platform copy
- [ ] Store one copy in cloud storage (Google Drive, Dropbox, iCloud, S3, etc.)
- [ ] Store one second copy locally or in a second cloud provider
- [ ] Confirm the exported archive opens successfully
- [ ] Confirm `src/App.jsx` is present in the archive
- [ ] Confirm `base44/functions/` directory and all 11 backend functions are present
- [ ] Confirm `base44/entities/` directory and all 12 entity schemas are present
- [ ] Confirm `src/docs/v0.4/` directory and all 5 backup documents are present
- [ ] Record the archive filename: `essential-sop-v0.4.0-phase4-source-backup.zip`
- [ ] Record the archive creation date
- [ ] Do NOT overwrite the v0.4 archive with future version exports — use new filenames

**Suggested filename:** `essential-sop-v0.4.0-phase4-source-backup.zip`

---

## Restoration Acceptance Checklist

Run through every item after restoration:

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

## Verify 15 Jobs

```js
const jobs = await base44.entities.Job.filter({ companyId }, '-updated_date', 200);
console.log(jobs.filter(j => !j.isArchived && j.status === 'Published').length); // Expected: 15
```

## Verify Six Visible Sections Per Job

```js
const sections = await base44.entities.JobSection.filter({ jobId: someJobId });
console.log(sections.filter(s => s.sectionType !== 'documentation').length); // Expected: 6
```

## Verify Documentation Excluded

```js
// Documentation items exist in DB but are never surfaced in the UI
// Verify by checking that DISPLAY_ORDER in JobDetail.jsx does not include 'documentation'
// DISPLAY_ORDER = ['tools', 'materials', 'scope', 'procedure', 'safety', 'quality']
```

## Verify Last GM Safeguard

Attempt to remove or demote the only General Manager via the Team Members page. The action must be blocked. The `manageMember` backend function enforces this check server-side.

---

## Post-Restoration Version Naming

- `v0.4.0` — this stable baseline (READ ONLY — never overwrite)
- `v0.5.0` — first Phase 5 change
- `docs/v0.4/` — never modify after this milestone is signed off