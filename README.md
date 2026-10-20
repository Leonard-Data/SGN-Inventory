# SGN Inventory

One company's shared property inventory, as a Next.js application on Supabase and Vercel.

Employees search the property book, open a record and its contacts, documents and history, work the
reservation and status decisions, keep the contact, vendor and employee directories, and read their
own activity. Property file bytes are private and live in a Cloudflare R2 bucket.

The UI is Vietnamese (`vi`, the default) and English (`en`) throughout navigation, labels, forms,
validation, badges and reports. Vietnamese addresses, legal source text, phone strings, VND amounts,
m² and Vietnam business dates stay verbatim in either language — switching the interface language
never rewrites a stored record.

This package is a working inventory application, not a finished product and not a production
release. [Limitations](#limits-and-what-is-not-built) lists what is not built, deliberately out of
scope or still unverified. [docs/release-notes.md](docs/release-notes.md) records what has shipped,
newest first.

## Who uses it

Company-wide roles; there is no team or branch isolation. Every active employee (`sales`, `staff`,
`manager`, `admin`) reads the whole inventory, the vendor directory and the shared-contact
directory, and the database enforces each action below regardless of what the UI shows.

| Role               | Additionally can                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales`            | Edit only the properties they created; record activity; raise correction requests and status requests                                                                                                         |
| `staff`            | Edit any unarchived property and address; create contacts and vendor records; process correction requests                                                                                                     |
| `manager`, `admin` | Everything above, plus the manager decisions: reservation approval, sale completion, sold/rented status, duplicate-address merges, activity reports, and (admin only) employee administration and invitations |

Sign-in is by invitation: an admin records a role-bound invitation, the invitee sets their own
credentials and activates their retained employee record, with no separate approval step.

## Pages and what each one does

Routes as they exist today. `/requests`, `/rentals`, `/admin/*` and the completed-rentals ranking are
planned but not built; nothing links to them.

### Sign-in area (no app shell)

| Route            | What a user does there                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/login`         | Sign in with the recorded company address and password                                                                        |
| `/recover`       | Request a password-recovery email; `/reset-password` sets the new password from the delivered link                            |
| `/auth/invite`   | The invitee's own setup journey: read the delivered link, confirm the recorded address, set a name and password, and activate |
| `/access-denied` | The explicit denial page for a deactivated or unlinked identity                                                               |

### Inventory

| Route                | What a user does there                                                                                                                                                                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/properties`        | The inventory list: search the legacy and the current address, filter (status, listing mode, type, asking-price range, land/floor area in m², province and commune, linked contact), order by newest-created or by original entry date, and read the matching total       |
| `/properties` (view) | The same result set as cards or as a table of ten columns; the view travels in the address so switching it keeps the search, ordering and filters. The table is not offered at phone width                                                                                |
| `/properties` (row)  | Click, Enter or Space opens the row's quick view: key metadata, the status control, a comment box, one attachment through the normal upload path, and a link into the full record. Escape closes it and returns focus to the row                                          |
| `/properties/new`    | Create a property from a known address                                                                                                                                                                                                                                    |
| `/properties/[id]`   | The full record: legacy and current address, facts, map point, cover photo and private documents, contacts and vendor links, asking-price history, status trail, owner-contact disclosure, discussion, reservations, sale completion, corrections and page-view recording |

The list is one stream, not pages: it is ordered by the server and read window by window as the page
scrolls, only the rows near the viewport are mounted, and the matching count comes from the same read
that answers each window. There are no page numbers, no page size and no cursor trail
([ADR 0002](docs/adr/0002-inventory-list-stream-and-table-view.md)).

The address box narrows the catalogue page the browser already holds as a person types, so typing no
longer reads the database; the search button still searches the whole inventory
([ADR 0003](docs/adr/0003-browser-property-catalogue-and-local-address-search.md)).

### Review and decision queues

| Route                      | Who                                        | What a user does there                                                                                                                                      |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/reviews/corrections`     | all read, `staff`/`manager`/`admin` decide | Every active employee reads their own correction requests; a reviewer applies or rejects one with a reason, and amendments preserve the original submission |
| `/reviews/status-requests` | `manager`, `admin`                         | Decide the sold/rented status changes other employees requested, with a required reason; a decided case stays readable in the record's own status trail     |

Reservation requests and decisions, reservation release, and completed-sale confirmation are actions
on the property record rather than separate pages.

### People

| Route                  | Who                       | What a user does there                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/people/employees`    | `admin`                   | Browse every employee with role and access state; invite by email and role, resend a recorded invitation, edit a colleague's name, phone, role and bio, deactivate a linked employee, or permanently delete a sign-in account while the employee and their attribution are retained |
| `/people/vendors`      | all read; `staff`+ create | Browse the vendor directory and open a vendor's one optional contact block                                                                                                                                                                                                          |
| `/people/vendors/[id]` | all read; `staff`+ create | The vendor record, with the properties linked to it                                                                                                                                                                                                                                 |
| `/people/contacts`     | all                       | Browse shared contacts with their recorded per-property relationships and unarchived linked-property count, and correct a shared person's details in place                                                                                                                          |
| `/profile`             | all                       | The signed-in person's own display name and bio                                                                                                                                                                                                                                     |

An ordinary employee's own row is the only employee record they can read; the directory is admin-only
because it carries work emails and phone numbers.

### Reports

| Route                      | Who                | What a user does there                                                                                                        |
| -------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `/activity/me`             | all                | Own page views, distinct properties viewed and owner-contact accesses for one Vietnam business day, plus a chosen date range  |
| `/activity/company`        | `manager`, `admin` | Every active employee's activity by Vietnam day, with the owner-contact activity ranking over a chosen range                  |
| `/activity/provinces`      | `manager`, `admin` | Owner-contact activity grouped by the property's latest verified province, with an always-present "Unverified location" group |
| `/reports/completed-sales` | `manager`, `admin` | Completed sales grouped by credited closer over a Vietnam range, with genuinely unknown attribution counted separately        |

A page view is a detail read, not a physical visit. Owner-contact access counts one property per
employee per Vietnam day, and it is a disclosure count — not calls, owners or visits.

## Stack

Versions are the ones this repository pins in `package.json` / `package-lock.json`, not the latest
available.

| Layer              | Pinned                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime            | Node `24.14.0` (`.nvmrc`), npm `11.13.0`; Vercel runs Node `24.x`                                                                             |
| Framework          | Next.js `16.4.0` (App Router), React `19.3.0`, TypeScript `6.0.3`, plain CSS                                                                  |
| Supabase           | `@supabase/supabase-js` `2.117.3`, `@supabase/ssr` `0.12.7` (Postgres, Auth, RLS in one Postgres database)                                    |
| File bytes         | Cloudflare R2 through `@aws-sdk/client-s3` `3.1152.0` and `@aws-sdk/s3-request-presigner` `3.1152.0`                                          |
| Other runtime deps | `leaflet` `1.9.4` (property map point), `sharp` `0.35.5` and `pdf-lib` `1.17.1` (upload validation), `@vercel/analytics` `2.0.1`              |
| Tooling            | Supabase CLI `2.120.0`, Vercel CLI `63.1.2`, ESLint `9.39.5` + `eslint-config-next` `16.4.0`, Prettier `3.9.9`, Husky `9.1.7`                 |
| Tests              | `@electric-sql/pglite` `0.5.8` and `embedded-postgres` `18.4.0-beta.17` for embedded Postgres checks; Python `3.11+` for workbook preparation |
| Hosting            | Vercel, with the database, Auth and RLS on Supabase                                                                                           |

Services used, and what they are for:

- **Supabase** — Postgres (schema, RLS, guarded RPCs), Auth (sign-in, invitations, recovery) and the
  Data API. Two logical stages (`dev`, `prod`), each with its own project.
- **Cloudflare R2** — the private bucket holding property file bytes. The browser talks to R2
  directly through 60-second presigned `PUT`/`GET` links minted only after the RLS-checked
  `property_files` row is authorized, so the app server never streams file bytes. There is no
  fallback to Supabase Storage: a missing setting fails file operations closed.
- **Resend** — the SMTP path Supabase Auth uses to deliver employee invitations and password
  recovery in the configured project (`invites@sgnewhouse.online`). Resend is not an application
  dependency and the app never sends mail itself.
- **VietMap address migration API** (`https://maps.vietmap.vn`) — the primary legacy→current address
  resolver during the import, queried per distinct address and cached.
- **`https://provinces.open-api.vn`** — the published official three-tier → two-tier mapping used as
  the import's fallback when VietMap returns no boundary; the run degrades and counts unresolved rows
  rather than guessing when it is unreachable.
- **National province/commune catalog** — seeded into `public.admin_unit_versions` from the pinned
  upstream dataset recorded in [docs/sources.md](docs/sources.md), with one dated validity window per
  official name.

Server-side only (never browser code, never a `NEXT_PUBLIC_` variable): the R2 client
(`src/lib/r2.ts`), the service-role client (`src/lib/supabase/service.ts`), the
`SUPABASE_SERVICE_ROLE_KEY`, the R2 credentials, `SGN_FILE_VALIDATION_KEY`, and every table in the
`private` schema. Ordinary requests use the signed-in employee's session and the publishable key, so
they stay subject to RLS.

## Minimum configuration to run a deployment

The floor is three resources plus their settings:

1. **A Supabase project** — Postgres, Auth and RLS, with the reviewed migrations applied, open signup
   disabled, and the stage's Site URL and Redirect URLs (`<origin>/auth/callback`,
   `<origin>/auth/invite`) configured.
2. **A Vercel project** — the Next.js build, with the environment variables below.
3. **A private Cloudflare R2 bucket** — for property file bytes, with a CORS rule allowing every
   application origin and the `GET` and `PUT` methods with the `content-type` and `if-none-match`
   request headers. A bucket with the four `R2_*` values but no CORS rule fails every browser upload
   with an opaque CORS error.

Environment variables. Names only — values are secrets and belong in Vercel's environment settings,
never in the repository. A deployment must set every **Required** row.

| Variable                                                                 | Required                                                                                 | What breaks without it                                                                                                                                  |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SGN_ENV`                                                                | Yes                                                                                      | Must be `dev` or `prod`; the app refuses to resolve its environment and fails its own configuration check                                               |
| `NEXT_PUBLIC_SUPABASE_URL`                                               | Yes                                                                                      | No Supabase origin: sign-in, session and every data read fail                                                                                           |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                                   | Yes                                                                                      | No key for ordinary requests; every read fails. A service-role/secret key here is rejected instead of accepted                                          |
| `NEXT_PUBLIC_APP_URL`                                                    | Yes                                                                                      | Canonical stage origin used for redirects and recovery/invitation links; an unset or non-HTTPS value fails configuration                                |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Yes for property files                                                                   | Property file upload, open and completion fail closed with an opaque `503`; there is no Supabase Storage fallback. Set all four or none                 |
| `SGN_FILE_VALIDATION_KEY`                                                | Yes for file completion                                                                  | Server-only 64-hex key that signs the upload attestation; without it (and its matching `private.file_validation_keys` row) file completion fails closed |
| `SUPABASE_SERVICE_ROLE_KEY`                                              | Yes for invitations, deactivation, account deletion and the released-upload cleanup pass | Those provider steps and the cleanup pass stay a recorded pending/reconciliation backlog; ordinary inventory keeps working                              |
| `EXPECTED_SUPABASE_PROJECT_REF`                                          | Required for release checks, optional locally                                            | The release guard cannot prove the build targets the stage's project and stops                                                                          |

Not environment variables, but part of a working deployment: Supabase Auth email delivery (SMTP) for
invitations and recovery, and the option to switch on Vercel Web Analytics per project. Never enable
open signup or anonymous sign-in.

`npm run check:env` validates this surface without contacting Supabase and without printing values.
`/api/health` reports configuration readiness only (`200` with the stage, otherwise `503`); it proves
neither database connectivity nor authorization. See [docs/setup.md](docs/setup.md) for the full
staging, GitHub environment and activation checklist.

## Local setup and verification

```bash
nvm use                 # Node 24.14.0, npm 11.13.0
npm ci                  # installs from the lockfile and installs the commit hook
cp .env.example .env.local   # then fill in local or isolated dev values
npm run check:env       # validates configuration, prints names only
npm run dev             # http://localhost:3000
```

Checks, in increasing cost:

| Command                   | What it proves                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run check`           | Formatting, lint, types, unit tests and the embedded schema suite (`test:unit` + `test:schema`)  |
| `npm run test:schema`     | Migrations execute in embedded PostgreSQL and the authorization/business assertions pass         |
| `npm run test:import`     | Workbook preparation tests (Python)                                                              |
| `npm run build`           | The Next.js production build compiles                                                            |
| `npm run test:acceptance` | The real employee-access run; needs dev credentials and an authorized synthetic fixture manifest |

Embedded Postgres and a green health check are not real Supabase Auth/Data API/RLS/Storage
acceptance, and neither is a browser run. The real acceptance gates are in
[docs/testing.md](docs/testing.md). Conventions, source layout and the module/interface rules are in
[docs/development.md](docs/development.md).

The legacy workbook import is dry-run by default; a write run needs an explicit confirmation digest
and an administrative connection, and it is described in [docs/legacy-import.md](docs/legacy-import.md).

## Data model and where it lives

| Where                     | Holds                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/`    | The physical schema authority — 74 forward migrations. Never rewritten once deployed; a new migration is created with the pinned CLI                                                                                                                                                                                       |
| `public` schema           | The business tables the Data API exposes under explicit grants and RLS: properties, addresses, contacts and links, files, vendors, comments, history, status trail, reservations and locks, sale completions, rentals, employees and invitations, corrections, activity events, and the seeded administrative-unit catalog |
| `private` schema          | Privileged internals with no client grants: the audit trail, the import staging tables and source maps (the staging rows themselves are pruned — see below), file-validation keys, invitation proofs, and the guarded business functions the public invoker RPCs wrap                                                      |
| Cloudflare R2             | The file bytes, keyed `<property uuid>/<file uuid>/content`, read only through short-lived presigned links after the `property_files` row is authorized                                                                                                                                                                    |
| Supabase Storage (legacy) | The retired property-files bucket; `scripts/copy-property-files-to-r2.mjs` copies from it, deletes nothing, and has not been run against a hosted project                                                                                                                                                                  |

The authoritative read contract for the application and for coding agents is
[docs/database-contract.md](docs/database-contract.md); the domain vocabulary is
[CONTEXT.md](CONTEXT.md).

## Storage and database use

These are measurements and recorded figures, not projections. No growth forecast is offered.

### Files in R2

Measured on 20 October 2026 by listing the configured private bucket, read-only, with the AWS SDK from
this repository (`ListObjectsV2`, paginated):

```
bucket: sgn
objects: 2220
total bytes: 615777125
total MiB: 587.3
key shapes: <property uuid>/<file uuid>/content — 2220 objects
distinct property prefixes: 1034
largest object: 2041894 bytes
```

Re-measure by running a paginated `ListObjectsV2` over `R2_BUCKET` with the four `R2_*` values in the
shell — the same client the application builds in `src/lib/r2.ts`, used read-only. Listing objects
costs a small number of Class A operations and changes nothing.

Both stages currently share that one bucket in one Cloudflare account (see
[.env.prod.example](.env.prod.example)), so this total covers the production import's attachments and
the dev stage's files together. The production import accounts for 2,220 ready files over 1,034
properties; the bucket total matching that count exactly is what the measurement confirms.

### Database

**Measured on the production project by the operator on 20 October 2026** and relayed to this
documentation change; the imported row counts are the production import's own read-back of
19 October 2026. This repository copy holds no database credentials, and the Data API refuses an
unauthenticated read (`401`, `42501`) by design, so no figure below was re-measured here — the
queries are given so an operator with an owner connection can re-measure rather than trust a figure
that ages.

| Table                         | Rows (production, 20 October 2026) | Notes                                                                                                 |
| ----------------------------- | ---------------------------------: | ----------------------------------------------------------------------------------------------------- |
| `public.properties`           |                             18,801 | All imported `record_review_status = pending`                                                         |
| `public.property_addresses`   |                             37,311 | 18,801 untouched legacy addresses + 18,510 converted current                                          |
| `public.contacts`             |                              8,078 | Distinct owner identities; 10,357 properties name no owner                                            |
| `public.property_contacts`    |                              8,444 | Recorded owner links                                                                                  |
| `public.property_files`       |                              2,220 | `upload_status = 'ready'`, bytes in R2                                                                |
| `public.employees`            |                                 35 | 3 admin, 2 manager, 2 staff, 28 sales                                                                 |
| `public.employee_invitations` |                                 33 | All `state = recorded`                                                                                |
| `private.staging_rows`        |                                  0 | **Pruned 20 October 2026**: was 41,484 rows / 68 MB, now 16 kB. Archived outside the database (below) |
| `private.import_entity_map`   |                                  0 | **Pruned with it**: was 39,608 rows / 7.7 MB, now 16 kB                                               |
| `private.property_source_map` |                             18,801 | Kept: 5.2 MB. One row per imported property, tracing it to its workbook row                           |
| `private.audit_events`        |                             85,681 | **The largest table: 82 MB.** The audit trail for every guarded write                                 |

**Total production database size: 154 MB**, down from 229 MB — the staging prune reclaimed 75 MB.
The largest table is now `private.audit_events` at 82 MB over 85,681 rows, and it is the one to watch:
its 90-day retention trim is defined but **not scheduled**, because the project has no scheduler, so
the trail currently grows without a ceiling until an operator runs the trim in a maintenance window.
On the development project, `private.audit_events` measured 7,568 KB within a 25 MB database total
as an operator-supplied before figure; a production per-table size breakdown has to be taken on the
production project itself.

The staging rows were archived before deletion rather than discarded:
`data/sgn-legacy-import-run/staging-rows-archive.ndjson.gz` holds all 41,484 rows — 4.1 MiB gzipped
(44.4 MB uncompressed), read back line by line when it was written. The archive carries more than the
`Historical` sheet the import reported (its own records name the `attachments` sheet too), which is
why the table's row count is larger than that read-back. That file is private to the operator's
machine and lives outside this repository, so its path is named here rather than linked.

The bulk of the database is now the **private audit trail**, which records an actor, time and
before/after values for every guarded write, so it grows with editing rather than with inventory —
82 MB of the 154 MB, with no ceiling in place today. The **import staging rows** and the provenance
map that pointed at them were the largest single consumers until the prune above; removing them
changed no application behaviour, because the application never reads them. The property-to-source-key
map was deliberately kept (18,801 rows, 5.2 MB), so every imported property stays traceable to its
workbook row. The business tables are small: 18.8k properties with their addresses and links.

Re-measure with an owner (privileged) connection — these are read-only:

```sql
-- Total database size
select pg_size_pretty(pg_database_size(current_database())) as database_size;

-- Largest tables, including indexes and TOAST
select n.nspname as schema,
       c.relname as table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) as total,
       pg_total_relation_size(c.oid) as total_bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'm', 'p')
  and n.nspname in ('public', 'private')
order by total_bytes desc
limit 15;

-- Row counts of the main tables
select 'properties' as table_name, count(*) from public.properties
union all select 'property_addresses', count(*) from public.property_addresses
union all select 'contacts', count(*) from public.contacts
union all select 'property_contacts', count(*) from public.property_contacts
union all select 'property_files', count(*) from public.property_files
union all select 'employees', count(*) from public.employees
union all select 'employee_invitations', count(*) from public.employee_invitations
union all select 'private.staging_rows', count(*) from private.staging_rows
union all select 'private.import_entity_map', count(*) from private.import_entity_map
union all select 'private.property_source_map', count(*) from private.property_source_map
union all select 'private.audit_events', count(*) from private.audit_events
order by table_name;

-- One table on its own, the retention measurement
select pg_size_pretty(pg_total_relation_size('private.audit_events')) as audit_events_size;
```

The audit trail is trimmed only by an operator running `select private.trim_audit_events();` from a
privileged session in a maintenance window — the trim exists but is **not scheduled**, so nothing
bounds the trail's growth today, and running it is a destructive action that needs its own
authorization ([docs/database-contract.md](docs/database-contract.md#private-audit-trail-retention)).

## Limits and what is not built

**Not built.** `/requests` (the employee's own request list), `/rentals` and its agreement/month/
receipt pages, `/admin/categories`, `/admin/units`, the completed-rentals ranking, and the company
report's remaining panels. Admin row actions that activate an employee directly are unshipped; a role
change ships through the guarded profile edit. The change timeline and the fictional-fixture design
review live only in `/design/app-preview`.

**Deliberately out of scope.** Commission calculation, payouts, payment-gateway integration and
general accounting. AI matching, maps beyond the single property map point, external notifications
and multi-tenancy. Physical-visit submission and confirmation are retired in favour of automatically
recorded owner-contact access.

**Honest gaps and unverified things.**

- A browser-driven acceptance run cannot happen on a machine without Chrome and the agent browser
  CLI; several real-browser gates are still outstanding for that reason.
- The quick-upload round trip inside the row quick view cannot complete without R2 configured, and
  file completion additionally needs `SGN_FILE_VALIDATION_KEY` matching its private database row.
- Property change history is price-only **by contract**: only recorded asking-price changes add rows
  there. Non-price changes are attributed in the private audit trail instead, which has its own
  90-day retention window, so it is not a permanent record. Status changes have their own retained
  trail beside the price history. Vendor link and unlink likewise write no property-history row.
- Vendor records are read-only: the vendor-edit ticket was put on hold because its acceptance
  criteria conflicted with the price-only property-history rule, so no vendor edit surface exists.
- The legacy import's `Contracts` tab contributed nothing: it shares no key with the master sheet
  (every reference is a `BDS` id), so those rows were dropped and counted rather than guessed.
  `clicks` was excluded by captain decision.
- Address conversion is partial: 291 imported properties (of 18,801) keep a legacy address only and
  need review, and one production run recorded 266 rows whose official reference could not be
  consulted at all. Nothing was inferred to fill those gaps.
- The production database figures are the operator's measurements of 20 October 2026, not this
  machine's: this copy holds no database credentials. The queries above reproduce them.
- Real Supabase RLS/Data API/Storage verification and staging acceptance must run on a hosted project
  before production; embedded Postgres and unit tests do not replace it.
- Employee invitations and password recovery depend on the project's SMTP sender and its Redirect
  URLs allow list. A delivered invitation link lands on the Site URL instead of `/auth/invite` until
  the application origin is added to that allow list, and the acceptance journey can only recover the
  delivered session from the provider's own redirect chain meanwhile.

## Where to read next

| Document                                                                           | For                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [CONTEXT.md](CONTEXT.md)                                                           | The domain vocabulary — the exact meaning of every term used |
| [docs/release-notes.md](docs/release-notes.md)                                     | What has shipped, newest first, and why it matters           |
| [docs/architecture.md](docs/architecture.md)                                       | Components, boundaries and architecture decisions            |
| [docs/database-contract.md](docs/database-contract.md)                             | The application/coding-agent API contract                    |
| [docs/schema.md](docs/schema.md), [docs/migration-plan.md](docs/migration-plan.md) | Tables, indexes and migration order                          |
| [docs/setup.md](docs/setup.md), [docs/development.md](docs/development.md)         | Local setup, delivery, conventions                           |
| [docs/testing.md](docs/testing.md)                                                 | Every acceptance gate and what it does not prove             |
| [docs/legacy-import.md](docs/legacy-import.md)                                     | The workbook import rules, inputs and write path             |
| [docs/workflows-security.md](docs/workflows-security.md)                           | Role matrix, reservation lifecycle and file security         |
| [AGENTS.md](AGENTS.md), [CLAUDE.md](CLAUDE.md)                                     | Instructions for coding agents                               |
