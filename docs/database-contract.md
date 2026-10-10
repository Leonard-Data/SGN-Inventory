# Database contract for the Next.js application and coding agents

Contract version: `0.2.0`; SQL schema authority: `supabase/migrations/`. Single company, invite-only employees, public Data API schema + unexposed private internals.

## Mandatory localization and rentals

Vietnamese (`vi`, default) and English (`en`) are both required in the application. Keep Vietnamese regional data conventions in either language; persist `employees.preferred_locale` through `set_my_locale`. UI language and signed rental document language are separate.

Rental lifecycle, monthly occupancy/dues and manual payment receipt/refund tracking are in scope. Use the normative [rental and localization contract](rental-localization-contract.md) for schemas, RPC parameters, status labels, authorization and acceptance rules. This adds rent tracking, without commission payouts or a payment gateway.

## Client and authorization contract

Use the signed-in user's request-scoped Supabase client with the publishable key. DB helpers find an **active** employee whose `auth_user_id = auth.uid()`. Application roles are stored in `employees.role`, not `user_metadata`. A signed-in Auth user without an active employee row has no inventory access.

Expose only `public` in the Data API. `private` must remain unexposed even though authenticated DB roles have USAGE and narrowly scoped helper EXECUTE permissions. Do not create a privileged browser/client service-role connection. Secret/server keys are limited to authorized Auth administration and controlled offline imports.

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

The SQL search response is `setof properties`, sorted by UUID ascending, with at most 50 rows. Cursor is the last returned UUID. Fetch result address summaries separately by the returned property IDs; bound relation queries to the current page. Price/area filters are normal typed property filters; add explicit RPC parameters with tests before offering those filters in a combined search UI. Escape `%` and `_` or intentionally label wildcard behavior; do not interpolate user SQL.

## Mutation RPC contract

| Public RPC | Parameters | Result | Guard / effect |
| --- | --- | --- | --- |
| `request_property_lock` | `p_property_id uuid`, `p_reason text`, optional `p_evidence_file_id uuid`, `p_reference text` | New lock UUID | Active employee; available/negotiating property; reason 10–2000 chars; ready evidence belongs to property; 48h pending request |
| `decide_property_lock` | `p_lock_id uuid`, `p_approve boolean`, `p_reason text`, `p_days integer=7` | void | Manager/admin; independent reviewer; pending unexpired request; active claimant; days 1–30; at most one approved lock |
| `release_property_lock` | `p_lock_id uuid`, `p_reason text` | void | Claimant or manager/admin; pending/approved only; meaningful reason; append event |
| `record_property_activity` | `p_property_id uuid`, `p_kind='page_view'|'site_visit'`, `p_key uuid`, optional `p_notes text` | Event UUID | Actor derived from session; server timestamp; site visits start pending; retry key reused only for same employee/property/kind |
| `review_property_visit` | `p_event_id uuid`, `p_confirm boolean` | void | Manager/admin; another employee's pending site visit |
| `complete_property_upload` | `p_file_id uuid` | void | Uploader/reviewer; registered object must exist; marks ready |
| `review_property_file` | `p_file_id uuid`, `p_status='accepted'|'issue_flagged'` | void | Manager/admin; ready file; records reviewer; does not automatically verify property legal status |

No authenticated INSERT/UPDATE/DELETE grants exist on locks, lock events or activity. Do not replace an RPC with several client writes. New lock requests have no explicit retry key: on `23505` from the pending-request index, refetch the employee's open request rather than blindly retrying. UI confirmation after ambiguous network failure must fetch the current state.

## Ordinary writes

- Active employees may create properties; the DB sets creator/updater from their session. Sales edit their own unarchived properties; staff/managers/admin can edit shared inventory.
- Manager/admin decide record-review and legal statuses and set sold/rented states. Sales cannot claim review approval by patching a property.
- Address writes follow property edit permission; verified mappings require manager/admin. Use an atomic reviewed transaction when replacing a primary address.
- Contact maintenance and property/contact links require staff/manager/admin. Sales can request corrections through the operational process; a correction-request table is not included in this foundation.
- Files: INSERT metadata is allowed with property edit permission and current employee as uploader. Upload completion/review use RPCs. No direct authenticated file metadata UPDATE or DELETE.
- Admin maintains employees and official catalogs. Creating an employee row does not create an Auth user; invitations and confirmed account linkage are separate server operations.
- Hard deletes are not exposed. When deactivating an employee, review their approved locks and release or let them expire; deactivation blocks new employee DB requests but does not erase attribution history.

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
