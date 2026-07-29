# Base44 Support — Restore Request Template

Copy and send this message to Base44 support when you need to restore the application to the v0.4.0 Phase 4 milestone.

---

**Subject:**  
Restore Essential SOP to v0.4.0 Phase 4 milestone

---

**Application:**  
Essential SOP

**Requested version:**  
v0.4.0

**Milestone:**  
Phase 4 Foundation Complete

**Source identifier (git commit hash):**  
0ebe53c39ea2f2811669bfae291e13f07ab9d0f8

**Milestone timestamp (UTC):**  
2026-07-29T04:01:21.306Z

**Acceptance result at this milestone:**  
25 PASS  
2 Expected Security Rejections  
0 Failures

---

**Requested action:**

Please restore the application code, backend functions, entity schemas, routes, and configuration to the recorded Phase 4 source version identified by commit hash `0ebe53c39ea2f2811669bfae291e13f07ab9d0f8`, without altering production data unless explicitly requested.

---

**Important notes:**

- Preserve all company data (Jobs, Sections, SectionContent, CompanyMembership, etc.)
- Preserve all authentication records and user accounts
- Preserve all environment variable names — do not expose secret values
- Do NOT trigger any emails, billing charges, or push notifications as part of the restore
- Confirm the exact restore point (commit hash and timestamp) before applying any changes
- Provide a rollback option for the restore itself before committing it
- The subscriptionStatus on the Company record must remain `prototype` — do not activate live billing

---

**What to restore:**

1. Frontend source (`src/`)
2. Backend functions (`base44/functions/`)
3. Shared backend utilities (`base44/shared/`)
4. Entity schemas (`base44/entities/`)
5. App configuration (`tailwind.config.js`, `src/index.css`, `vite.config.js`, `package.json`)
6. Documentation backup (`src/docs/v0.4/`)
7. Route definitions (`src/App.jsx`)

---

**What NOT to restore (preserve current state):**

- Live database records (Jobs, memberships, user accounts) — preserve unless data is also corrupted
- Environment variable values — restore names only; values must be re-entered by the account owner
- Any Phase 5 data that was added after this milestone (if applicable)

---

**After restore, verification steps:**

1. Confirm application loads without error
2. Confirm all 15 demo Jobs are present
3. Confirm each Job shows exactly 6 sections (Tools, Materials, Scope, Procedure, Safety, Quality Standards)
4. Confirm Documentation is excluded from all UI paths
5. Confirm the Phase 4 acceptance suite returns 25 PASS / 0 FAIL
6. Confirm the General Manager safeguard blocks last-GM removal
7. Confirm company isolation is intact

---

**Reference documents (inside the restored repository):**

- `src/docs/v0.4/BACKUP_MANIFEST.md`
- `src/docs/v0.4/RESTORATION_GUIDE.md`
- `src/docs/v0.4/PHASE4_ACCEPTANCE_RESULTS.md`
- `src/docs/v0.4/DATA_EXPORT_SUMMARY.md