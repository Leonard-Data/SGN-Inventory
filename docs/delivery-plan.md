# Next.js implementation and release plan

## Scope and approval record

Replace the AppSheet/Google Sheets inventory profiled on 10 October 2026 with one Next.js App Router/TypeScript application, one Supabase Postgres database and Vercel hosting. Earlier Reflex/Cloudflare proposals are superseded. The company shares inventory and internal contacts; managers review company-wide, without branch/team isolation. Roles are sales, staff, manager and admin. See the domain glossary in [CONTEXT.md](../CONTEXT.md), the broader [architecture](architecture.md), [workbook findings](workbook-mapping.md) and [database contract](database-contract.md).

VI/EN localization and rental agreement/month/manual receipt/refund handling were made mandatory on 10 October 2026. They remain broader MVP requirements even where the first employee-access slice excludes their management screens. The scoped employee-access UI and user-session data path are implemented; reviewed promotion ETL, broader workflow UI and full staging acceptance remain planned. Active, inactive and unlinked delivered email/password recovery have passed against the authorized development environment; the dedicated synthetic fixture was restored.

GitHub publication of the initial package to <https://github.com/Leonard-Data/SGN-Inventory> was approved on 10 October 2026. The remote now contains `main` and the connected account has repository write access. Engineering setup does not itself authorize Supabase/Vercel provisioning, customer-data import or cloud deployment. Raw workbooks, customer records and secrets remain excluded.

## Planned application structure

The database and engineering foundation plus issue #1 employee-access routes are implemented: login, protected browse/search/details, local logout, persisted VI/EN preference and real Supabase recovery endpoints. The following table is the broader target layout, not evidence that every listed workflow exists. See [development.md](development.md) for the actual source tree and [testing.md](testing.md#confirmed-employee-access-slice-acceptance) for scoped development evidence and the incomplete real-mailbox gate.

| Path | Responsibility |
| --- | --- |
| `src/app/(auth)/login/page.tsx` | Login and invitation/recovery flow |
| `src/app/(app)/properties/page.tsx` | Inventory search/filter/page |
| `src/app/(app)/properties/[id]/page.tsx` | Property details, contacts, files, reservation banner |
| `src/app/(app)/activity/page.tsx` | Own daily activity: page views, distinct properties viewed and owner-contact access |
| `src/app/(app)/reservations/page.tsx` | Own requests and effective locks |
| `src/app/(app)/rentals/page.tsx` | Tenancy/occupancy inventory with VI/EN labels |
| `src/app/(app)/rentals/[id]/page.tsx` | Agreement details; staff/reviewer monthly dues and payment review |
| `src/app/(app)/reviews/page.tsx` | Independent reservation/file review queue |
| `src/app/(app)/admin/employees/page.tsx` | Guarded user management |
| `src/app/(app)/admin/analytics/page.tsx` | Area and employee dashboards |
| `src/lib/supabase/client.ts` | Browser publishable-key client |
| `src/lib/supabase/server.ts` | Request/cookie-scoped server client |
| `src/lib/supabase/proxy.ts` | Session refresh/verification support using current official SSR conventions |
| `src/features/properties/` | Search, form validation, detail queries and mutations |
| `src/features/addresses/` | Versioned unit selectors and mapping review |
| `src/features/reservations/` | RPC calls, state badges and decision forms |
| `src/features/activity/` | Idempotent event capture and own daily activity report (page views, distinct properties, owner-contact access) |
| `src/features/files/` | Metadata registration, upload, completion and signed download |
| `src/features/employees/` | Invite/link/deactivate with reviewed roles |
| `src/features/rentals/` | Agreement lifecycle, monthly occupancy/dues and reviewed manual receipts/refunds |
| `src/components/` | Shared input, table, status, dialog and navigation components |
| `src/i18n/vi.ts` and `src/i18n/en.ts` | Complete equivalent dictionaries, validated key parity and localized messages |
| `src/types/database.ts` | Generated Supabase types; do not edit manually |

Keep Server Actions narrow and input-validated. Reuse user-scoped data clients inside feature Modules, separate from rendering. Keep each Interface small; do not add generic pass-through Modules or a parallel unrestricted CRUD interface for Supabase tables.

## Implementation backlog

| Order | Deliverable | Acceptance criteria |
| --- | --- | --- |
| 1 | Local/staging DB and Auth foundation | Migrations apply on real Supabase; reviewed users can log in; inactive/unlinked users denied |
| 2 | Responsive inventory and property detail | Vietnamese accent/legacy/current search; clear mode/type/access; 30-row pages; contact/file cards |
| 3 | Property/contact/address maintenance and correction requests | Role-scoped immediate saves; property history; preserved legacy input; optional address verification; stale-edit rejection; no maintenance approval |
| 4 | Private file protocol | Register → upload → confirm → signed read; interrupted upload recovery; no public legal links |
| 5 | Approval-based reservations | Independent approval; duplicate/competing requests handled clearly; expiry and release reflected immediately |
| 6 | Activity and review | Detail opens are page views; a deliberate owner-contact disclosure counts one property per employee/Vietnam day; physical-visit submission is retired |
| 7 | Employee management and analytics | Last-admin protected invitation/role/deactivation action; zero-day reports; verified/unresolved area split |
| 7a | Bilingual interface and language preference | Full VI/EN dictionary parity and switching; VND, Vietnamese addresses and Vietnam calendar retained |
| 7b | Rental management | Draft/independent activation/end/cancel; active months; confirmed partial/full receipts, overdue and refund balances |
| 8 | Reviewed import ETL | Parameterized staging loader and promotion; identity reconciliation; correct contacts/files; same-snapshot retry |
| 9 | Acceptance and release | Real RLS/Storage, competing-session test, browser flow, reconciliation and recovery rehearsal pass |

Build auth + inventory first, then reservations and activity, then analytics and complete import. Use sanitized representative fixtures during UI development, not the raw customer workbook in previews.

## Confirmed property, contact and address maintenance plan

The user confirmed this assembled maintenance plan on 10 October 2026, including requester-only request history and the authorized staff processing queue. Issue #7 implements the journey below in source; hosted staging/browser acceptance, provisioning, import and deployment remain separate authorizations. See [maintenance-contract.md](maintenance-contract.md) for the implemented contract.

### End-to-end journey

1. A linked, active employee creates a property with a listing mode and at least one nonblank known address. Assign a stable unique property code and commit the property, initial address and change history together. Preserve existing/imported codes. Unknown prices, dimensions, classifications and contacts remain unknown.
2. Sales may edit their own unarchived property/address; staff/manager/admin may edit shared unarchived inventory. Save authorized changes immediately and refresh affected search/detail data. No record approval, publication versions or maintenance-review queue.
3. Staff/manager/admin create/correct shared contacts, maintain relationship/primary markers and remove mistaken links. Keep at most one primary contact per property. Show affected properties before a shared-contact save; the same person's correction appears on all linked properties and in each affected property's history. A wrong-person link is replaced locally, not by overwriting the shared person. No merging or hard deletion.
4. Any active employee submits a structured correction issue for any unarchived property, with replacement values optional. The requester tracks their own requests; authorized staff process the company queue. Submitters gain no edit authority. Staff/manager/admin apply and resolve within their existing edit permissions, or reject with a reason; the requester may withdraw an open request. No second reviewer or requester confirmation.
5. Use `open → applied`, `open → rejected` and `open → withdrawn`. Preserve original submissions and amendments. Atomically apply the correction, record actual changes and close the request. Terminal requests cannot be applied again. Reject stale proposals and serialize competing apply/reject/withdraw transitions.
6. Anyone allowed to read the property may read its scoped change history: actor, time, fields and before/after values. Include creation, property/address edits, contact/link changes and primary replacements. Private raw audit data remains inaccessible; source records, phone strings, VND and m² retain their meaning in either UI language.
7. Manager/admin may optionally designate an address mapping verified from valid official units and property-level evidence, without another approver. Saving addresses never waits for verification. Changed mapped address facts clear that address's verified designation; price/contact changes do not. Preserve original legacy source text and previous current rows; primary replacement is atomic. Verified current addresses remain the preferred display, otherwise legacy is usable and current candidates are clearly labeled.
8. Sales requesting a lock for a deal use the existing reservation workflow: pending does not reserve; another manager/admin approves; only an approved, unexpired reservation is effective. This is not a new transaction/payment/commission module, and ordinary changes do not enter this approval flow.

### Implementation sequence after separate authorization

| Phase | Work | Observable completion |
| --- | --- | --- |
| 1. Database mutation and history contracts | Check current Supabase CLI help; create new migrations, never rewrite deployed SQL. Implement atomic creation/code allocation, immutable original legacy source, primary replacement, contact-link removal, optimistic revision checks, optional mapping verification/invalidation and scoped property history. Preserve current role, RLS, reservation and rental invariants. | Failure leaves no partial property/address/history state; direct Data API calls cannot bypass role, revision, source-preservation or history guarantees. |
| 2. Correction requests | Add request and amendment/history storage with explicit grants/RLS. Requesters read their own requests; staff/manager/admin process the queue subject to property access. Implement guarded submit/amend/apply/reject/withdraw operations and atomic correction/history/closure. | Requests without replacement values work; stale or terminal requests cannot overwrite data; concurrent resolution has one winner. |
| 3. Application maintenance surfaces | First establish the planned employee-access foundation and verify current pinned Next.js/React/Supabase SSR APIs. Add create/edit forms, explicit legacy/current address entry, dependent unit selectors with unresolved fallback, contact/link maintenance, correction submission/queue and property history in search/details. | Actual VI/EN browser journey works under live employee membership and user-scoped RLS; saves are immediate, not advertised as approved. |
| 4. Acceptance | Add deterministic database regressions for the new invariants; run `npm run test:schema`. Execute the [maintenance staging scenarios](testing.md#property-contact-and-address-maintenance-acceptance-not-yet-executed) using real Auth/Data API/RLS and concurrent sessions. | Record actual observations; embedded tests alone are not staging or browser acceptance. |

Mutation rendering stays separate from feature data access. Validate every Server Action/Route Handler input. Prefer transaction RPCs for multi-row state changes and revision checks; privileged internals remain private with fixed search paths, revoked default EXECUTE and live-role checks, exposed only through invoker wrappers. Migrate callers and close any replaced direct-write path rather than leave an authorization/concurrency bypass. Imports remain separately authorized controlled operations.

History reads must project allowlisted property business fields, obey live access and archive boundaries, and associate shared-contact changes with affected properties. Neither sensitive history nor inventory/contact data belongs in shared public caches. Source-language records are not translated by switching VI/EN; property-history timestamps display Vietnam time.

### Gaps and boundaries

- Issue #7's migrations replace direct property/address/contact/link writes with revision-checked maintenance RPCs, an atomic create/code generator, contact unlink, a correction workflow, a scoped history endpoint and database-enforced legacy source immutability. Hosted application and real browser/API acceptance remain pending; private audit snapshots and reservation approval are unchanged.
- Official address catalogs are not seeded. Unverified raw current entry is allowed without guessing units; optional verification requires reviewed catalog data and evidence. Catalog ingestion/provisioning is a separate prerequisite, not a reason to reject a known-address save.
- Literal `%`, `_` and backslash search is implemented by the applied forward migration and verified against distinct hosted matching/nonmatching controls. Address summaries remain bounded to the current result page.
- Existing record-review fields must not become a maintenance gate or misleading certification of changed facts. Preserve unrelated legal/sold/rented authority and active-rental protections.
- Exclude legal-status review, new uploads, external notifications, contact merging, hard deletes, separate deal records, commission/payment calculations, maps, AI enrichment and multi-tenancy. Existing reservation and rental approval requirements are unchanged.


## Confirmed first employee-access slice

The confirmed journey is: an invited, active employee signs in → searches a legacy address → opens property/contact details → switches VI/EN → signs out. An inactive or unlinked identity is denied through the UI and API. This section defines the planned slice, not an executed result or a replacement for the broader backlog.

### Starting identity and sign-in

- Start after invitation acceptance, confirmed identity linkage and activation through authorized administration. Being invited or authenticated alone does not authorize inventory access.
- Use email/password sign-in with password recovery and no public signup. Invitation acceptance and employee invitation/linkage/activation management UI are outside this slice.
- Validate sessions server-side and use live employee membership on every protected server request, as required by the [database contract](database-contract.md#client-and-authorization-contract).

### Search and read-only details

- Use accent-insensitive contiguous-substring legacy-address search. Treat `%` and `_` literally; do not offer fuzzy or reordered-token matching. Show the matching address format and verification state without inventing a current ward mapping.
- Retain the contracted 30-row default page, UUID cursor and 120-character query validation. Bound address-summary queries to the current page.
- Show property code, listing mode, physical type, access type, inventory/review/legal statuses, prices, dimensions, original legacy address and current address when present, with verification labels. Missing data remains visibly unknown.
- Show all linked owner/broker contacts, their relationship, primary marker and names. Do not present owner phone numbers automatically on the ordinary detail; owner contact and phone disclosure arrives only through the deliberate disclosure flow owned by issue #29. Do not fabricate missing contact relationships.
- Detail opens record idempotent page views through the documented activity RPC, never physical visits. UI retries or language switches must not create duplicate opens. A deliberate owner-contact disclosure commits one `owner_contact_access` event and reports one property per employee/Vietnam day; the Call link and language switching never add credit.

### Language, denial and sign-out

- Default to Vietnamese and fully localize this journey in VI/EN, including authentication/recovery, navigation, validation, badges, loading/empty/error states and access denial. Preserve source records, phone strings, VND, m² and Vietnam business dates.
- Switch language only after `set_my_locale` succeeds. On failure, retain the previous language and show a localized error without claiming it was saved. Successful switching preserves the search query, result position and open property; subsequent login loads the employee's saved preference.
- Inactive/unlinked users see a localized access-denied screen, not an inventory-empty state; application endpoints return `403`. Direct Supabase requests with an existing JWT expose no protected rows or reject guarded RPCs.
- Recheck membership on the next protected request or window refocus. When denial is detected, clear displayed inventory/contact data. Already delivered information cannot be recalled; no instant remote erasure is promised.
- Sign out the current browser session only and clear sensitive client state. Back, refresh and protected navigation must not reveal cached details. Other devices remain signed in; an already-issued copied access token may remain valid until expiry.

### Acceptance and boundaries

Use representative sanitized fixtures in isolated staging with real Supabase Auth and RLS; mocked authorization does not establish acceptance. Follow the [employee-access acceptance scenarios and evidence](testing.md#confirmed-employee-access-slice-acceptance).

File viewing, record editing, reservation/rental management, employee administration UI and production workbook import are outside this slice, not removed from the broader MVP. Provisioning and deployment are not authorized by the journey agreement.

The authorized development project received two forward fixes without rewriting deployed SQL: `20261010073738_literal_inventory_search.sql` implements literal wildcard/backslash matching, and `20261010085034_reviewer_archived_page_views.sql` allows active reviewer archived-detail page views while rejecting archived physical visits. Both have embedded regressions and real hosted API proof. Dev Data API exposure was separately authorized and verified as `public` only. These changes do not authorize production migration, import or deployment. All three delivered recovery cases have passed and the synthetic fixture is restored; the recovery acceptance blocker is cleared for issue #1 review, not permission to merge or deploy.

## Vietnamese/English UX requirements

- Required language codes `vi` and `en`, default `vi`; persist employee preference and support switching throughout the app. Number/date formatting may follow `vi-VN` or `en-GB` presentation, while currency remains VND and business timezone `Asia/Ho_Chi_Minh`; dates displayed `dd/MM/yyyy` and times in Vietnam.
- Show prices as “tỷ” or “triệu” for readability while converting exactly to whole VND for storage. Rent is labeled per month.
- Use m² for area and metres for dimensions. Preserve alley/house strings and Vietnamese accents.
- Separate “Loại giao dịch” (sale/rent), “Loại bất động sản” (house/land/etc.) and “Đặc điểm lối vào” (street/alley).
- Address badges: “Địa chỉ cũ”, “Địa chỉ mới”, “Chưa xác minh”. Reservation labels: “Chờ duyệt”, “Đã khóa”, “Từ chối”, “Đã giải phóng”, “Hết hạn”.
- “Lượt xem” is page interaction; “Bất động sản đã xem liên hệ chủ nhà” is a deliberate owner-contact disclosure count. New physical-visit submission is retired; retained confirmed rows are historical only.
- Show claimant/expiry on reserved properties. A pending request shows its review state, not an effective reservation.
- Unknown legal/area/category information stays visibly unknown; upload and internal review do not establish legal ownership.

## CI and environments

Engineering setup now includes locked npm dependencies, staged-format/type/lint/test hooks and read-only CI covering formatting, lint, types, configuration/release regressions, schema/preparation tests and Next build. A failed quality gate blocks the manually dispatched release pipeline. **Release application and database** (`.github/workflows/deploy.yml`) runs that quality gate, then applies the stage's reviewed pending migrations, then publishes the application, so database compatibility lands before the application that depends on it; a failed migration ends the run before anything is published. The guard-and-push sequence is defined once in `.github/workflows/migration.yml` and called by that pipeline and by the database-only workflow, whose `apply=false` verify mode never writes and now fails while any migration is pending. No migration is applied as a Vercel build side effect.

Two isolated Supabase and Vercel projects are the required `dev`/`prod` release topology; local and optional previews belong to dev. Deployments are explicit GitHub environment-gated operations on `develop`/`main`, respectively, with project/ref isolation checks and health smoke; nothing is released implicitly on a merge. Each delivery kind has its own repository-variable activation switch, so same-repository PR previews and authorized dev releases can be enabled while every production trigger stays skipped until staging acceptance and a separate `CD_PROD_ENABLED` production release decision. Automatic Vercel Git deployment must remain disabled. Vercel Web Analytics **has not been enabled**: the toggle is a dashboard action on each project that this work does not perform, and the dev review URL and the production URL are measured only after that toggle is on and a release has served traffic. The [setup runbook](setup.md) defines provisioning, protections, credentials, the release pipeline, the analytics toggle and rollback. Issue #1 separately authorized dev Supabase inspection/migrations, closed signup, exact localhost Auth redirects, synthetic fixtures and public-only API exposure. No production provisioning/import or Vercel deployment is established by this work.

Production release sequence: database compatibility change → application build/preview validation → approved deployment → smoke checks → monitor. Add destructive/restrictive schema changes only after the application is compatible. Keep prior app deployment available for rollback and use forward database fixes when recovery is safer.

## Out-of-scope extensions

Rental month dues, manual receipts/refunds and VI/EN support are now required. Commission rates/calculation/payouts, automated payment collection, multi-company isolation, branch/team scopes, a public property portal, automatic split-boundary geocoding, maps, automated customer messaging and AI enrichment require separate decisions. They must not creep into this first release.
