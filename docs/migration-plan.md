# Migration and cutover plan

## Delivery boundary

The schema migrations and preparation tool are executable. Rental/localization extension is in migration 4; existing data has no reliable tenancy terms or payment history, so these require new user input. Destination promotion ETL, official address catalogs, source attachment retrieval, real Auth onboarding, UI and production cutover remain implementation work. GitHub addition was approved on 10 October 2026 and is blocked only by missing repository write access. No live Supabase or Vercel resource has been changed.

## Phase 1 — Review and environment setup

1. Approve the repository package and business defaults (single company, shared contacts, company-wide reviewers, 48h pending/7-day approved term).
2. Add the approved package to the repository. Pin Next.js/React/SSR dependencies and generate the app in the planned structure. Use the Node runtime supported by current Supabase libraries (22+).
3. Create isolated staging and production projects. Validate a fresh database locally first. Set only `public` as exposed schema, private legal/photos bucket, Auth allowed URLs and invite-only access.
4. Bootstrap at least two reviewers and one admin using reviewed identities. Don't import workbook passwords. Test role/deactivation paths with fixture users.

Acceptance: schema and RLS verified on real staging Supabase; no staging preview connects to production.

## Phase 2 — Source inventory and secure preparation

1. Keep the workbook in a private source location and record its SHA-256. The delivered profile identifies the inspected version.
2. Run `prepare_workbook.py` without `--stage` to reproduce counts and issues. It does not modify the workbook.
3. Create a private staging run with `--stage`. Exclude Login and password fields. Record operator, preparation timestamp and the timezone assumption.
4. Retrieve original AppSheet file storage and a reliable old-property-key export. The workbook alone is insufficient for all contacts/files.
5. Assign every staging row a disposition: pending, promoted, quarantined or explicitly ignored with a reason. Do not equate “quarantined” with “deleted”.

Acceptance: every nonempty source row accounted for; credentials absent; raw files and records excluded from Git.

## Phase 3 — Identity, employees and catalogs

1. Resolve the 23 missing property IDs and the one duplicated nonblank ID before affected rows are promoted. Give each confirmed real property a canonical UUID and a human-readable unique SGN code.
2. Populate `private.property_source_map` for every reviewed source key and alias. Do not reuse a duplicated source key for two properties; use batch/sheet/row-specific reviewed keys until ambiguity is resolved.
3. Review the 17 employee rows, normalize emails, verify unique identity, propose roles from the source labels, and leave them inactive until invitations are accepted and Auth account IDs are linked.
4. Build the official HCMC legacy/current unit catalog with source dates and links; validate code strings, parents, overlapping validity and subsequent policy updates. Review crosswalks and identify whole vs partial transitions.

Acceptance: unresolved mappings remain isolated; no row-number-based aliases; employee authority is explicitly reviewed.

## Phase 4 — Transform and promote into staging database

Promotion order: employees → catalogs/crosswalks → properties → addresses → contacts/links → files → legacy page-view events. Legacy history remains in private staging/archive. Start with a representative sample including a duplicated-ID case, old district addresses, multi-phone owners, rent and sold records.

For each accepted record:

1. Apply reviewed typed transformations (whole VND, positive m²/metres, direction codes, mode/type/access/state).
2. Insert/update canonical property via the reviewed source map; do not derive a commission lock from Approved/sold/negotiating fields.
3. Save untouched legacy address and raw labels. Add current address only as a documented candidate; verify it through the reviewer workflow.
4. Create separate contacts or links using approved identity evidence. Never merge masked phone IDs or generic owner names globally.
5. Register and transfer attachment bytes under immutable private paths. Confirm binary hash/size and correct property; ready status follows successful upload.
6. Import resolvable clicks as `page_view` with legacy source and correct Vietnam timestamp. Never infer physical visits. Keep unresolved employee/property events quarantined.
7. Commit destination writes and `private.import_entity_map` updates atomically. Roll back the whole unit on failure and retain a safe error code and row reference.

The staging JSONL is an interchange format. A loader must store the raw sanitized source plus `normalized_candidate` inside `staging_rows.payload`, map `issues` and `source_row`, and insert the deterministic `batch_id` into `import_batches` first. Do not attempt an unfiltered JSONL COPY into the table; its shape intentionally includes preparation-only fields. Implement the loader with parameterized SQL or `COPY` via a documented adapter, using an administrative import connection outside the app.

Acceptance: representative sample reconciles, contacts/files match confirmed properties, and no fabricated reservations/visits exist.

## Phase 5 — Reconciliation and user acceptance

| Gate | Required comparison |
| --- | --- |
| Rows | Per sheet: source = promoted + quarantined + ignored; pending must be zero for cutover disposition |
| Properties | 19,233 source rows explained; canonical count is determined by reviewed identity, not assumed equal |
| Contacts | All 20,480 Contracts rows have reviewed linkage or explicit quarantine; embedded owner contacts separately reconciled |
| Files | 2,544 attachment metadata rows accounted for; downloaded/uploaded/missing/hash-conflict counts separate |
| History | 19,151 legacy records retained or explicitly excluded by approved retention decision |
| Activity | 56,932 click rows accounted for; none counted as site visits |
| Prices | Canonical VND equals reviewed source decimal × proper multiplier; spot-check blanks, zero, comma decimals and malformed strings |
| Addresses | Legacy strings retained; every verified current address has dated catalog IDs and property-level verification |
| Authorization | Anonymous/inactive denied; self approval denied; direct lock/activity writes denied; manager/admin analytics restricted |
| Contention | Two independent database sessions approve competing requests; exactly one succeeds |

Sales users test actual address searches, owner contact lookup, document access, visit submission and reservation request. Reviewers test independent decisions, expiry, release and dashboard reconciliation. Admins test invitations and deactivation. Confirm clear Vietnamese labels for draft, legacy, unresolved and reserved states.

## Phase 6 — Final snapshot and cutover

1. Announce a short source write freeze and export a final checksum-stamped workbook, alias data and file manifest.
2. Do not promote multiple changing snapshots using row position as identity. Re-run review against the final snapshot; use canonical reviewed keys. Freeze one approved final batch for idempotent retries.
3. Back up the destination and preserve the read-only source. Perform the final promotion with transaction-sized batches and the same reviewed mapping rules.
4. Run reconciliation and real Supabase acceptance checks. Configure production URLs/Auth redirects and deploy the approved Next.js release.
5. Open the application to staff; keep AppSheet read-only during the agreed stabilization period. Record the first production write timestamp.

Acceptance: no pending migration dispositions, zero unexplained count differences, critical security and concurrency checks pass, all ready-file metadata has bytes.

## Phase 7 — Rollback and stabilization

Before production user writes, rollback can restore the preimport backup or remove the imported batch by reviewed entity map in dependency order. Do not use destructive resets in production. After production writes, do not restore an old snapshot and lose new records: freeze writes, export postcutover property/visit/lock/file changes, assess the incident, and reconcile them into the recovery system before reopening.

Use a forward migration to fix schema defects where possible. A UI rollback can keep the current schema if compatible; assess contract differences first. Keep the source read-only until reconciliation and ownership transfer are signed off.

## Idempotency and audit

The workbook SHA uniquely identifies an import batch. `(batch,sheet,row)` uniquely stages the same snapshot; `(batch,sheet,row,entity_table)` tracks promoted entity IDs. Reviewed source aliases preserve canonical property identity. Re-running the **same** snapshot must not duplicate entities. A changed snapshot needs a new reconciliation run; these mappings alone do not implement a safe continuous sync.

For legacy activity, derive a retry key from a verified unique event identity plus source system, not a fresh random UUID or current batch number. For ambiguous/repeated source IDs, resolve identity before loading. Existing audit records should describe the new import action; source historical edits remain source history, not spoofed authenticated decisions.

## Separate authorization gates

User approval to add these files to GitHub does not automatically authorize production import or deployment. Prepare a concrete reviewed migration report and release before asking for their cutover authorization. Routine local validation and staging implementation may proceed within the approved development scope.
