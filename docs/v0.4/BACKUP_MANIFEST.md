# Essential SOP v0.4 Backup Manifest

**Export Name:** essential-sop-v0.4-phase-4-data-backup  
**Export Date:** 2026-07-29  
**Version:** v0.4.0  
**Milestone:** Phase 4 Foundation Complete

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

These three membership records were created exclusively to exercise role coverage in the Phase 4 acceptance test suite. They are **not real authenticated users** and **cannot sign in**.

| Record ID | userId | Role | isTestMembership |
|---|---|---|---|
| 6a6975e7c4d75d0de8239f7a | test-project-lead-user | project_lead | true |
| 6a6975e80702aa1510e20352 | test-project-manager-user | project_manager | true |
| 6a6975e8276f8d3d376cc72b | test-technician-user | technician | true |

**Purpose:** Allow the acceptance suite to locate `project_lead`, `project_manager`, and `technician` memberships and verify role-gating logic without requiring additional registered users.  
**Risk:** None. The userIds do not correspond to any auth identity. They will never receive real emails. They will never appear in the live app UI (app loads the authenticated user's own memberships only).

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

---

## Platform Backup Capabilities

| Method | Status |
|---|---|
| Native Base44 snapshot | NOT SUPPORTED |
| Version-history checkpoint | NOT SUPPORTED |
| Branch | NOT SUPPORTED |
| Private app duplicate | NOT SUPPORTED (no duplication tool available) |
| Source-code export (in-repo docs) | CREATED |
| Entity schema export | CREATED (entity files in `base44/entities/`) |
| Data export summary | CREATED (`docs/v0.4/DATA_EXPORT_SUMMARY.md`) |
| Backup manifest | CREATED (this file) |
| Restoration guide | CREATED (`docs/v0.4/RESTORATION_GUIDE.md`) |

> **Note:** Base44 does not currently expose snapshot, branch, checkpoint, or app-duplication APIs through any available tool. The authoritative rollback mechanism for this version is: (1) the in-repository documentation in `docs/v0.4/`, (2) the entity schema files in `base44/entities/`, and (3) the backend function source in `base44/functions/`. The git commit at the point these docs were written IS the restorable checkpoint — contact Base44 support to restore to a specific commit if needed.

---

## Pre-Phase-5 Protection Notice

This v0.4.0 snapshot must never be overwritten.  
Future versions must use new version numbers:

- `v0.5.0` — Phase 5 initial
- `v0.5.1` — Phase 5 bug fix
- `v0.6.0` — Phase 6

Do not begin Phase 5 work until this manifest has been reviewed and acknowledged.