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

The issue #1 implementation supplies sign-in, protected browsing/search, read-only details, local sign-out and saved VI/EN preference. Real delivered password recovery has passed for active, inactive and unlinked identities through the actual UI; denied recovery neither activated nor linked the employee and did not grant inventory access. The dedicated synthetic fixture was restored. This is scoped development evidence, not full MVP or production acceptance. See the [delivery scope](delivery-plan.md#confirmed-first-employee-access-slice) and [acceptance evidence and limits](testing.md#confirmed-employee-access-slice-acceptance).

`src/lib/supabase/route.ts` creates one publishable-key/session client per request, forwards refreshed cookies and SDK cache headers, and applies private/no-store responses and no-referrer policy. Auth cookies are HttpOnly and Secure on HTTPS. The locale cookie is presentation only; live membership and employee preference come from the database. Public auth navigation may carry `lang=vi|en`, but successful protected language switching persists only through `set_my_locale`.

Application endpoints: `POST /api/auth/login` `{email,password,locale}`, `POST /api/auth/logout` `{}` (local scope), `GET /api/session`, `GET /api/properties?query=&after=`, `GET /api/properties/[id]`, `POST /api/properties/[id]/page-view` `{key}`, and `POST /api/locale` `{locale}`. All JSON writes require the configured same Origin and a bounded JSON object; identities, keys, enum values and query bounds are validated. Detail prices are cast to text in PostgREST before JSON serialization; consumers must keep whole-VND decimal strings, not parse them to Number.
Property file read workspace (ticket #22):
- `GET /api/properties/{propertyId}/files` → `{files: [...]}` — completed attachments for a property, subject to live employee access and archived-property reviewer boundary.
- `POST /api/properties/{propertyId}/files/{fileId}/signed` `{download?: boolean}` → `{url, expiresAt}` — authorized 60-second signed URL; access checked via RLS. Omission means open; non-boolean values and unknown keys return `400/invalid-input`. Downloads retain the original filename.
Signed URLs are bearer credentials until expiry; they must not be logged, persisted in metadata or publicly cached. Renewal requires a new authorized read.
Open/download failures display the existing localized error without removing completed rows. Pending requests are aborted or ignored when their protected workspace changes; external windows use `noopener,noreferrer`.

Upload recovery (ticket #24): `GET /api/properties/{propertyId}/files/recovery` returns the current uploader's pending/failed registrations with authoritative Storage states `absent`, `present`, `unknown` or `unusable`. Optional `?fileId={uuid}` includes that uploader's completed registration to reconcile a lost response. Live membership, matching property and an unarchived parent are required. A missing-object response permits matching count/hash reselection against the same UUID/path and original metadata; existing bytes only retry completion. Unknown transport/permission outcomes never permit blind upload. Incomplete legacy expectations or unusable historical paths require a new replacement identity, never retargeting or deletion. Local bytes and transport credentials stay transient; browsers cannot restore local-file access after closure.

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
| `register_property_file` | `p_file_id uuid`, `p_property_id uuid`, `p_original_filename text`, `p_mime_type text`, `p_size_bytes bigint`, `p_sha256 text`, `p_purpose text='document'` | JSON `{fileId,objectPath}` | Any active employee; unarchived property; same UUID retries must match original expectations |
| `complete_property_upload` | `p_file_id uuid`, `p_object_id uuid`, `p_mime_type text`, `p_size_bytes bigint`, `p_sha256 text`, `p_signature text` | void | Uploader; trusted server attestation of actual bytes; live access, parent/property identity, expectations and immutable Storage object checked atomically |

No authenticated INSERT/UPDATE/DELETE grants exist on locks, lock events or activity. Do not replace an RPC with several client writes. New lock requests have no explicit retry key: on `23505` from the pending-request index, refetch the employee's open request rather than blindly retrying. UI confirmation after ambiguous network failure must fetch the current state.

## Ordinary writes

Issue #7's forward source migration replaces property/address/contact/link direct writes with [transactional maintenance and business history](maintenance-contract.md). Hosted schema application and real acceptance remain pending. The following role boundaries still apply; they are enforced through revision-checked operations, not parallel CRUD.

- Active employees may create properties; the DB sets creator/updater from their session. Sales edit their own unarchived properties; staff/managers/admin can edit shared inventory.
- Manager/admin decide record-review and legal statuses and set sold/rented states. Sales cannot claim review approval by patching a property.
- Address writes follow property edit permission; verified mappings require manager/admin. Primary-address replacement must be atomic; the planned maintenance slice does not require a separate approver.
- Contact maintenance and property/contact links require staff/manager/admin. Unlinking retains the shared contact and other links; same-person corrections append history to every affected property.
- Files: no direct authenticated metadata INSERT/UPDATE/DELETE. Registration and attested completion use invoker RPC wrappers around narrowly granted private definers. Historical review data is retained; review mutation RPCs are removed.
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

**Source progress:** issue #7 implements transactional generated-code creation, property/address/contact/link maintenance, immutable legacy corrections, atomic primary transitions, optional mapping designation/invalidation, revision guards and property-scoped history with shared-contact fan-out. These are not hosted acceptance claims. Correction lifecycle and integrated application status are recorded in the maintenance contract as implementation proceeds.

See the [planned maintenance acceptance scenarios](testing.md#property-contact-and-address-maintenance-acceptance-not-yet-executed). No application implementation, migration, provisioning or deployment is authorized by this planning record.

## Document protocol

1. Choose one client UUID per file before registration. Register its safe original filename, supported MIME, positive byte count ≤20 MiB, SHA-256 and document/photo purpose. New registrations use `<property_uuid>/<file_uuid>/content`, an opaque ASCII Storage key; original filenames remain verbatim metadata and download names. Existing paths, expectations and attribution are immutable.
2. `POST /api/properties/{propertyId}/files/register` returns `{fileId,objectPath,uploadUrl,publishableKey,accessToken}`. The request validates the live employee before obtaining the session JWT solely for direct upload transport.
3. POST bytes directly to private Storage with that user's JWT and `x-upsert: false`. This avoids Vercel's request-body limit while retaining Storage's live employee/pending-owner policy; no bearer signed-upload token or service-role upload is used. Keep transport credentials only in memory.
4. `POST /api/properties/{propertyId}/files/{fileId}/complete` accepts only `{}`. It inspects and downloads the actual object through the user's session, checks its immutable identity, exact bytes/hash and decoded supported format, and signs a versioned HMAC attestation. The database independently verifies the signature, original expectations, object identity and current actor after locking the parent property then file. An arbitrary browser RPC cannot mark a file ready.
5. Each open/download requests a fresh 60-second signed URL after live access checks. Already-issued bearer URLs remain usable until expiry; subsequent issuance and metadata/byte reads are denied after deactivation.
6. Registration and completion retry the same UUID/path. Existing bytes are never overwritten; replacement requires a new UUID/path. A transport failure is not proof of missing bytes.

Bucket enforcement limits objects to 20 MiB and PDF/JPEG/PNG/WebP. Image validation decodes actual image content; PDF validation requires its header/EOF and parses its object graph/page tree using pinned `pdf-lib`. This is not semantic/legal authenticity checking, malware scanning or human review. Historical ready rows remain readable with original IDs, paths, expectations and review attribution.

Install one cryptographically random 32-byte hex key as server-only `SGN_FILE_VALIDATION_KEY` and the matching `private.file_validation_keys` singleton (`id=1`) through the database owner. Neither authenticated clients nor service_role have key-table privileges. Missing configuration fails closed. Never commit, expose through `NEXT_PUBLIC_`, print or return this key. Migration SQL contains no secret.

## Types and error behavior

- IDs are UUID strings; source spreadsheet IDs are provenance only.
- Prices are whole-VND decimal strings at JSON boundaries; avoid JS floating-point conversion or exceeding safe integer precision. UI accepts/display tỷ/triệu but persists canonical VND.
- Timestamp values are ISO 8601 UTC instants. Source naive timestamps are interpreted in Vietnam only after confirming this assumption.
- `42501`: permission/role failure → show access denied. `23505`: duplicate pending request or reservation conflict → refetch current state. Check errors/invalid transitions → actionable validation message. Other failures → generic error plus protected diagnostics.
- Do not expose database stack traces, raw audit payloads or customer documents in logs.

## Contract changes

Add future changes as new migrations, with tests and this contract updated together. When introducing teams, branch scope, commission calculation/payouts, automated payment collection, address automation or a public portal, revisit authorization and data boundaries first.

### Ticket #23 — Validated Property file upload

Migration `20261010185028_property_file_upload_completion.sql` adds document/photo purpose and paired `validated_at`/`validated_object_id` completion evidence, removes direct metadata writes and the legacy existence-only completion/human-review RPCs, and tightens Storage policies. Existing `document_type='photo'` rows retain photo purpose; historical file and review fields are not rewritten.
Migration `20261010195100_property_file_ascii_keys.sql` fixes a real hosted Storage limitation: Unicode object keys are rejected even though Vietnamese original filenames are valid metadata. Only newly registered paths change; earlier registrations and legacy object/evidence identities remain untouched. An occupied or unusable immutable path requires a new replacement identity, never renaming or overwriting its original record.

Own pending metadata and bytes are visible only while the parent is unarchived, to support actual-byte inspection and later interruption recovery. Completed files retain the company-internal read boundary; pending bytes never appear in the shared read workspace. Anonymous/unlinked/inactive users have no file access. No category or cover schema is introduced by this migration.

### Ticket #25 — Document categories

Migration `20261010225118_document_categories.sql` adds company-wide `document_categories` table with explicit grants/RLS, a built-in `Other` category (uuid `ffffffff-ffff-ffff-ffff-ffffffffffff`), and `property_files.category_id` referencing it. Legacy `document_type` classifications are mapped to seeded categories with VI display names. `document_type` column is retained as historical field.

- **`document_categories` table**: `id uuid PK`, trimmed nonblank `name text`, nullable known `builtin`, nullable `created_by uuid FK employees`, `created_at timestamptz`. Active employees can read through RLS. Direct table insert/update/delete and anonymous access are revoked; creation uses the guarded private function and public invoker wrapper.
- **Uniqueness**: `lower(private.trim_unicode(name))`; surrounding whitespace matches JavaScript `trim()`, including tabs, form feeds, NBSP and FEFF. Vietnamese accents remain distinct. Concurrent normalized-name creation returns the existing identity.
- **Built-in Other**: UUID `ffffffff-ffff-ffff-ffff-ffffffffffff`, `builtin='other'`; localized display, stored name `Other`.
- **Legacy mapping**: Known `document_type` values map to seeded VI-named categories by `builtin`. Unmatched non-Other values retain a category named from their source classification with no builtin marker; original `document_type` is never overwritten.
- **`category_id`**: Non-null FK defaulting to Other. Not part of file identity; controlled category correction does not change the original registration.
- **`create_or_get_category(name)`** and **`list_document_categories()`**: Active-employee boundaries, with no category rename/delete/merge API. Custom names retain their trimmed spelling in either locale.
- **`register_property_file`**: Optional `p_category_id uuid` defaults to Other. Unknown references are rejected. Same-identity retries preserve the existing category rather than reclassifying the file.

### Ticket #26 — Authorized Document category correction

Migration `20261010232203_set_file_category.sql` exposes `set_file_category(property_id,file_id,category_id)` through a public invoker wrapper and guarded private definer. It checks live membership, locks the unarchived parent property before the matching file, and accepts only the original uploader or a current property editor. A null historical uploader is not a wildcard.

`POST /api/properties/{id}/files/{fileId}/category` accepts exactly `{categoryId: UUID}`. The category must exist and the file must belong to the URL property. Only `category_id` changes; failures preserve the assignment, readiness, original content, attribution, review history and evidence references. Fresh authenticated file reads update the displayed badge after save. The workspace reads category names after each file snapshot, including the correction refresh, so a newly assigned company category is not mislabelled Other. VI/EN controls use the same permissions, including uploader access without property-fact edit authority.




### Ticket #27 — Property cover photo

Migration `20261010225135_property_cover_photo.sql` adds nullable `properties.cover_file_id`, referencing a Property file. Only the guarded private `set_property_cover(property_id,file_id)` function, exposed through a public invoker wrapper, changes the pointer for a current property editor on an unarchived property. Parent property and then file rows are locked.

- Eligibility requires the same property, `purpose='photo'`, `upload_status='ready'` and both `validated_at` and `validated_object_id`. Document images, pending files, cross-property files and legacy photos without technical confirmation are rejected.
- Selecting, replacing and clearing are explicit choices. Upload or technical validation never selects a cover, and clearing never deletes or reclassifies a file.
- Legacy ready photos may be technically checked through the existing completion endpoint by a current editor. The server reads and decodes actual stored bytes, binds the HMAC to the original uploader (empty field when null), and preserves original metadata. This permission does not widen completion of pending uploads or access to pending bytes.
- An invoker trigger rejects direct INSERT with a cover or UPDATE changing the cover under `anon`, `authenticated` or `service_role`. It relies on PostgreSQL execution identity, not forgeable session settings; the guarded private function executes under its owner.
- `POST /api/properties/{id}/cover` accepts exactly `{fileId: UUID | null}` and returns the confirmed `{fileId}`. Only `null` clears; empty strings and extra fields are invalid. Constraint failures return localized `invalid-cover`; authorization failures return `access-denied`.
- Cards and property detail share private native-image rendering, avoiding the shared Next image optimizer. Transient signed links renew before expiry through fresh authorization; focus/session failures clear protected data. A failed image clears its resource and offers a localized fresh-link retry.
- Generate `src/types/database.ts` from the actual public schema after applying the migration.
