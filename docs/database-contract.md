# Database contract for the Next.js application and coding agents

Contract version: `0.2.0`; SQL schema authority: `supabase/migrations/`. Single company, invite-only employees, public Data API schema + unexposed private internals.

## Mandatory localization and rentals

Vietnamese (`vi`, default) and English (`en`) are both required in the application. Keep Vietnamese regional data conventions in either language; persist `employees.preferred_locale` through `set_my_locale`. UI language and signed rental document language are separate.

Rental lifecycle, monthly occupancy/dues and manual payment receipt/refund tracking are in scope. Use the normative [rental and localization contract](rental-localization-contract.md) for schemas, RPC parameters, status labels, authorization and acceptance rules. This adds rent tracking, without commission payouts or a payment gateway.

## Client and authorization contract

Use the signed-in user's request-scoped Supabase client with the publishable key. DB helpers find an **active** employee whose `auth_user_id = auth.uid()`. Application roles are stored in `employees.role`, not `user_metadata`. A signed-in Auth user without an active employee row has no inventory access.

Expose only `public` in the Data API. `private` must remain unexposed even though authenticated DB roles have USAGE and narrowly scoped helper EXECUTE permissions. Do not create a privileged browser/client service-role connection. Secret/server keys are limited to authorized Auth administration and controlled offline imports.

### Confirmed employee-access slice

An employee invitation must already be accepted, the identity linked and the employee active before this journey starts. Email/password sign-in and recovery do not grant employee authority. Validate the session and check live employee membership on every protected server request; ordinary application requests continue to use the user's publishable-key client and RLS, never a privileged fallback.

Application endpoints return `403` for an authenticated inactive/unlinked identity, and the UI shows localized access denied rather than an empty inventory. Direct Data API SELECTs may return zero rows under RLS instead of a permission error; guarded RPCs reject unauthorized calls. Denial must hold for subsequent requests using a JWT issued before deactivation. On the next protected request or window refocus, recheck membership and clear displayed inventory/contact data if denied; previously delivered information cannot be recalled.

The slice signs out only the current browser session, clears sensitive client state and prevents cached detail exposure through Back, refresh or protected navigation. Other device sessions remain signed in. Refresh-access revocation does not guarantee immediate invalidation of an already-issued copied access token before expiry.

Persist VI/EN preference through `set_my_locale` before switching the interface. Failure retains the previous language and shows a localized error; success preserves search query, result position and open property. Read the saved preference after subsequent login. No language change rewrites source records.

The issue #1 implementation supplies sign-in, protected browsing/search, read-only details, local sign-out and saved VI/EN preference. Real active and inactive password recovery have passed through delivered Supabase links and the actual UI; inactive recovery preserved denied employee access. Unlinked delivered recovery remains pending. This is not completed slice or production acceptance. See the [delivery scope](delivery-plan.md#confirmed-first-employee-access-slice) and [acceptance evidence and remaining gates](testing.md#confirmed-employee-access-slice-acceptance).

`src/lib/supabase/route.ts` creates one publishable-key/session client per request, forwards refreshed cookies and SDK cache headers, and applies private/no-store responses and no-referrer policy. Auth cookies are HttpOnly and Secure on HTTPS. The locale cookie is presentation only; live membership and employee preference come from the database. Public auth navigation may carry `lang=vi|en`, but successful protected language switching persists only through `set_my_locale`.

Application endpoints: `POST /api/auth/login` `{email,password,locale}`, `POST /api/auth/logout` `{}` (local scope), `GET /api/session`, `GET /api/properties?query=&after=`, `GET /api/properties/[id]`, `POST /api/properties/[id]/page-view` `{key}`, and `POST /api/locale` `{locale}`. All JSON writes require the configured same Origin and a bounded JSON object; identities, keys, enum values and query bounds are validated. Detail prices are cast to text in PostgREST before JSON serialization; consumers must keep whole-VND decimal strings, not parse them to Number.

Recovery: `POST /api/auth/recover` `{email,locale}` invokes `resetPasswordForEmail`; `/auth/callback` exchanges a real PKCE `code` with the current SDK's optional `sb_flow_id` verifier slot, and `/auth/confirm` accepts only `token_hash` with `type=recovery`. Neither callback accepts arbitrary redirect targets. `POST /api/auth/password` `{password,confirmPassword}` requires a verified Auth user and the matching recovery-flow marker, enforces 8–128 characters/matching inputs, updates the password and signs out locally. The marker is not employee authority. Callback URLs are not printed by Next request logging. No employee row is created, linked, activated or promoted by recovery.

## Read contract

| Feature | Source | Scope |
| --- | --- | --- |
| Inventory search | `search_properties` RPC | Active employees, unarchived inventory |
| Property detail | `properties` + `property_addresses` + `property_contacts`/`contacts` + `property_files` | Active internal employees; archived properties only reviewers |
| Reservation banner | `v_effective_property_locks` filtered by property UUID | Approved, unexpired; includes claimant name |
| My requests / reviewer queue | `property_locks`, `lock_events` | Active employees can read company reservations; decision capability is separate |
| My daily activity | `v_employee_daily_activity` | Own events for employees, all for manager/admin |
| Area inventory | `v_admin_inventory_by_area` | Manager/admin only; zero rows for other roles |
| Employee lock count | `v_admin_locks_by_employee` | Manager/admin only |
| Employee directory | `employees` | Active internal employees; admin-only writes |
| Imported history / audit | No public endpoint in MVP foundation | Private archive; implement a separately reviewed, redacted reviewer endpoint if needed |

Search parameters: `p_query text=''`, `p_status text=NULL`, `p_mode text=NULL`, `p_type text=NULL`, `p_area_id uuid=NULL`, `p_after uuid=NULL`, `p_limit integer=30`. Empty query browses inventory; query text over 120 characters returns no rows; route validation should reject it clearly. `p_mode='sale'` or `'rent'` also includes `both`. Area searches check province/district/commune version IDs on any address. For unresolved raw legacy labels, apply a separately validated label filter when the UI is implemented; never equate a text match with a verified current-area ID.

The SQL search response is `setof properties`, sorted by UUID ascending, with at most 50 rows. Cursor is the last returned UUID. Fetch result address summaries separately by the returned property IDs; bound relation queries to the current page. Price/area filters are normal typed property filters; add explicit RPC parameters with tests before offering those filters in a combined search UI. Do not interpolate user SQL.

Address search is accent-insensitive contiguous-substring matching with literal `%`, `_` and backslash, not fuzzy or reordered-token matching. `20261010073738_literal_inventory_search.sql` escapes patterns without rewriting the deployed foundation migration, applies the 120-character bound to raw input and retains UUID ordering/RLS/default limits. Show the matching recorded address format and verification state; never infer a verified ward from a text match.

## Mutation RPC contract

| Public RPC | Parameters | Result | Guard / effect |
| --- | --- | --- | --- |
| `request_property_lock` | `p_property_id uuid`, `p_reason text`, optional `p_evidence_file_id uuid`, `p_reference text` | New lock UUID | Active employee; available/negotiating property; reason 10–2000 chars; ready evidence belongs to property; 48h pending request |
| `decide_property_lock` | `p_lock_id uuid`, `p_approve boolean`, `p_reason text`, `p_days integer=7` | void | Manager/admin; independent reviewer; pending unexpired request; active claimant; days 1–30; at most one approved lock |
| `release_property_lock` | `p_lock_id uuid`, `p_reason text` | void | Claimant or manager/admin; pending/approved only; meaningful reason; append event |
| `record_property_activity` | `p_property_id uuid`, `p_kind='page_view'|'site_visit'`, `p_key uuid`, optional `p_notes text` | Event UUID | Active actor derived from session; server timestamp; unarchived properties ordinarily; archived **page views only** for active manager/admin with reviewer read access; archived site visits remain rejected; visits start pending; retry key reused only for same employee/property/kind |
| `review_property_visit` | `p_event_id uuid`, `p_confirm boolean` | void | Manager/admin; another employee's pending site visit |
| `complete_property_upload` | `p_file_id uuid` | void | Uploader/reviewer; registered object must exist; marks ready |
| `review_property_file` | `p_file_id uuid`, `p_status='accepted'|'issue_flagged'` | void | Manager/admin; ready file; records reviewer; does not automatically verify property legal status |

No authenticated INSERT/UPDATE/DELETE grants exist on locks, lock events or activity. Do not replace an RPC with several client writes. New lock requests have no explicit retry key: on `23505` from the pending-request index, refetch the employee's open request rather than blindly retrying. UI confirmation after ambiguous network failure must fetch the current state.

## Ordinary writes

- Active employees may create properties; the DB sets creator/updater from their session. Sales edit their own unarchived properties; staff/managers/admin can edit shared inventory.
- Manager/admin decide record-review and legal statuses and set sold/rented states. Sales cannot claim review approval by patching a property.
- Address writes follow property edit permission; verified mappings require manager/admin. Primary-address replacement must be atomic; the planned maintenance slice does not require a separate approver.
- Contact maintenance and property/contact links require staff/manager/admin. The foundation has no correction-request table or in-app workflow; the planned maintenance contract below replaces external operational handoff with structured in-app requests once implemented.
- Files: INSERT metadata is allowed with property edit permission and current employee as uploader. Upload completion/review use RPCs. No direct authenticated file metadata UPDATE or DELETE.
- Admin maintains employees and official catalogs. Creating an employee row does not create an Auth user; invitations and confirmed account linkage are separate server operations.
- Hard deletes are not exposed. When deactivating an employee, review their approved locks and release or let them expire; deactivation blocks new employee DB requests but does not erase attribution history.

### Confirmed property, contact and address maintenance decisions

The user confirmed the assembled [maintenance plan](delivery-plan.md#confirmed-property-contact-and-address-maintenance-plan) on 10 October 2026. These are approved planned requirements, not changes to current SQL grants, RLS or behavior. Confirmation authorizes documenting the agreement, not implementation, provisioning, import or deployment.

- Staff/manager/admin maintenance includes creating and correcting contacts, linking them to properties, changing relationship/primary markers and removing mistaken links. Contact merging and hard deletion are excluded. Removing one link must preserve the contact and its other relationships; the current schema has no ordinary unlink path.
- Ordinary property, price, address, contact and contact-link changes do not require record approval. This supersedes the earlier mandatory maintenance-review decision. Authorized saves appear immediately in search/details without an approval handoff or automatic return to a record-approval queue. There is no last-approved published version or private initial-draft model.
- Record accuracy, address mapping and legal ownership remain distinct. Do not present an earlier record-review decision as certification of subsequently changed facts. Existing record-review columns are not an authorization or publication gate. Legal-status review is not added to this slice.
- "Create deal" means the existing reservation workflow, not a new sales-transaction entity. Sales requests a lock; independent manager/admin approval creates an effective reservation. Pending requests do not reserve. No self approval, agreed-price/payment/commission module or new property-lock boolean is introduced. Other established reservation, visit and rental rules are unchanged.
- Creation requires listing mode and at least one nonblank known address. Accept explicit legacy entry or an unverified current address without guessed catalog units. Other facts and contacts may remain unknown. Save the property and its initial address atomically.
- New properties receive system-assigned, stable, unique codes independent of address, ward and creator. Preserve existing/imported codes and property identity through address corrections.
- Address mapping verification is optional evidence-based designation by manager/admin, without a second approver and without gating saves. Changing mapped address facts clears the affected verified designation atomically; unrelated price/contact changes do not. Require valid official unit hierarchy/dates and property-level evidence, particularly for partial transitions. Never overwrite original legacy source text; retain previous current addresses when replacing a primary.
- Correcting the details of the same shared contact affects all linked properties; show affected properties before saving. A wrong-person link is corrected on the affected property rather than overwriting the shared contact. No automatic identity matching or merging.
- Every change affecting a property must be recorded in its property change history, including creation, prices, addresses, owner/contact links, primary markers and shared-contact phones. Show actor, time, changed fields and before/after values. Shared-contact changes must be attributable from each affected property's history.
- Any active employee who can read a property may read its business change history, subject to live membership and the same archived-property read boundary. Keep private audit tables unexposed; return only property-scoped business fields, not unrestricted audit payloads, secrets or document contents. No shared public cache.
- Any active employee may submit a structured in-app correction request concerning any unarchived property's facts, addresses, contact details or links. Identify the target and explain the issue; replacement values are optional. Submission grants no editing or verification authority. Legal-status/evidence, reservation and rental corrections are outside this workflow.
- Requesters may read their own submissions and amendments; staff/manager/admin may read the company processing queue subject to live property access. Ordinary employees cannot read other employees' requests solely because they can read the property.
- Requests have `open`, `applied`, `rejected` or `withdrawn` states. Staff/manager/admin may apply or reject an open request within their existing edit authority; the requester may withdraw their own open request. Rejection requires a reason. Apply the actual correction, property-history entry and `applied` transition in one transaction; no reviewer handoff or requester confirmation. Retain the original request and amendments. Terminal requests cannot be reapplied.
- Reject stale form saves and stale correction applications, show current information and require reconciliation. Do not silently merge or overwrite newer values. Preserve the original request and record amendments; serializing an application must also prevent concurrent withdrawal/rejection from succeeding on the same open request.

**Implementation gaps:** the foundation has no creation/code-generation transaction, correction-request workflow or property-history endpoint. Unlink is unavailable to ordinary clients; direct table writes do not provide the agreed stale-edit guard or enforce immutable legacy source text. Existing private audit snapshots alone do not establish shared-contact attribution from each property's history. Optional verification/invalidation and atomic primary replacements need application/database implementation and regression coverage.

See the [planned maintenance acceptance scenarios](testing.md#property-contact-and-address-maintenance-acceptance-not-yet-executed). No application implementation, migration, provisioning or deployment is authorized by this planning record.

## Document protocol

1. Choose a UUID for the metadata row. Validate a safe filename and allowed MIME/size.
2. Register metadata with `object_path = <property_uuid>/<file_uuid>/<filename>` and pending upload status.
3. Upload once to the private `property-files` bucket using the user's client; never `upsert`.
4. Call `complete_property_upload`; the DB checks Storage registration exists. The server additionally checks expected byte count/hash/MIME before accepting a legal document in the UI.
5. For reading, use a short-lived signed URL (recommended 60 seconds) after RLS permits the object. URLs are bearer links until expiry and must not be logged, persisted in metadata or publicly cached.
6. Retry uploads using the same registered metadata if the object has not been created. If bytes already exist after a network interruption, retry completion. For replacement, create a new file UUID and path.

Bucket enforcement limits objects to 20 MiB and PDF/JPEG/PNG/WebP. MIME labels alone do not establish trustworthy content; validate bytes in the implementation's completion/review route. Storage cleanup for failed or orphaned uploads is an audited administrative maintenance operation, not a client delete.

## Types and error behavior

- IDs are UUID strings; source spreadsheet IDs are provenance only.
- Prices are whole-VND decimal strings at JSON boundaries; avoid JS floating-point conversion or exceeding safe integer precision. UI accepts/display tỷ/triệu but persists canonical VND.
- Timestamp values are ISO 8601 UTC instants. Source naive timestamps are interpreted in Vietnam only after confirming this assumption.
- `42501`: permission/role failure → show access denied. `23505`: duplicate pending request or reservation conflict → refetch current state. Check errors/invalid transitions → actionable validation message. Other failures → generic error plus protected diagnostics.
- Do not expose database stack traces, raw audit payloads or customer documents in logs.

## Contract changes

Add future changes as new migrations, with tests and this contract updated together. When introducing teams, branch scope, commission calculation/payouts, automated payment collection, address automation or a public portal, revisit authorization and data boundaries first.
