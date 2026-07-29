# Essential SOP v0.4 Backup Manifest

**Export Name:** essential-sop-v0.4-phase-4-data-backup  
**Export Date:** 2026-07-29  
**Version:** v0.4.0  
**Milestone:** Phase 4 Foundation Complete

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

> This git commit hash was read directly from `.git/HEAD` via the Base44 sandbox on 2026-07-29T04:01:21Z. It is the exact state of the repository at the time this milestone was recorded. To restore to this exact version, contact Base44 support and reference this hash.

---

## Acceptance Test Result

| Category | Count |
|---|---|
| PASS | 25 |
| Expected Security Rejections | 2 |
| FAIL | 0 |

All 25 tests passed on 2026-07-29.

---

## Application Structure

**Three bottom navigation tabs (fixed — never add or remove):**
1. Jobs
2. Assistant
3. Profile

**Job field-manual sections (exactly six, in display order):**
1. Tools
2. Materials
3. Scope
4. Procedure
5. Safety
6. Quality Standards

**Confirmed demo Job count:** 15 (all Published, none Archived)

---

## Documentation Status

- Archived documentation records MAY remain in database storage (81 records confirmed present)
- EXCLUDED from all published Job pages (JobDetail DISPLAY_ORDER omits `documentation`)
- EXCLUDED from Jobs search (Jobs.jsx filters `sectionType !== 'documentation'` from allContent)
- EXCLUDED from Assistant sources and answers (Assistant.jsx filters same)
- EXCLUDED from Edit Request section picker (EditRequestForm.jsx SECTIONS array has no documentation)
- EXCLUDED from new Job creation (createJobWithSections uses SECTION_DEFINITIONS — 6 types only)

---

## Phase 4 Systems Included

- **Multi-company isolation** — every entity record carries `companyId`; CompanyContext filters client-side
- **Subscription tiers and seat limits** — `seatCheck` backend function enforces limits before activation
- **Team invitations** — `inviteMember` backend function with token-hash, expiry, and email delivery
- **General Manager safeguards** — last GM cannot be removed, suspended, or demoted
- **Role permissions** — four roles: `general_manager`, `project_manager`, `project_lead`, `technician`
- **Project Lead edit requests** — `submitEditRequest` backend; EditRequest + TemporaryEditGrant entities
- **Section-specific editing access** — grants specify `approvedSectionTypes` array
- **Draft revisions** — `submitRevision` / `publishRevision` backend functions; JobRevision entity
- **Review and publishing** — `reviewEditRequest` backend; GM/PM reviewer queue
- **Notifications** — Notification entity; in-app bell; five filter categories
- **Activity History** — ActivityLog entity; role-restricted (GM/PM only for sensitive events)
- **Company settings** — CompanyProfile, RoleLabels, OwnershipAndAccount pages under Profile
- **Centralized role labels** — `src/lib/roleLabels.js`; `customRoleLabels` field on Company entity

---

## External Systems NOT Fully Connected

| System | Status |
|---|---|
| Real invitation email delivery | NOT CONNECTED — placeholder only |
| Stripe production billing | NOT CONNECTED — prototype mode |
| Apple StoreKit / IAP | NOT CONNECTED |
| Push notifications | NOT CONNECTED |
| Native TestFlight packaging | NOT CONFIGURED |

---

## External Source Export Capability

**Status: REQUIRES BASE44 SUPPORT**

Base44 does not currently expose a user-facing export or download button for full project source through the platform UI. To obtain a complete external source archive, the user must:

1. Contact Base44 support and request a source export for the commit `0ebe53c39ea2f2811669bfae291e13f07ab9d0f8`
2. Alternatively, use the Base44 dashboard "GitHub Sync" feature if enabled for the workspace to push source to a personal GitHub repository
3. Save the resulting archive as: `essential-sop-v0.4.0-phase4-source-backup.zip`

---

## Database Snapshot (as of 2026-07-29)

| Entity | Count |
|---|---|
| Jobs | 15 (all Published) |
| JobSections | 105 |
| SectionContent (visible) | 615 |
| SectionContent (documentation/archived) | 81 |
| CompanyMembership | 4 (1 real + 3 synthetic test) |
| CompanyInvitation | 1 (cancelled test invitation) |
| EditRequest | 1 (cancelled test request) |
| TemporaryEditGrant | 0 |
| JobRevision | 0 |
| Notification | 2 |
| ActivityLog | 6 |

---

## Test-Only (Synthetic) Membership Records

These three records were created exclusively to exercise role coverage in the Phase 4 acceptance suite. They are **not real authenticated users** and **cannot sign in, receive email, or trigger billing**.

| Record ID | userId | Role | isTestMembership |
|---|---|---|---|
| 6a6975e7c4d75d0de8239f7a | test-project-lead-user | project_lead | true |
| 6a6975e80702aa1510e20352 | test-project-manager-user | project_manager | true |
| 6a6975e8276f8d3d376cc72b | test-technician-user | technician | true |

**Why they exist:** The app has one registered user (the GM). Without at least one `project_lead` record, the functional acceptance test for the edit-request workflow cannot locate a PL membership to exercise. These synthetic records fill that gap without requiring additional auth accounts.

**Confirmed properties:**
- userIds are plain strings with no corresponding auth identity
- Will never appear in the live app UI (app loads authenticated user's own memberships)
- Cannot receive real invitations (no email address)
- Cannot trigger billing (no payment method)
- `isTestMembership: true` is now stored on each record (schema updated in v0.4)

---

## Real User Record

| userId | Email | Role |
|---|---|---|
| 6a691f8c348713a104fda7a7 | jordanlevasseur3@gmail.com | general_manager |

---

## Backup Files Created (in-repository)

| File | Purpose |
|---|---|
| `docs/v0.4/BACKUP_MANIFEST.md` | This document |
| `docs/v0.4/RESTORATION_GUIDE.md` | Step-by-step restoration instructions |
| `docs/v0.4/DATA_EXPORT_SUMMARY.md` | Data counts and export verification |
| `docs/v0.4/PHASE4_ACCEPTANCE_RESULTS.md` | Full acceptance test results |
| `docs/v0.4/BASE44_RESTORE_REQUEST_TEMPLATE.md` | Ready-to-send Base44 support restore request |

---

## Platform Backup Capabilities

| Method | Status |
|---|---|
| Native Base44 snapshot | NOT SUPPORTED |
| Version-history checkpoint | NOT SUPPORTED |
| Branch | NOT SUPPORTED |
| Private app duplicate | NOT SUPPORTED |
| Source-code export (in-repo docs) | CREATED |
| Entity schema export | VERIFIED (base44/entities/*.jsonc) |
| Data export summary | CREATED |
| Backup manifest | CREATED (this file) |
| Restoration guide | CREATED |
| Base44 support restore template | CREATED |
| External zip export | REQUIRES BASE44 SUPPORT |

---

## Pre-Phase-5 Protection Notice

This v0.4.0 snapshot must never be overwritten.  
Future versions must use new version numbers:

- `v0.5.0` — Phase 5 initial
- `v0.5.1` — Phase 5 bug fix
- `v0.6.0` — Phase 6

Do not begin Phase 5 work until this manifest has been reviewed and acknowledged.