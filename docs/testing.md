# Verification and staging acceptance

## Executed verification

`npm run test:schema` executes all twelve migrations in embedded PostgreSQL (PGlite) with the real unaccent/pg_trgm extensions. It creates mock Supabase Auth/Storage schemas and fixture employee accounts. It checks real database grants, RLS, workflow state and data constraints; it does not emulate HTTP APIs.

Results are in `validation-results.json`. Covered behaviors include anonymous/inactive denial, property edit restrictions, denied privilege escalation, accent-insensitive search, reservation approval and conflict, self approval/visit denial, activity retry, Vietnam dates, effective expiry/release, private staging/audit access and registered private-file access.

Python preparation tests validate source-sensitive unit conversions, datetime assumptions, phone preservation/normalization and exclusion of credentials. `prepare_workbook.py` was also run against the complete uploaded workbook. It reads without modifying the original; the delivered report is sanitized.

Rental/locale tests also cover preferred language, activation, month generation, one-active-rental exclusivity, role/payment privacy, integer VND, payment idempotency, independent review, overpayment/refund guards and termination.

### Engineering foundation verification

Local engineering setup was exercised separately from business acceptance:

- A fresh `npm ci` installed the lockfile and Husky hook successfully; installed top-level versions and final formatting check matched the pinned setup.
- `npm run check`: formatting, ESLint and strict TypeScript passed; seven environment/release regressions and 74 embedded schema assertions passed.
- `npm run build`: the production Next.js build compiled `/` and `/api/health`.
- Python 3.11 virtual-environment setup with pinned requirements: seven preparation tests passed; the preparation CLI help ran. Windows requires the pinned `tzdata` package for `Asia/Ho_Chi_Minh`.
- The installed Husky pre-commit entry point ran lint/types/tests successfully with no staged files. The same lint-staged configuration formatted and restaged a deliberately unformatted TypeScript file in an isolated disposable Git repository, without touching the user's index.
- Actionlint `1.7.12` accepted all three workflows. Supabase/Vercel pinned CLI help confirmed the workflow flags; no cloud mutation was performed.
- Actual Edge browser smoke on the local dev server: VI → EN → VI navigation, 360px mobile rendering without horizontal overflow, no page errors; readiness screenshot inspected.
- Actual `next start` production build: valid fixture configuration returned `200`, `status=ok`, `stage=prod`; missing configuration returned `503`, `status=configuration-error`. Both health paths returned `Cache-Control: no-store`.
- Environment CLI accepted a valid fixture and rejected a different expected Supabase project. Release CLI accepted target/configuration/pulled fixtures and rejected cross-stage hosting selection without printing key values.
- Required agent CLIs installed globally: `gh-axi 0.1.36`, `chrome-devtools-axi 0.1.39`, `lavish-axi 0.1.85`. Version/help commands, GitHub repository read and Lavish playbook loading passed. Chrome CLI exercised the production readiness page through VI → EN → VI; page and application assets returned `200`. Browser console recorded a missing `/favicon.ico` (`404`), so this smoke is not error-free. A requested 360px resize reported success but the measured viewport was 504px; it does not prove 360px mobile acceptance.
- Commit-time recheck: `npm run check` and production build passed; all seven preparation tests passed using `.venv/Scripts/python.exe`. The unactivated system Python failed import tests because `openpyxl` was absent. Production-server health with inert dev configuration returned `200`, `status=ok`, `stage=dev`; without configuration it returned `503`, `status=configuration-error`. Both responses were `no-store`.

These checks use inert fixtures and do not establish Supabase connectivity, real key validity, auth/inventory browser acceptance or a deployed GitHub Actions run. Cloud environment setup and release instructions are in [setup.md](setup.md).

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

## Confirmed employee-access slice acceptance

Scope: [confirmed first employee-access slice](delivery-plan.md#confirmed-first-employee-access-slice). Use isolated development/staging with real Supabase Auth, Data API/RLS and the actual browser UI. Mocked authorization and embedded database checks cannot substitute for this evidence. The user authorized this development project and synthetic fixtures separately; production and broader MVP acceptance remain outside that authorization. **Human-coordinated active, inactive and unlinked email recovery have passed, and the dedicated fixture is restored. The recovery acceptance blocker is cleared for issue #1 review; merging and deployment remain separate authorization scopes.**

Prepare sanitized fixtures through authorized administration:

- An accepted-invitation, linked, active employee; an inactive employee with a linked Auth identity; an authenticated identity without an employee link; and an authorized administrator/operator for live deactivation.
- Distinct properties with similar accented legacy addresses, at least one unresolved current mapping, and properties with multiple owner/broker links and explicitly missing fields or contacts. Do not import raw customer data or invent source relationships.
- Representative address strings containing literal `%` and `_`, together with distinct nonmatching controls, to expose unintended wildcard matches.

| Scenario | Required observation |
| --- | --- |
| Active employee signs in with email/password | Protected inventory opens under the employee's live membership; no public signup is offered |
| Recover a password and sign in again | The real recovery callback allows password replacement and subsequent sign-in; recovery itself never grants or reactivates employee access |
| Search an accented address using an unaccented contiguous fragment | Expected property matches; original address spelling, matching legacy format and verification state remain visible |
| Search literal `%` and `_` | Only addresses containing the requested literal fragment match; characters do not expand to wildcard matches |
| Reorder address fragments | No fuzzy or reordered-token matching is promised; the UI does not advertise it |
| Search similar addresses on distinct properties | Distinct property codes remain identifiable; cursor paging retains distinct results and address summaries are bounded to the current page |
| Submit an over-120-character query or a query with no matches | Localized validation rejects the oversized query; a genuine empty result is distinguishable from access denial |
| Open property/contact details | Required characteristics, typed VND/dimensions, preserved legacy/current addresses, verification badges and all linked owner/broker relationships are shown; unknown values are explicit |
| Open a property without a contact link or verified current mapping | No guessed contact or ward is supplied; the missing/unresolved state is visible |
| Record/retry a detail open and switch language | The documented page-view RPC retains retry identity without duplicate events; no physical visit is created |
| Switch VI → EN → VI while searching or viewing details | All journey strings change, including validation and denial states; query, result position and open property survive; source text, phones, VND, m² and Vietnam dates retain meaning |
| Fail the language-preference request | Previous interface language remains; localized error appears; UI does not claim persistence |
| Switch language successfully, sign out and sign in again | Employee preference survives login via `set_my_locale`; source records remain unchanged |
| Inactive or unlinked identity attempts protected browser navigation | Localized access-denied screen with no inventory/contact details, not a misleading empty search |
| Inactive or unlinked identity calls application endpoints | Authenticated requests receive `403` without protected data |
| Inactive or unlinked identity calls the direct Supabase API | Protected SELECTs expose no rows; guarded RPCs reject access; no service-role fallback is used |
| Deactivate the active employee while their JWT and detail page remain open | Subsequent protected requests deny access without role-claim refresh; next request or window refocus clears displayed inventory/contact data; direct API calls with the old JWT expose no protected data |
| Sign out, then use Back, refresh and protected navigation | Current browser session is signed out and sensitive client state is cleared; cached property/contact details are not revealed |
| Sign out one browser while another device is signed in | Other device session remains active; do not claim that a copied, unexpired access token is immediately invalidated |

Record observed browser results and sanitized HTTP statuses/response shapes without tokens, passwords or customer data. Literal search is implemented by a forward migration and verified against distinct hosted matching/nonmatching controls. `scripts/employee-access-acceptance.mjs` exercises the real app and hosted Supabase through isolated Chrome profiles; it writes `employee-access-acceptance.json` only after its automated scenarios pass. Its report explicitly excludes real-mailbox recovery; separately observed human-coordinated recovery evidence is recorded below. Intermediate failed browser-driver runs are not full acceptance evidence. Neither the automated run nor partial recovery acceptance establishes production import, Storage/private-file or broader MVP release acceptance.

### Executed issue #1 development evidence

`employee-access-acceptance.json` records the latest real hosted-development/local-build automated run (see its `checkedAt` timestamp). All 12 automated observation groups passed; separately observed human-coordinated recovery is distinguished below:

- Real accepted linked-user sign-in, anonymous denial and UUID-keyset pages of 30 then 6 rows.
- Accent/unaccent contiguous search, literal `%`/`_` controls, reordered/no-match inputs and invalid/oversized request rejection.
- Decimal-string VND beyond Number's safe range, exact m², original legacy/candidate addresses and recorded owner/broker/raw-phone links; missing data is visibly unknown.
- Reviewer archived detail and same-key page view; archived physical visit and ordinary archived reads are rejected.
- Inactive/unlinked browser and app denial in both languages, zero direct RLS rows and guarded-RPC denial.
- Real browser search/detail; failed offline locale save retains language/state/source, successful VI/EN switching retains query/cursor/scroll/record and creates no duplicate activity.
- Live deactivation rejects original sessions (`403` app, zero direct rows, `42501` guarded RPC) and clears source details on refocus; the synthetic employee is restored.
- Saved language survives login and remains independent per employee. Local sign-out clears Back/direct-navigation details while the independently profiled other device stays signed in.
- Invalid recovery callbacks and inputs are localized and cannot update a password or grant employee access.
- Human-coordinated active recovery passed on 10 October 2026 at workstation-recorded 13:41 UTC: a real delivered link opened `/reset-password` in the requesting browser profile with both password fields and no error; actual password update returned `200`; the same browser's subsequent session request returned `401`; the old password failed app sign-in with `401/invalid-credentials`; native new-password sign-in opened the expected synthetic inventory and the live session returned `200` for the declared salesperson, retaining saved `vi`.
- The first link attempt produced an invalid-link request form in a different profile; the coordinated profile had no callback navigation. A fresh delivered link opened in the requesting profile completed the real flow without an app-code change. Request and open recovery in the same browser profile/origin; do not replay a consumed link or substitute an admin-generated link as delivery proof.
- Active recovery initially used the default two-messages/hour sender. The captain subsequently authorized custom SMTP only on development project `tneucwzcrzteeixvttpu`: Resend `smtp.resend.com:465`, sender `onboarding@resend.dev` / `SGN Inventory Dev`, finite 30 emails/hour. Live configuration verification found every other Auth field unchanged, including disabled signup and the exact localhost redirects. Provider quotas and recipient throttles still apply; unlimited sending is not claimed.
- Human-coordinated inactive recovery passed through the configured Resend sender: the actual received link opened `/reset-password` with both password fields; native password update returned `200` and the success message; after the request settled, the same browser session returned `401`. Hosted Auth rejected the previous password with `400/invalid_credentials` and accepted the new password for the exact fixture identity. Native new-password sign-in opened localized `/access-denied`; browser session and inventory endpoints returned `403`, protected SELECT and RLS-filtered search exposed zero rows, and `set_my_locale` / `record_property_activity` returned `42501`. The operator read confirmed the employee remained inactive, linked, sales and `vi`.
- One old-password app probe returned `503/unavailable`, not the expected credential `401`; its hosted Auth check returned `400/invalid_credentials`. No cause or app-code fix is claimed for that unavailable response. Initial password/login observation probes also sampled a pending request or lost their evaluation context during navigation; completed-request and actual destination/session observations above are the acceptance evidence. No password save was resubmitted.
- Human-coordinated unlinked recovery passed after the dedicated fixture was signed out and unlinked, remaining inactive, sales and `vi`. The fresh delivered link opened `/reset-password` with two password fields, no query keys and no alert. Native password update returned `200` with the success message and locally signed out the requesting browser (`401`). Hosted Auth rejected the prior password with `400/invalid_credentials` and accepted the new password for the exact identity. Native sign-in opened localized `/access-denied`; session/inventory endpoints returned `403`, protected SELECT and RLS search exposed zero rows, and guarded locale/activity RPCs returned `42501`. Operator reads confirmed the employee stayed inactive/unlinked/sales/vi, with zero employee links to this Auth identity.
- The first unlinked link attempt failed with provider `access_denied/otp_expired` in the requesting profile; the token was not replayed. Live OTP expiry remained 3600 seconds. Auth HTTP Date was about 356 seconds ahead of the workstation, explaining the apparent later send timestamp, not the token failure. The fresh request sent at Supabase-recorded `2026-10-10T15:07:07Z` (22:07:07 Vietnam) completed the real flow when copied directly from the newest message into the requesting profile, without code, template, expiry or security changes. Exact earlier consumption/prefetch/copy cause remains unproven; no general transport or expiry fix is claimed.
- After unlinked acceptance, native sign-out returned the browser to `/login` with session `401`. The operator atomically restored only the declared fixture's original identity link and active state; role stayed sales and preference `vi`. Actual final-password app sign-in returned `200` for that exact employee and saved `vi`; the requesting browser remains signed out. No existing real identity, organization permission, DNS, paid plan, production setting or deployment changed.
- Additional actual browser smoke: device emulation measured 390×844 with scroll width 390; native Tab exposed the localized skip link and Enter focused the main heading. The resize command's reported dimensions were not trusted because direct measurements disagreed; device emulation produced the correct measured viewport. Pixel screenshot capture timed out, so no screenshot or error-free-console claim is made.
- Inline review found the proxy's `503` catch dropped SDK-refreshed cookies. A throwaway server-function smoke used a real hosted Auth refresh and deliberately failed only the employee Data API transport: before, `503` forwarded zero Auth cookies with no referrer policy; after, it forwarded the refreshed Auth cookie with `private, no-store, max-age=0` and `no-referrer`. This is fault-injection evidence, not a claimed hosted RLS outage or mailbox test. Bun emitted an internal directory-mismatch warning while returning success; actual Next build/browser checks remain separate.
- The first PR quality job failed before installation: Node `24.14.0` bundled npm `11.9.0`, below the required `11.14.1` (`EBADENGINE`). CI and both release workflows now install pinned npm before `npm ci`; engine validation remains enabled and no release workflow was dispatched.
- Commit `7cc8001` passed the actual [GitHub CI quality run](https://github.com/Leonard-Data/SGN-Inventory/actions/runs/38048473444) after the pinned-npm fix; the earlier `EBADENGINE` failure is historical, not passing evidence.
- [PR #19](https://github.com/Leonard-Data/SGN-Inventory/pull/19) was initially held draft while mailbox gates were paused/pending. All three delivered recovery cases are now accepted and the fixture is restored, clearing that blocker for review. This does not authorize merging, closing issues independently or deploying.
- Initial and final parallel Standards/Spec reviewer agents could not start because the provider rejected their API credentials (`401`); no independent agent review is claimed. Inline review previously fixed the proxy cookie/outage and pinned-npm findings; the subsequent diff contains only evidence documents and acceptance-report wording, not changed application/database/workflow behavior. Final spec verification includes the separate real delivered-recovery evidence. CodeRabbit's earlier success explicitly skipped draft review.
- Final local `npm run check` and `npm run build` passed after recovery restoration: formatting, ESLint, strict types, 10 native tests, 83 schema assertions and the production build. Final real acceptance passed all 12 automated observation groups; the sanitized report's runner-recorded `checkedAt` is `2026-10-10T15:19:34.470Z`. That automated report still excludes the separately completed human mailbox cases; it is not production acceptance.

Separately, strict types and the production build passed; 10 native unit tests and 83 embedded schema assertions passed across all six migrations. Authorized hosted configuration was verified with closed signup, exact localhost recovery URLs and `public`-only Data API exposure (`private` read `406/PGRST106`, authenticated public read `200`). **Real active, inactive and unlinked mailbox/callback/password recovery are verified and the synthetic fixture is restored.** Private Storage, customer import, broader workflows, production and deployment are not claimed.

## Property, contact and address maintenance acceptance (not yet executed)

Scope: [confirmed maintenance plan](delivery-plan.md#confirmed-property-contact-and-address-maintenance-plan) and [confirmed planned contract](database-contract.md#confirmed-property-contact-and-address-maintenance-decisions). These are planned acceptance gates for the confirmed scope, not executed results or authorization to provision staging. Use sanitized fixtures, real Supabase Auth/Data API/RLS, the actual VI/EN browser interface and independent connections for contention.

Prepare distinct active sales/staff/manager/admin identities, an inactive and an unlinked identity, own/shared/archived properties, a contact shared by several properties, immutable legacy source text, current candidates and evidence-backed verified current addresses. Official-unit test fixtures must not be represented as a production catalog.

| Scenario | Required observation |
| --- | --- |
| Create with listing mode and a known legacy address, without price/dimensions/contact | One property receives a stable unique code; initial address and history commit with it; unknown facts remain unknown; the record is immediately searchable without maintenance approval |
| Blank/missing required address or listing mode; invalid typed values | Localized validation and database guards reject invalid input; no partial property/address/history state remains |
| Fail the initial address/history operation after beginning creation | Entire creation rolls back; no addressless orphan property or misleading success |
| Create with raw current address while catalogs lack matching units | Save unverified without district or guessed ward; later verification requires valid reviewed unit data/evidence |
| Sales edits own property versus another employee's property | Own unarchived edit succeeds immediately; cross-owner write is denied, including direct API attempts; denied writes leave no data change |
| Staff edits a shared property's price or facts | Corrected values appear in fresh search/detail reads; property history shows actor, time and before/after; no approval queue is created |
| Sales attempts contact/link maintenance or optional verified designation | Denied under database authorization, even if UI controls are bypassed; sales can submit a correction request instead |
| Staff creates a contact, links it, changes relation/primary, then unlinks a mistaken relationship | At most one primary contact; unlink preserves the contact and other links; each actual change is visible in property history |
| Replace a primary contact or current address concurrently | One consistent primary remains; stale replacement is rejected; previous current-address rows/source history are retained |
| Correct a shared contact's phone | Affected properties are shown before saving; each linked property's fresh details and scoped history reflect the correction; unrelated contacts are unchanged |
| Correct a wrong-person link on one property | Only that relationship changes; the original contact and its other relationships/details remain intact |
| Attempt to overwrite original legacy source text | Rejected through the application and direct API path; a corrected address is recorded separately without rewriting the source |
| Manager/admin optionally verifies address mapping they entered | Valid evidence/hierarchy/dates permit designation without another approver; it is not legal ownership or reservation approval |
| Change mapped address facts versus change price/contact | Address edit saves immediately and clears the affected verified designation; unrelated edits preserve it; partial transitions never auto-verify |
| Read property history as active sales/staff versus inactive/unlinked identity | Permitted property readers see scoped actor/time/field/before-after entries; denied identities receive no history; ordinary employees cannot access archived-property history |
| Attempt raw audit access or cross-property history exposure | Private audit payloads, secrets and document contents remain inaccessible; endpoint only returns authorized property business history |
| Submit a wrong-phone correction without knowing its replacement | Structured issue saves as open with the target and explanation; no live contact data changes and no new edit authority is granted |
| Read request history as its requester, another salesperson and the processor | Requester can track their own submission/amendments; another salesperson cannot read it merely through property access; authorized staff see the processing queue subject to live property access; request read rights do not grant mutation rights |
| Apply an open correction as authorized staff | Actual changes, property history and applied state commit together; no approval or requester confirmation is required |
| Inject a failure during correction application/history recording | Actual changes and request closure roll back together; request remains open and no partial success is displayed |
| Reject or withdraw an open correction | Authorized processor rejection requires a reason; only the requester may withdraw their own open request; records are retained |
| Reapply a terminal request or race apply against reject/withdraw in separate sessions | Terminal mutation is rejected; one transition wins and data/history agree with the committed outcome |
| Save two forms or apply a proposal after newer affected data commits | Stale mutation is rejected; current values are shown for reconciliation; original submission/amendments remain available; no silent merge/overwrite |
| Deactivate an employee while a form, queue or history view is open | Subsequent protected reads/writes deny access using live membership; clear sensitive displayed data on the established request/refocus boundary |
| Switch VI/EN through creation, maintenance, requests and history | Equivalent labels, validation and statuses; source text/phones and exact VND/m² remain unchanged; history times display Vietnam time; locale persists through the existing preference RPC |
| Request a lock on an available/negotiating property without record approval | Existing reservation rules apply; pending does not reserve; independent manager/admin approval creates one effective reservation; self approval is rejected |
| Search/open the corrected address, including literal `%`/`_` | Fresh results/details show corrected searchable facts and honest address labels; original legacy text stays searchable; the implemented literal search continues to exclude nonmatching wildcard controls |

Add embedded database regressions only for consumer-visible invariants and run `npm run test:schema` when implementing the schema/workflow changes. Browser, real Data API/Storage boundaries and separate-session contention remain distinct staging proof. Record sanitized observations without tokens, private source payloads or customer records; no scenario above has been executed by this documentation change.



## Property files staging acceptance

Scope: [private-file protocol](property-files-spec.md) and [document protocol](database-contract.md#document-storage-and-access). Use isolated development/staging with real Supabase Auth, Data API/RLS, Storage and the actual browser interface. The executed development evidence below is separate from these repeatable acceptance gates; embedded tests do not prove hosted permissions or concurrent transactions.

Prepare sanitized fixtures through authorized administration:

- The five existing employee identities (`active`, `english`, `inactive`, `unlinked`, `operator`) — `active` and `english` serve as the two distinct sales employees for cross-owner upload tests; `operator` serves as the property editor for correction and cover photo tests.
- Three property descriptors in `fileProperties`: `salesOwn` (actor: `active`), `salesOther` (actor: `english`), and `shared` (operator-owned, where three legacy files live).
- `archivedProperty` for archived-property denial tests.
- Three legacy files on the shared property, created before #23 migration: accepted certificate PDF, issue-flagged PDF, and unreviewed photo PNG. Exact records in `legacyFiles[]` with `bytes_fixture` paths and `sha256` hashes for content-integrity verification.
- Synthetic genuinely decoded PDF, JPEG, PNG and WebP, exact 20 MiB supported content, truncated/empty/oversized/unsupported content and source filenames containing Vietnamese accents.

| Scenario | Required observation |
| --- | --- |
| Active employee registers an attachment with safe filename, expected MIME/size/hash, and purpose (document or photo); uploads matching bytes; completion validates stored content type/count/hash | File appears in the property workspace as completed with original filename and purpose; a salesperson can upload to another employee's unarchived property without acquiring edit authority |
| Register but never upload; upload but never complete; complete with mismatched hash/count/type | File does not appear in completed file list; pending/incomplete state is distinguishable; no ready file results from absent or invalid bytes |
| Legacy files with upload_status='ready' preserve identity, content hash (sha256), original filename, MIME type, size, uploader attribution, review status; signed URL returns exact bytes matching bytes_fixture | All ready-status legacy files appear in the file list; #22 API filters on upload_status='ready' |
| Attempt empty, oversized (>20 MiB), unsupported-format, and unsafe-path inputs | Localized validation failure before Storage; no partial state, no leaked diagnostics |
| Uploader retries completion after a lost response; concurrent completion from two browser sessions | One authoritative attachment; exact stored content matches original bytes; no duplicate registration or object overwrite |
| Network interruption before object creation, after bytes stored but before completion, after completion before response observed | Recovery across refresh, browser closure and subsequent login finds the same registered upload; reselecting matching content reuses same UUID/path; different content is rejected |
| Uploader creates a company-wide Document category with accented name; another employee reuses it; Other default is applied when no category is selected | Category is available across employees and properties; normalized duplicate creation returns existing category; accented names are preserved; Other is localized per interface language |
| Uploader corrects own file's category on unarchived property (no property-edit authority needed) | Fresh file list shows corrected category; original content/identity/readiness unchanged |
| Authorized property editor (operator) corrects another uploader's file category | Same observation as uploader correction; an unrelated contributor (not uploader, not operator) is denied |
| Authorized property editor sets a completed Property photo (purpose=photo) as the cover | Card and detail show the selected photo; a document scan (purpose=document, even if JPEG) is rejected as cover candidate |
| Authorized property editor replaces the cover with another eligible photo, then clears it | Cover changes without deleting attachments; no selection shows a neutral placeholder |
| Employee without property-edit authority attempts cover set/replace/clear | Denied; current cover unchanged |
| Property reader opens/downloads a completed file through a signed URL; link expires and is renewed | Newly authorized link returned while access remains valid; expired link does not permanently block access |
| Inactive/unlinked/anonymous attempts file operations | Denied through both browser and direct API; no protected file data exposed |
| Archived-property file operations (upload, category change, cover) attempted by ordinary employee | Denied; reviewer (operator) can still read archived property files |
| Live deactivation while file workspace is open | Subsequent requests deny access; protected request/refocus clears displayed file data; restored activation re-enables access |
| Switch VI/EN during upload, category selection, recovery, and cover operations | Equivalent labels, validation and statuses; filenames, category names, and document bytes remain unchanged |
| Direct API attempts: metadata readiness mutation, forged completion attestation and old completion/review signatures | Denied without publishing unvalidated bytes; direct overwrite/delete probes need concrete authorization for a newly disposable synthetic object and subsequent exact-byte verification |

Add embedded database regressions only for consumer-visible invariants and run `npm run test:schema` for schema/workflow changes. Browser, real Data API/Storage/RLS and separate-session contention remain distinct proof. Record sanitized observations without tokens, signed URLs, private source payloads or customer records. Never run destructive probes on legacy or real objects or infer cleanup authority.

### Executed property-files evidence

See the scoped development observations below. They distinguish actual browser/API/Storage and independent-session checks from embedded assertions and unexecuted production gates.

## Contention test procedure

Prepare two pending requests from different employees. In session A use an authenticated reviewer JWT context, call `decide_property_lock(A, true, reason)` within a transaction and hold the transaction open. In session B use a different connection and reviewer context to approve B. B must wait on the same parent property row. Commit A; B must fail with reservation conflict. Query effective locks and audit/events to confirm one approval. Repeat with A rolling back: B may then succeed. Do not treat parallel calls in a single embedded DB connection as a proof of real multi-session locking.

## Spec #33 development evidence — upload slice

The captain authorized only development project `tneucwzcrzteeixvttpu`, its declared synthetic fixtures and scoped Spec #33 migrations/key installation. No production migration, import or deployment is included.

- Real authenticated browser uploads completed PDF, JPEG, PNG and WebP against private Storage, with actual server download/format/hash validation and paired immutable-object completion evidence. Uploading to another employee's unarchived property succeeded without granting property-edit authority.
- A supported PDF of exactly 20 MiB completed through direct user-JWT Storage transport; the application request carried registration/completion JSON, not the file body.
- A different active employee downloaded the newly completed PDF and its exact SHA-256 matched the synthetic source. Truncated PNG bytes remained pending/private and produced a Vietnamese content-validation error.
- Actual application registration rejected unsafe filenames, zero size, unsupported MIME and >20 MiB with `400` localized error codes. Direct metadata readiness mutation and a forged completion attestation returned `403`.
- The actual VI→EN header action persisted the employee preference and rendered English file controls without changing the original filenames.
- Hosted Storage rejected the initial Unicode key with `400/InvalidKey`. The additive ASCII-key migration left that failed registration and all prior paths unchanged; a new registration with the same Vietnamese original filename completed and another employee retrieved exact bytes. Native download `filename*` decoding also matched the original exactly after avoiding SDK query double-encoding.
- Before the PDF parser fix, an EOF/xref-looking payload with no PDF object graph was misclassified as PDF. Afterward the permanent regression and real browser upload rejected it without sharing; the exact 20 MiB genuine PDF still revalidated successfully.
- Real stored PDF bytes with a wrong registered count or SHA-256, PNG bytes declared as PDF, and PDF bytes disguised as a Property photo all returned `400/file-mismatch`. Each retained one pending registration with no validation marker; another employee saw no metadata and could not read the bytes.
- Inactive/unlinked authenticated identities returned zero direct file rows and `403` registration; another employee could not read the uploader's pending metadata.
- The earlier read slice exercised actual signed-link expiry, authorized renewal, original download filename/content, and live deactivation with an existing JWT: new signing returned `403`, direct metadata returned no rows, refocus removed private files, and the already-issued bearer remained usable until expiry. The employee was restored.
- Temporary archive of the declared synthetic parent exposed no ordinary file metadata (`200` with empty API/Data API lists), denied ordinary Storage reads and signing (`404`), and denied recovery (`403`). The reviewer retained all three ready legacy records and exact PDF bytes, but could not read archived pending metadata. The original archive state was restored through the separately authorized owner connection and confirmed by a fresh user API read; ordinary archive-update permission cannot restore an already archived property.

These are scoped development observations, not whole-spec acceptance. Categories, recategorization and covers remain separate ticket gates.

### Executed ticket #24 recovery evidence

- Actual browser refresh found the uploader's durable no-object registration. A different local count/hash was rejected without creating an object. Closing the owned browser and logging in again recovered the same registration; matching bytes with a different local filename and no MIME hint completed against the original UUID/path/source name. Another employee read exactly the original PDF bytes.
- A throwaway browser fetch interceptor interrupted only the completion request after real private Storage upload. The registration remained pending, the other employee could not read it, and refreshed recovery offered validation only. The native retry completed with zero additional Storage POSTs and retained exact content.
- A separate interceptor discarded the response only after actual completion returned `200`. Authoritative reconciliation displayed one ready attachment; the real Data API and independent byte read confirmed its single identity and immutable object marker.
- Two independently logged-in, isolated Chrome sessions sent completion concurrently for one pending object. Both returned `200`; one file UUID/path, original property/uploader and validated object remained, with exact bytes. A distinct unrelated attachment's SHA-256 was unchanged.
- Another employee's pending recovery and wrong-property recovery returned `404`; existing authenticated inactive/unlinked sessions returned `403`. Native VI recovery controls and stored-invalid-content validation were observed, then the employee preference was returned to EN.
- Strict types, lint and all 92 embedded workflow assertions passed. These real development observations do not claim byte-chunk resumption, cleanup, production or deployment.

The separately authorized overwrite/delete probe targeted only a newly declared disposable synthetic object: overwrite returned `400`, delete returned `200` with an empty removal list, and an independent subsequent read retained the exact original bytes. No legacy or real object was targeted; no cleanup deletion was performed.

### Executed ticket #25 category evidence

On the isolated development project, the native VI/EN workspace created a surrounding-Unicode-whitespace category and retained its accented spelling across saved locale changes. Two separately authenticated browser employees selected that same company category on different properties and uploaded valid PDFs; an independent employee read retained the exact original bytes. Other was the initial localized picker choice, and an actual omitted-category API registration/upload/completion produced a ready Other document.

Two independent employee JWT sessions concurrently created case/Unicode-edge variants of one new name and received the same category identity. Application and direct-RPC whitespace-only requests returned `400`; inactive/unlinked category reads returned no rows and creation returned `403`. Anonymous application reads returned `401`. An unlinked assignment attempt returned `403`; a forged category returned `400` with no file metadata. The migration preserved all three original legacy rows, including equivalent creation instants, and the existing reservation evidence reference. Embedded category/cover integration currently passes 107 assertions; complete-spec verification remains the later gate.

### Executed ticket #26 category correction evidence

Distinct uploader and sales-owner browser actors exercised VI/EN correction on the owner's unarchived property. The uploader had no property-fact edit authority but changed their own attachment to Other and saw the fresh localized badge. The owner then corrected that other employee's attachment back to the custom category and saw its unchanged spelling. An unrelated contributor had no correction control; application and direct RPC requests returned `403` without changing the file. A live admin correction succeeded, and another employee's Storage read retained the exact original PDF.

Forged category and mismatched property-path requests returned `400`, preserving the assignment. Direct metadata PATCH and inactive/unlinked RPC requests returned `403`. Temporary archive and deactivation probes used the existing owner/uploader cookies and previously issued JWTs: both application and RPC mutations returned `403` and preserved all file attributes; archive and activation were restored and re-read. The embedded runner now passes 119 assertions, including historical null-uploader denial, staff/manager/admin correction, original-field/history preservation and immediate existing-session deactivation.

### Executed ticket #27 private cover evidence

The sales-owner workspace completed two real PNG Property photos without selecting a cover. A certificate-image PNG deliberately used the Photo category but retained document purpose. Native VI selection rendered the chosen image in property detail and the actual filtered inventory card (`naturalWidth=8`), directly from private Storage rather than `/_next/image`. An independent admin used native replacement and English clearing controls; fresh cards reflected the final pointer or a neutral no-cover placeholder with no first-image fallback. Two independent owner/admin browser sessions concurrently selected valid photos; both returned `200`, leaving one eligible same-property pointer and unchanged original file attributes.

The real application rejected same-property pending, failed and unvalidated-ready candidates, the certificate image and another property's photo, preserving the selection. Direct cover UPDATE and INSERT returned `403` with no new property row. Non-editor/inactive/unlinked set and clear RPCs returned `403`; an uploader completed their own photo on another employee's property but still received `403` selecting it. A current admin technically checked an existing ready legacy photo through actual Storage reads and decoding; original nullable registration/history remained intact, and validation did not choose a cover.

The card obtained a different newly authorized signed link after expiry; the previous link returned `400`. A real expired-image request displayed the localized failure and removed the image; native Retry obtained a fresh link and rendered pixels. Deactivating the existing card actor denied new signing and mutation with `403`, and focus revalidation removed protected images and navigated to `/access-denied`. The already delivered bearer still returned the exact PNG before its TTL expired. Archiving hid the property from ordinary cards, denied fresh ordinary signing with `404` and denied owner/admin cover mutations with `403`, retaining the pointer. Activation and archive were restored and re-read. No original object was replaced or deleted.

### Final integrated engineering verification

The complete Spec #33 branch passed `npm run check`: formatting, ESLint, strict TypeScript, 12 unit regressions and 119 embedded database assertions. The production Next.js build compiled successfully with all file/category/cover routes. All seven workbook preparation regressions passed using the existing pinned Python virtual environment; the unactivated system Python lacked `openpyxl`. Canonical public database types were generated from the actual development schema after each authorized forward migration.

### Final review corrections and executed checks

The two parallel independent review workers failed with their provider's quota error. Inline review found one input-boundary standards violation, two unused cover-type exports (a possible Speculative Generality smell), and two specification defects: a newly assigned uncached category displayed as Other, and failed file signing was silent. One isolated implementer fixed every finding; its complete branch was merged through a separate merger.

Actual browser/API regression checks reproduced the failures before editing and exercised the merged corrections:

- Five malformed download value types return `400/invalid-input` without signing; boolean true/false and omitted values retain authorized `200` signing.
- A real category creation/correction inserted between a save and its fresh file read displays the exact new custom name, not Other.
- Opening a declared synthetic ready record whose object is absent returns actual `503/unavailable`; native VI and independent EN controls now show localized failures while retaining completed rows.
- Native logout during a held successful signing response navigated to `/login`, cleared all file rows and destroyed the pending request's browser context. No bearer response was printed or retained outside the private test process.


## Honest completion limits

Issue #1 has real development Supabase and scoped app/Auth/Data API/browser evidence, plus separately completed active/inactive/unlinked delivered recovery with fixture restoration; historical foundation-only evidence above remains separate. Spec #33 has the complete six-ticket private-files journey and real isolated-development browser/API/RLS/Storage acceptance documented above. Embedded Auth/Storage shims alone do not prove email delivery, signed URLs, HTTP deployment protections or cloud release correctness. Production rollout still requires the separate staging/release gates and authorization; imports, broader workflows and deployment are not part of this delivery. Independent Spec #33 review workers were quota-blocked; inline review and all resulting corrections were completed, but independent human PR review remains required.
