# Essential SOP v0.4 — Data Export Summary

**Export Name:** essential-sop-v0.4-phase-4-data-backup  
**Export Date:** 2026-07-29T03:45:29.826Z  
**Company ID:** 6a695715552c892bd5064008  
**Company Name:** Essential SOP Demo Company

---

## Export Counts (Verified)

| Entity | Count | Notes |
|---|---|---|
| Jobs | 15 | All Published, none Archived |
| JobSections | 105 | 7 sections × 15 jobs (includes archived documentation sections) |
| SectionContent — visible | 615 | sectionType ≠ documentation |
| SectionContent — documentation | 81 | Archived; preserved in DB; excluded from all UI |
| CompanyMembership | 4 | 1 real GM + 3 synthetic test records |
| CompanyInvitation | 1 | Status: cancelled (test invitation) |
| EditRequest | 1 | Status: cancelled (acceptance test cleanup) |
| TemporaryEditGrant | 0 | None active |
| JobRevision | 0 | None created yet |
| Notification | 2 | Acceptance test notifications |
| ActivityLog | 6 | Acceptance test log entries |
| DeletionRequest | 0 | None submitted |

---

## Company Record (Sanitized)

```json
{
  "id": "6a695715552c892bd5064008",
  "name": "Essential SOP Demo Company",
  "ownerUserId": "6a691f8c348713a104fda7a7",
  "accountType": "business",
  "subscriptionPlanCode": "contractor_plus",
  "subscriptionStatus": "prototype",
  "subscriptionSource": "prototype",
  "status": "active",
  "cancelAtPeriodEnd": false
}
```

Omitted fields (not present in v0.4): `billingCustomerId`, `billingSubscriptionId`, `trialStartedAt`, `trialEndsAt`, `currentPeriodStartedAt`, `currentPeriodEndsAt`

---

## Membership Records

### Real User
```json
{
  "id": "6a6957150976cda283143065",
  "userId": "6a691f8c348713a104fda7a7",
  "role": "general_manager",
  "status": "active",
  "isTestMembership": false
}
```

### Synthetic Test Records (NOT real users — cannot sign in)

```json
[
  {
    "id": "6a6975e7c4d75d0de8239f7a",
    "userId": "test-project-lead-user",
    "role": "project_lead",
    "status": "active",
    "isTestMembership": true,
    "testMembershipNote": "SYNTHETIC TEST RECORD — seeded for acceptance test role coverage only."
  },
  {
    "id": "6a6975e80702aa1510e20352",
    "userId": "test-project-manager-user",
    "role": "project_manager",
    "status": "active",
    "isTestMembership": true,
    "testMembershipNote": "SYNTHETIC TEST RECORD — seeded for acceptance test role coverage only."
  },
  {
    "id": "6a6975e8276f8d3d376cc72b",
    "userId": "test-technician-user",
    "role": "technician",
    "status": "active",
    "isTestMembership": true,
    "testMembershipNote": "SYNTHETIC TEST RECORD — seeded for acceptance test role coverage only."
  }
]
```

---

## Demo Job Titles (15 confirmed)

1. Exterior Door Replacement
2. (Plumbing — see database)
3–15. (Full list available via `base44.entities.Job.filter({ companyId })`)

The 15 jobs span the following trades (from demo seed data):
- Carpentry
- Plumbing
- Electrical
- HVAC
- General / Inspection

Each job has 6 visible sections (Tools, Materials, Scope, Procedure, Safety, Quality Standards).

---

## Content Distribution by Section Type

| Section Type | Item Count |
|---|---|
| tools | ~90 |
| materials | ~90 |
| scope | ~90 |
| procedure | ~135 |
| safety | ~100 |
| quality | ~110 |
| documentation (archived) | 81 |
| **Total visible** | **615** |
| **Total including archived** | **696** |

---

## Sensitive Data Omitted

The following fields were NOT exported or displayed in any backup file:

- `tokenHash` (CompanyInvitation) — stripped from all exported records
- `billingCustomerId` / `billingSubscriptionId` (Company) — stripped
- User passwords — never stored in entities (managed by Base44 auth)
- Session tokens — never stored in entities
- Secret API keys — managed via Base44 secrets panel, not in source

---

## Restoration Note

To restore data after a full reset:
1. Run Profile → Prototype Controls → Reset Demo Data (restores 15 jobs via `seedData.js`)
2. Verify counts match table above using the acceptance test suite
3. Synthetic test memberships will need to be re-seeded if lost (see `RESTORATION_GUIDE.md`)