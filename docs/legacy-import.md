# Legacy workbook import

`scripts/import-legacy-sheet.mjs` reads the old AppSheet inventory, now published as a Google
Sheet, and imports it into this project under the captain's settled rules. It maps every master
column onto the project's tables, converts the old district-based Vietnamese addresses to the
current province/commune structure, and reports what it did and what it refused.

It is dry by default: **a run writes nothing** — not to the sheet, not to Drive, and not to the
database — unless `--write` is passed with a confirmation for the exact snapshot it just read.

```bash
npm run import:legacy                       # dry run: read and report
node scripts/import-legacy-sheet.mjs --write \
  --confirm <file> --out <dir>              # import into the project
```

The report is written to `imports/legacy-dry-run/report.md` by default (with `report.json` beside
it and a `vietmap-cache.json` of resolved addresses). `imports/` is ignored by Git: the report
contains names, phone numbers and addresses.

## Inputs and access

| Input | Where it comes from |
| --- | --- |
| Spreadsheet | `1xo7w7-o9mrSQ97HZNUaeMoEN9048bDeiNS5MQvSZEis` (override with `SHEET_ID` or `--spreadsheet`) |
| Drive folder | `1_cfuMDtB0eaVXSUCk0lee61ipJO2egSb` (override with `DRIVE_FOLDER_ID` or `--folder`) |
| Service-account key | `GOOGLE_APPLICATION_CREDENTIALS`, defaulting to the approved local key path |
| VietMap token | `ACCESS_TOKEN` in `VIETMAP_TOKEN_FILE` (default `/home/sam/agent-orchestrator/config/sgn-inventory-vietmap.env`) |
| Official address reference | `https://provinces.open-api.vn`, read only |
| Database (write run) | `IMPORT_DATABASE_URL`, an administrative connection to the target project |
| Server-side Supabase (write run) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL` |
| Private bucket (write run) | `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, plus `EXPECTED_R2_BUCKET` and `EXPECTED_R2_ACCOUNT_ID` naming the bucket and account of the stage the run declares |

Google requests carry `spreadsheets.readonly` and `drive.readonly` and nothing else. The key, the
service-role key, the VietMap token and URLs containing them are never printed, logged or included
in the report. The `Login` tab is never requested at all, and a credential-shaped column
(`Password`, `Monitor`, …) is never requested either: the header row is read first, the credential
columns are identified from it, and the data request covers only the remaining column ranges, so
no cell of a password column leaves Google. The Nhân viên password columns are never read, in
either mode.

A write run also refuses to start unless `SGN_ENV` names the stage it writes and every write
target proves that stage: `IMPORT_DATABASE_URL` and `NEXT_PUBLIC_SUPABASE_URL` must name the
project of that stage, and `R2_BUCKET` and `R2_ACCOUNT_ID` must be the bucket and Cloudflare
account its `EXPECTED_R2_BUCKET` and `EXPECTED_R2_ACCOUNT_ID` name, so a same-named bucket in
another account is refused. `dev`, `development` and `local` mean the development project
(`DEV_SUPABASE_PROJECT_REF` or `EXPECTED_SUPABASE_PROJECT_REF`); `prod` and `production` mean the
production project, whose project reference, private bucket, Cloudflare account and application
URL are pinned in `scripts/legacy-import-write.mjs` (`PRODUCTION_PROJECT_REF`,
`PRODUCTION_R2_BUCKET`, `PRODUCTION_R2_ACCOUNT_ID`, `PRODUCTION_APP_URL`) rather than read from the
environment, so no environment file can relabel another project, another account's storage or
another deployment as production; the `EXPECTED_R2_*` declarations must equal the pinned bucket and
account. Both stages currently write the same private bucket in the same account, so the
production pin names that shared storage; giving production its own bucket is a code and data
change, not an environment one. The label alone is a claim, so a missing reference, a target that
names no project, a development label on the production project and a production label on any
other target all stop the run with a message naming both values, before any row, file, invitation
or account is written.

## The settled rules

- **Prices.** Sale price in billions of dong becomes whole VND (integer arithmetic, no floats);
  rent in millions. A sale price above **200 billion** is quarantined as implausible; an empty
  sale price is quarantined (unless rent is above zero, which is a rental-only row the captain
  excluded from this migration); a sale price of exactly `0` imports the property with status
  `negotiating` and no numeric price. Unreadable price text is quarantined rather than guessed,
  and each column keeps its own reason: `sale_price_unparseable` for `Giá Bán (tỷ Đồng)` and
  `rent_price_unparseable` for `Giá Thuê (triệu Đồng)`, so a row with a readable sale price is
  never reported as a sale-price problem.
- **Addresses.** VietMap's address migration API is the primary resolver and answers per address,
  so each distinct address is queried once, sequentially, with bounded retry and cached. Where it
  returns no boundary, the fallback is the published official three-tier → two-tier mapping,
  matched by city **and** district **and** ward together and then by the legacy ward's official
  code; `public.admin_unit_versions` supplies the target unit identity. A ward name alone never
  selects a commune through that reference. Each property keeps its untouched legacy address; a
  converted current address is added only where a bound was resolved. An unresolved address keeps
  the legacy row and no current province or commune, and the property needs review. The official
  reference is optional: when it cannot be reached, for the province list, one province tree or one
  ward conversion, the run degrades instead of stopping, records the failure and continues on
  VietMap and the project's own catalogue. An address whose fallback could not be consulted keeps
  its legacy row, counted as `official_reference_unavailable`, and nothing is guessed in its place.
  A district and ward pair the workbook's own ward list does not name needs no reference at all: a
  ward label that equals exactly one current commune converts from the project catalogue alone.
  The limitation and every counted row are reported.
- **Review.** Every imported property starts with `record_review_status = pending`; nothing is
  approved, verified or given a final status by the import. The listing mode comes from the row's
  own sale and rent prices, with the `Loại Hình` label as the fallback. The status comes from the
  sheet's `Tạo mới` value: a row whose value is missing or outside the vocabulary is quarantined
  as `quarantined_status_unmapped` and written nowhere, so no property is ever given a status the
  sheet did not record. The quarantine is counted by bucket, listed with its source keys and raw
  `Tạo mới` values in the report and the run summary, and never touches `public.properties`. The
  one exception is the captain's price rule: a row whose sale price is exactly `0` imports with
  status `negotiating` even when its `Tạo mới` label cannot be resolved, and that unresolved label
  is still counted, under `status_unmapped` or `status_missing` in the report's issue totals.
- **Contacts.** One contact per distinct owner identity: folded owner name, sorted normalised
  phone set, and the folded raw phone text when no mobile could be normalised. The same derivation
  decides the contact id and the `public.property_contacts` link, so two landline owners with
  different raw text never merge and a name spelling difference never splits one owner. The report
  counts only the owner rows of the properties this run would create, which is the set the write
  path links, so its distinct, rows-with-owner and shared figures name exactly those links; an
  owner whose row is quarantined is counted nowhere. A placeholder owner (`Chưa có tên`, `tìm chủ`,
  `cn` and similar) is not a person and creates no contact row; the property is still imported.
- **Child tabs.** A child row joins on an **exact** master `PropertyID` and nothing else. The
  `BDS-N` row-number hypothesis was disproved against the live sheet (0.3% owner/phone agreement),
  so a row that does not match is dropped and counted by reason. `Contracts` is dropped entirely
  (zero exact matches; every reference is a BDS id) and `clicks` is excluded by captain decision.
  Accepted `Historical` rows are kept as the private source archive in `private.staging_rows`,
  linked to their property through `private.import_entity_map`; no audit event or approval is
  invented. Accepted `Attachments` rows bring their bytes.
- **Attachments.** An attachment row is planned against the properties the run would actually
  create, so the dry run's importable count names the same set the write run uses and an
  attachment of a quarantined property is counted as `property_not_imported`, never as
  importable. For each such row the file is downloaded from the Drive `Attachments_Images`
  folder, stored in the private R2 bucket through the application's own
  upload path, and registered as the property's file. The shipped limits decide what may be
  stored (image ≤ 5 MiB, document ≤ 20 MiB, at most 10 images and 5 documents per property); a
  refusal is reported with its reason, never worked around, and a row whose property matched but
  whose bytes failed keeps its own reason (`download_failed`, `refused_by_limit` or `failed`) on
  its staging row instead of being recorded as an unmatched property. A file missing in Drive is
  reported.
- **Staff.** Every creator and editor the master tab names, plus every address in the Nhân viên
  roster, is provisioned once. The roster's position decides the company role: `TPKD` is a
  manager, `Thư ký` is staff, and `Admin` is **sales** for everyone except the captain's own
  address, which is the one admin. Everything else, including an address the roster does not
  name, is sales. The captain's address (`manager.sgnewhouse@gmail.com`) becomes an admin with no
  invitation email: its Auth user is created through the admin API and its generated password is
  written only to a private file for the captain (`/home/sam/agent-orchestrator/config/
  sgn-manager-account.env`, or `SGN_MANAGER_ACCOUNT_FILE` when the run keeps it with its own task;
  mode 0600) — never printed, never logged, never stored in the database. Every other address that
  is not already an employee receives a real invitation through the application flow
  (`begin_employee_invitation`, the provider call, then `record_employee_invitation_result`), with
  the captain's account as the actor. The provider allows 30 messages an hour, so the send loop
  waits and retries instead of failing. An invitation counts as recorded by the run only when the
  provider accepted the address and the outcome write was accepted; a refused or ambiguous provider
  attempt leaves the invitation state `provider_failed` and is listed in the report with its
  provider outcome, never counted as recorded. The report keeps the per-address list whether the
  sending phase finishes or dies partway, so a run that emailed some people and then failed still
  names each address it reached:
  `attempted` marks an address whose attempt began without a confirmed outcome, and `not_sent` one
  that was never emailed. A project-wide recorded-invitation total is labelled as project-wide, so
  a resumed run cannot present earlier invitations as its own.

## Write runs are resumable and idempotent

Every row is keyed by an identifier derived from its source key, so a second run cannot duplicate
a row: the property, its two addresses, its contact and the link are all found and left alone, and
the attachment is skipped once its file is ready. Each phase records what it did in
`private.import_batches`, `private.staging_rows`, `private.property_source_map` and
`private.import_entity_map`, so an interrupted run continues where it stopped: the rows already
promoted are not rewritten, and the plan for the remaining ones is recomputed from the source map.

Batches commit in bounded chunks (200 master rows), and every statement covers a whole chunk, so a
slow link costs seconds per chunk rather than per row.

## Rows written before the fixes

A re-run does not rewrite a promoted row, so the master rows the earlier code wrote into the
development project were audited against the sheet instead of being replaced. Of those 18,801
promoted rows, 0 carried a `status` the sheet did not record and none has a null status. Of the
8,444 owner links those rows carry, identity was rebuilt from the sheet: 8,078 distinct contacts
remain over the same 8,444 links after 7,979 wrong links and 7,592 orphaned duplicate contacts were
removed, with 0 wrong, 0 missing and 0 placeholder links, and 10,357 of those properties hold no
contact because the sheet names no usable owner. The executed counts are recorded with the run in
[testing](testing.md#executed-legacy-import-into-the-development-project-18-october-2026).

Property, address and contact rows are written over the administrative (owner) connection, which
is not subject to row level security; that is deliberate, because the import preserves each legacy
creator and editor as the row's author and the authenticated guard would rewrite it to the
importing account. Attachments go through the application's registration and completion RPCs as
the importing admin, so their limits are enforced by the database. The whole run is reported, and
no policy is disabled or weakened to make a write succeed.

## Columns with no destination

Every master column is either mapped or named in the report; the source columns and their
destinations are owned by [workbook mapping](workbook-mapping.md#property-column-transformations).
`Email Người Tạo` and `Người chỉnh sửa` are reported as blocked unless the run completed a write,
in which case they are
resolved against `public.employees` and written to `created_by` and `updated_by`. The report records
the run's outcome — `dry_run`, `refused` with its reason, `failed` with its reason, or `completed` —
and every claim in it, including that column state and the closing summary, is keyed on the outcome
rather than on the requested mode: a refused write never claims a roster it never read, and a write
that failed after committing rows says so instead of reporting itself as a read-only run.

## Tests

`scripts/import-legacy-sheet.test.mjs` covers the pure rules: money and measurement parsing, phone
preservation, date reading, ward-name normalisation, reference-label mapping, the price rule set,
the exact-key child join, placeholder owners, staff roles, the attachment plan and its drop
reasons, the confirmation gate, the credential-column exclusion in the sheet requests, and the
column inventory in both the dry-run and write-run shapes. It runs with
`npm run test:unit` and needs no network.
