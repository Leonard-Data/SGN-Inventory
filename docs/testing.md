# Verification and staging acceptance

## Executed verification

`npm run test:schema` executes all four migrations in embedded PostgreSQL (PGlite) with the real unaccent/pg_trgm extensions. It creates mock Supabase Auth/Storage schemas and fixture employee accounts. It checks real database grants, RLS, workflow state and data constraints; it does not emulate HTTP APIs.

Results are in `validation-results.json`. Covered behaviors include anonymous/inactive denial, property edit restrictions, denied privilege escalation, accent-insensitive search, reservation approval and conflict, self approval/visit denial, activity retry, Vietnam dates, effective expiry/release, private staging/audit access and registered private-file access.

Python preparation tests validate source-sensitive unit conversions, datetime assumptions, phone preservation/normalization and exclusion of credentials. `prepare_workbook.py` was also run against the complete uploaded workbook. It reads without modifying the original; the delivered report is sanitized.

Rental/locale tests also cover preferred language, activation, month generation, one-active-rental exclusivity, role/payment privacy, integer VND, payment idempotency, independent review, overpayment/refund guards and termination.

## Required staging gates

| Test | Expected result |
| --- | --- |
| Unauthenticated Data API requests | No inventory/contact/employee/file data |
| Auth account without active employee row | Authenticated login possible, inventory denied |
| Deactivate an active account with existing JWT | Subsequent DB reads and RPCs denied without needing role-claim refresh |
| Edit someone else's property as sales | Zero affected rows or explicit denial; staff/reviewer can edit |
| Sales directly updates Approved, sold or legal verification | Rejected; authority cannot be bypassed by direct REST |
| Direct REST mutation of lock/activity tables | Permission denied |
| Reservation self approval as manager/admin | Rejected |
| Two live DB sessions approve different pending requests for one property | One commits; the other receives conflict; exactly one effective reservation and matching events |
| Approve after previous approved expiry | Stale row expires under parent lock; new approval can succeed |
| Read/view reservation after expiry without a sweeper | No effective lock; open state history may still show approved with past expiry |
| Retry a detail-open/visit request with the same key | Same event ID, no duplicate KPI |
| Multiple confirmed visits to same property/day | One distinct visited property in KPI |
| Visit around UTC 17:00 | Assigned to correct Vietnam calendar day |
| Legacy/current address search | Both match; result shows the matching format and verification state |
| Current address with district or wrong unit hierarchy/date | Rejected |
| Partial ward transition | Remains candidate until reviewed evidence; no automatic verified unit |
| Register without upload, then complete | Rejected; pending metadata does not grant read |
| Upload to an unregistered path or another uploader's row | Rejected |
| Ready file read/sign URL by active employee | Permitted; inactive user denied |
| Storage object overwrite/delete through browser client | Denied |
| Another environment's Vercel preview | Cannot access production database/configuration |
| Full workbook reconciliation | Every row classified; no unexplained duplicates/missing relations |
| Full VI/EN navigation and workflow switching | Equivalent dictionary keys, labels and validations; preference survives login; original addresses/documents unchanged |
| Current rental month and scheduled agreement | Vietnam calendar and actual contract dates determine occupancy; payment status is independent |
| Independent activation and payment confirmation | Self decisions and unauthorized direct writes denied |
| Concurrent rent receipts or refunds | Serialized month decisions; cannot exceed dues or confirmed receipt balance |
| Early termination of a prepaid agreement | Future dues voided; receipts retained; refund due visible; actual refund separately recorded |
| Production recovery rehearsal | New user writes preserved; backup/import map available |

Use Supabase CLI advisors and the real local/staging database when available. Inspect the current command's `--help` rather than assuming old flags. Run the SQL pgTAP structural checks in `supabase/tests/` on the local stack.

## Contention test procedure

Prepare two pending requests from different employees. In session A use an authenticated reviewer JWT context, call `decide_property_lock(A, true, reason)` within a transaction and hold the transaction open. In session B use a different connection and reviewer context to approve B. B must wait on the same parent property row. Commit A; B must fail with reservation conflict. Query effective locks and audit/events to confirm one approval. Repeat with A rolling back: B may then succeed. Do not treat parallel calls in a single embedded DB connection as a proof of real multi-session locking.

## Honest completion limits

The package has no live Supabase integration or Next.js browser verification yet. Embedded Auth/Storage shims cannot prove invitation flow, token validation, Storage API signed URLs, HTTP origin protections or deployment correctness. Those are staging acceptance gates before release, not results claimed by this foundation.
