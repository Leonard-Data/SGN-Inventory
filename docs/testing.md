# Verification and staging acceptance

## Executed verification

`npm run test:schema` executes all six migrations in embedded PostgreSQL (PGlite) with the real unaccent/pg_trgm extensions. It creates mock Supabase Auth/Storage schemas and fixture employee accounts. It checks real database grants, RLS, workflow state and data constraints; it does not emulate HTTP APIs.

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

Scope: [confirmed first employee-access slice](delivery-plan.md#confirmed-first-employee-access-slice). Use isolated development/staging with real Supabase Auth, Data API/RLS and the actual browser UI. Mocked authorization and embedded database checks cannot substitute for this evidence. The user authorized this development project and synthetic fixtures separately; production and broader MVP acceptance remain outside that authorization. **Actual recovery-email delivery is explicitly paused pending an accessible test mailbox; issue #1 remains open and its PR stays draft.**

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

Record observed browser results and sanitized HTTP statuses/response shapes without tokens, passwords or customer data. Literal search is implemented by a forward migration and verified against distinct hosted matching/nonmatching controls. `scripts/employee-access-acceptance.mjs` exercises the real app and hosted Supabase through isolated Chrome profiles; it writes `employee-access-acceptance.json` only after all reachable scenarios pass and explicitly records the unexecuted real-mailbox gate. Intermediate failed browser-driver runs are not full acceptance evidence. Passing reachable scenarios does not establish production import, Storage/private-file, real-email or broader MVP release acceptance.

### Executed issue #1 development evidence

`employee-access-acceptance.json` records the latest real hosted-development/local-build run (see its `checkedAt` timestamp). All 12 reachable observation groups passed:

- Real accepted linked-user sign-in, anonymous denial and UUID-keyset pages of 30 then 6 rows.
- Accent/unaccent contiguous search, literal `%`/`_` controls, reordered/no-match inputs and invalid/oversized request rejection.
- Decimal-string VND beyond Number's safe range, exact m², original legacy/candidate addresses and recorded owner/broker/raw-phone links; missing data is visibly unknown.
- Reviewer archived detail and same-key page view; archived physical visit and ordinary archived reads are rejected.
- Inactive/unlinked browser and app denial in both languages, zero direct RLS rows and guarded-RPC denial.
- Real browser search/detail; failed offline locale save retains language/state/source, successful VI/EN switching retains query/cursor/scroll/record and creates no duplicate activity.
- Live deactivation rejects original sessions (`403` app, zero direct rows, `42501` guarded RPC) and clears source details on refocus; the synthetic employee is restored.
- Saved language survives login and remains independent per employee. Local sign-out clears Back/direct-navigation details while the independently profiled other device stays signed in.
- Invalid recovery callbacks and inputs are localized and cannot update a password or grant employee access.
- Additional actual browser smoke: device emulation measured 390×844 with scroll width 390; native Tab exposed the localized skip link and Enter focused the main heading. The resize command's reported dimensions were not trusted because direct measurements disagreed; device emulation produced the correct measured viewport. Pixel screenshot capture timed out, so no screenshot or error-free-console claim is made.
- Inline review found the proxy's `503` catch dropped SDK-refreshed cookies. A throwaway server-function smoke used a real hosted Auth refresh and deliberately failed only the employee Data API transport: before, `503` forwarded zero Auth cookies with no referrer policy; after, it forwarded the refreshed Auth cookie with `private, no-store, max-age=0` and `no-referrer`. This is fault-injection evidence, not a claimed hosted RLS outage or mailbox test. Bun emitted an internal directory-mismatch warning while returning success; actual Next build/browser checks remain separate.
- The first PR quality job failed before installation: Node `24.14.0` bundled npm `11.9.0`, below the required `11.14.1` (`EBADENGINE`). CI and both release workflows now install pinned npm before `npm ci`; engine validation remains enabled and no release workflow was dispatched.
- Independent parallel reviewer agents could not start because the provider rejected their API credentials (`401`); review was completed inline instead. The CodeRabbit success status is not review evidence: its PR comment explicitly skips draft reviews.

Separately, strict types and the production build passed; 10 native unit tests and 83 embedded schema assertions passed across all six migrations. Authorized hosted configuration was verified with closed signup, exact localhost recovery URLs and `public`-only Data API exposure (`private` read `406/PGRST106`, authenticated public read `200`). **No real mailbox was exercised; successful delivery/callback/new-password and denied-identity recovery remain release blockers.** Private Storage, customer import, broader workflows, production and deployment are not claimed.

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
| Search/open the corrected address, including literal `%`/`_` | Fresh results/details show corrected searchable facts and honest address labels; original legacy text stays searchable; the documented wildcard gap must be fixed before acceptance |

Add embedded database regressions only for consumer-visible invariants and run `npm run test:schema` when implementing the schema/workflow changes. Browser, real Data API/Storage boundaries and separate-session contention remain distinct staging proof. Record sanitized observations without tokens, private source payloads or customer records; no scenario above has been executed by this documentation change.


## Contention test procedure

Prepare two pending requests from different employees. In session A use an authenticated reviewer JWT context, call `decide_property_lock(A, true, reason)` within a transaction and hold the transaction open. In session B use a different connection and reviewer context to approve B. B must wait on the same parent property row. Commit A; B must fail with reservation conflict. Query effective locks and audit/events to confirm one approval. Repeat with A rolling back: B may then succeed. Do not treat parallel calls in a single embedded DB connection as a proof of real multi-session locking.

## Honest completion limits

Issue #1 has a real development Supabase connection and scoped app/Auth/Data API/browser checks; the historical foundation-only evidence above remains separate. Embedded Auth/Storage shims do not prove email delivery, Storage API signed URLs, HTTP deployment protections or cloud release correctness. Actual recovery-email delivery remains paused, and private files, production imports, broader workflows and production deployment still require separate staging gates and authorization.
