# Migration and cutover plan

## Delivery boundary

The schema migrations and preparation tool are executable. Rental/localization extension is in migration 4; existing data has no reliable tenancy terms or payment history, so these require new user input. Destination promotion ETL, HCMC legacy/current address crosswalks, real Auth onboarding, UI and production cutover remain implementation work. The national two-tier province/commune catalog is already seeded (Phase 3). GitHub addition was approved on 10 October 2026, and the remote now holds `main`. The authorized development project already holds the executed legacy import ([legacy import](legacy-import.md)); staging provisioning, production cutover and Vercel delivery are unchanged.

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
4. Retrieve the original file storage. The `Attachments_Images` Drive folder supplies the bytes; the workbook alone is insufficient. No old-property-key export is needed, because child rows join on an exact `PropertyID` and `Contracts` is dropped.
5. Assign every staging row a disposition: pending, promoted, quarantined or explicitly ignored with a reason. Do not equate “quarantined” with “deleted”.

Acceptance: every nonempty source row accounted for; credentials absent; raw files and records excluded from Git.

## Phase 3 — Identity, employees and catalogs

1. Resolve the 23 missing property IDs and the one duplicated nonblank ID before affected rows are promoted. Give each confirmed real property a canonical UUID and a human-readable unique SGN code.
2. Populate `private.property_source_map` for every reviewed source key and alias. Do not reuse a duplicated source key for two properties; use batch/sheet/row-specific reviewed keys until ambiguity is resolved.
3. Review the 17 employee rows, normalize emails, verify unique identity, propose roles from the source labels, and leave them inactive until invitations are accepted and Auth account IDs are linked.
4. The national two-tier province/commune catalog is seeded by `20261014075435_vietnamese_admin_units_reference.sql` from the pinned upstream releases (34 provinces/cities, 3321 wards/communes/special regions, official codes and parent links): the 2025-07-01 baseline window carries pre-rename names, and the dated 2026-04-30 Đồng Nai, 2026-09-01 Quảng Ninh and 2026-09-20 Bắc Ninh windows carry the renamed city and promoted ward names, each with one half-open validity window. Remaining here: build and review the HCMC legacy/current crosswalks with source dates and links (the pre-2025 three-tier catalog is seeded by `20261021060602_legacy_admin_units_reference.sql`; no blanket mapping is seeded); validate code strings, parents, overlapping validity and subsequent policy updates, and identify whole vs partial transitions.

Acceptance: unresolved mappings remain isolated; no row-number-based aliases; employee authority is explicitly reviewed.

## Phase 4 — Transform and promote into staging database

Promotion order: employees → catalogs/crosswalks → properties → addresses → contacts/links → files. No source view records are promoted: the `clicks` tab is excluded by captain decision, and the settled source dispositions are in [legacy import](legacy-import.md#the-settled-rules). Legacy history remains in private staging/archive. Start with a representative sample including a duplicated-ID case, old district addresses, multi-phone owners, rent and sold records.

For each accepted record:

1. Apply reviewed typed transformations (whole VND, positive m²/metres, direction codes, mode/type/access/state).
2. Insert/update canonical property via the reviewed source map; do not derive a commission lock from Approved/sold/negotiating fields.
3. Save untouched legacy address and raw labels. Add current address only as a documented candidate; verify it through the reviewer workflow.
4. Create separate contacts or links using approved identity evidence. Never merge masked phone IDs or generic owner names globally.
5. Register and transfer attachment bytes under immutable private paths. Confirm binary hash/size and correct property; ready status follows successful upload.
6. Commit destination writes and `private.import_entity_map` updates atomically. Roll back the whole unit on failure and retain a safe error code and row reference.

The executed import of this migration is `scripts/import-legacy-sheet.mjs`, which reads the live Google Sheet and writes through the documented RPCs ([legacy import](legacy-import.md)). The staging JSONL below is the interchange format of the workbook-preparation route: a loader must store the raw sanitized source plus `normalized_candidate` inside `staging_rows.payload`, map `issues` and `source_row`, and insert the deterministic `batch_id` into `import_batches` first. Do not attempt an unfiltered JSONL COPY into the table; its shape intentionally includes preparation-only fields. Implement the loader with parameterized SQL or `COPY` via a documented adapter, using an administrative import connection outside the app.

Acceptance: representative sample reconciles, contacts/files match confirmed properties, and no fabricated reservations/visits exist.

## Phase 5 — Reconciliation and user acceptance

Counts below are the workbook profile in [workbook mapping](workbook-mapping.md); the executed run against the live sheet records its own counts in [testing](testing.md).

| Gate | Required comparison |
| --- | --- |
| Rows | Per sheet: source = promoted + quarantined + ignored; pending must be zero for cutover disposition |
| Properties | 19,233 source rows explained; canonical count is determined by reviewed identity, not assumed equal |
| Contacts | Embedded owner contacts reconciled to promoted properties; `Contracts` is dropped by captain decision, so none of its rows is promoted or quarantined |
| Files | 2,544 attachment metadata rows accounted for; downloaded/uploaded/missing/hash-conflict counts separate |
| History | 19,151 legacy records retained or explicitly excluded by approved retention decision |
| Activity | No source view records imported (`clicks` excluded by captain decision); none counted as site visits |
| Prices | Canonical VND equals reviewed source decimal × proper multiplier; spot-check blanks, zero, comma decimals and malformed strings |
| Addresses | Legacy strings retained; every verified current address has dated catalog IDs and property-level verification |
| Authorization | Anonymous/inactive denied; self approval denied; direct lock/activity writes denied; manager/admin analytics restricted |
| Contention | Two independent database sessions approve competing requests; exactly one succeeds |

Sales users test actual address searches, owner contact lookup, owner-contact disclosure, document access and reservation request. Reviewers test independent decisions, expiry, release and dashboard reconciliation. Admins test invitations and deactivation. Confirm clear Vietnamese labels for draft, legacy, unresolved and reserved states.

## Phase 6 — Final snapshot and cutover

1. Announce a short source write freeze and export a final checksum-stamped workbook, alias data and file manifest.
2. Do not promote multiple changing snapshots using row position as identity. Re-run review against the final snapshot; use canonical reviewed keys. Freeze one approved final batch for idempotent retries.
3. Back up the destination and preserve the read-only source. Perform the final promotion with transaction-sized batches and the same reviewed mapping rules.
4. Run reconciliation and real Supabase acceptance checks. Configure production URLs/Auth redirects and deploy the approved Next.js release.
5. Open the application to staff; keep AppSheet read-only during the agreed stabilization period. Record the first production write timestamp.

Acceptance: no pending migration dispositions, zero unexplained count differences, critical security and concurrency checks pass, all ready-file metadata has bytes.

## Phase 7 — Rollback and stabilization

Before production user writes, rollback can restore the preimport backup or remove the imported batch by reviewed entity map in dependency order. Do not use destructive resets in production. After production writes, do not restore an old snapshot and lose new records: freeze writes, export postcutover property/lock/file changes, assess the incident, and reconcile them into the recovery system before reopening.

Use a forward migration to fix schema defects where possible. A UI rollback can keep the current schema if compatible; assess contract differences first. Keep the source read-only until reconciliation and ownership transfer are signed off.

## Idempotency and audit

The workbook SHA uniquely identifies an import batch. `(batch,sheet,row)` uniquely stages the same snapshot; `(batch,sheet,row,entity_table)` tracks promoted entity IDs. Reviewed source aliases preserve canonical property identity. Re-running the **same** snapshot must not duplicate entities. A changed snapshot needs a new reconciliation run; these mappings alone do not implement a safe continuous sync.

For legacy activity, derive a retry key from a verified unique event identity plus source system, not a fresh random UUID or current batch number. For ambiguous/repeated source IDs, resolve identity before loading. Existing audit records should describe the new import action; source historical edits remain source history, not spoofed authenticated decisions.

## Separate authorization gates

User approval to add these files to GitHub does not automatically authorize production import or deployment. Prepare a concrete reviewed migration report and release before asking for their cutover authorization. Routine local validation and staging implementation may proceed within the approved development scope.
