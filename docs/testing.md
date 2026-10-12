# Verification and staging acceptance

## Executed verification

`npm run test:schema` executes every migration in `supabase/migrations/` in embedded PostgreSQL (PGlite) with the real unaccent/pg_trgm extensions. It creates mock Supabase Auth/Storage schemas and fixture employee accounts. It checks real database grants, RLS, workflow state and data constraints; it does not emulate HTTP APIs.

Results are in `validation-results.json`. Covered behaviors include anonymous/inactive denial, property edit restrictions, denied privilege escalation, accent-insensitive search, reservation approval and conflict, self approval/visit denial, activity retry, Vietnam dates, effective expiry/release, private staging/audit access and registered private-file access.

Python preparation tests validate source-sensitive unit conversions, datetime assumptions, phone preservation/normalization and exclusion of credentials. `prepare_workbook.py` was also run against the complete uploaded workbook. It reads without modifying the original; the delivered report is sanitized.

Rental/locale tests also cover preferred language, activation, month generation, one-active-rental exclusivity, role/payment privacy, integer VND, payment idempotency, independent review, overpayment/refund guards and termination.

### Executed canonical authentication design comparison (tickets #50–#52)

- `npm run test:unit` now also runs `src/i18n/messages.test.ts` (VI/EN key parity, non-blank strings, canonical copy) and `src/features/employees/password-policy.test.ts` (four rules and their independent evaluation, the level↔verdict mapping, and the deliberately stricter nine-character case). Both pass.
- `scripts/auth-visual-compare.mjs` rendered the preserved prototype (`docs/design/sgn-auth.reference.html`) and the running application (`next start`) in headless Chrome at 375, 1039, 1040 and 1440 px with a fixed 900 px viewport, after `document.fonts.ready`, for the sign-in, recovery-request and recovery-password surfaces. Computed geometry, typography sizes/weights/line-heights, colour, borders, radii, control heights, the 452 px form cap and the 1040 px breakpoint match the reference exactly.
- Residual, understood differences: `next/font` appends a `<family> Fallback` entry to the computed `font-family` list (the rendered glyphs are the same self-hosted families), the `#f3f5f4` canvas is painted on the `.sgn-auth` shell instead of `<body>`, and the application adds a skip link the prototype does not have.
- The prototype's simulated sign-in success and reset timers are not reproduced. The recovery step-two lead uses the application's generic localised copy and never echoes an entered email, because the verified identity comes from the real callback rather than the typed address.
- Not executed here: real authorized Auth/email/callback acceptance and the production `next build` smoke against a configured Supabase project, which remain staging gates.

### Executed design-system application (Saigon New House package)

- **Port fidelity.** `src/app/app.css` (tokens) and `src/app/sgn-app.css` (app layer/vocabulary) are ports of the design package's `colors_and_type.css` and `assets/sgn-app.css`. A line diff against the package reports exactly one intended difference in each: the runtime Google Fonts request is replaced by this application's self-hosted `next/font` variables (`--font-display`, `--font-body`, `--font-mono` re-point to them); every other byte matches, and `prettier` is configured to leave both files alone so the values stay copied rather than tidied.
- **Two harness profiles.** `scripts/auth-visual-compare.mjs` takes `PROFILE=auth` (default, the tickets #50–#52 comparison against `docs/design/sgn-auth.reference.html`) or `PROFILE=applied`, which compares the shared application surfaces against the design package's own applied reference (`ui_kits/app/index.html`) at 375/1039/1040/1440 px:
  - `BASE_URL=http://127.0.0.1:3211 OUT_DIR=<dir> node scripts/auth-visual-compare.mjs`
  - `BASE_URL=http://127.0.0.1:3211 PROFILE=applied REFERENCE_HTML=<package>/ui_kits/app/index.html OUT_DIR=<dir> node scripts/auth-visual-compare.mjs`
  It writes a PNG per surface/viewport plus `metrics.json` and prints the computed-style diff per surface. The applied profile renders `src/app/design/app-preview` — a review-only route with fictional fixtures, no session and no database — composing the real shell, the real `PropertyCard` and the real `Plate`.
- **Results.** Auth: colour, borders, radii, control heights, type and the 452 px form cap match the reference; the residuals are the `Fallback` family `next/font` appends to the computed `font-family`, the skip link the prototype does not have, and an 8 px narrower language button at 375 px where the application hides the long VI/EN label. Applied: shell grid, rail, topbar, cards, plate, badge tones, panels, buttons and pagination match; remaining diffs are the same `Fallback` family names, the current-page nav wash (the reference kit's first nav item is the current page, the review route's is not) and elements the reference kit does not mount in its default view.
- **Environment limit found here.** `next dev` with Turbopack cold-caches `next/font` and fails to resolve its internal font module on this machine (`Can't resolve '@vercel/turbopack-next/internal/font/google/font'`, every route 500). `next dev --webpack` renders correctly and was used for the captures above.
- **Executed: an authenticated browser session** against the hosted dev project (`SGN_ENV=dev`) with `next dev --webpack`, driven through `chrome-devtools-axi`. Signed in with a sales account and asserted the rendered DOM: the inventory listed 30 real records, 3 cards per row at 1440 px, with one genuine site plate drawn from recorded geometry (`LÔ ĐẤT 42,3 m²`, `6,5 × 6,5 m`, north arrow, 10 m scale) and `CHƯA CÓ ĐỦ DỮ LIỆU LÔ ĐẤT` on records without areas; the record page rendered all nine sections (21 facts, 4 addresses, 15 attachment rows, composer, 726×348 plate hero); the language switch re-rendered both the document language and the body in both directions while the recorded Vietnamese address text stayed untranslated; the drawer moved focus to the first nav link, closed on Escape and returned focus to the menu button; 375/768/1040/1440 px had no horizontal overflow, and the rail↔menu-button swap happened at the 1039/1040 boundary. Screenshots stay in `.scratch/evidence/live/` (git-ignored: they show recorded addresses).
- **Four defects this session found, fixed and re-verified live:**
  1. The record page crashed for any address with no effective date: `vietnamDate(address.effective_on ?? '')` reached `Intl.DateTimeFormat.formatToParts` with an Invalid Date and threw `RangeError: Invalid time value` (the column is nullable by design). Both Vietnam date formatters are now total — an absent or unparseable value returns `null` and the caller renders the unknown marker (`Chưa rõ`/`Unknown`) — covered by `src/features/properties/format.test.ts`.
  2. The language switch changed `<html lang>` but not the page body: the shell renders from the cookie while the body rendered from the client-fetched `employee.locale`, which a `router.refresh()` does not re-fetch; `useProtectedData` also wrote `document.documentElement.lang` from that stale value. Bodies now render the server-resolved locale and the client no longer writes `lang`.
  3. The files panel overflowed narrow viewports (a 633 px dropzone and a 430 px badge at 375 px), and a document row had four grid children where the package's row defines three (`40px minmax(0,1fr) auto`), putting the meta cell in the action column. The row now nests the meta in the middle cell, and `sgn-surfaces.css` records the two extensions: the dropzone wraps and its controls may shrink, and a long recorded category wraps inside its row badge.
  4. The inventory search button held its text label in the package's 44 px icon slot (three wrapped lines spilling over the hint) and the leading magnifier was missing. Both now use the package's own icon markup.
- The console reported an invalid `stroke-width`-family DOM property in a file-row icon and duplicate React keys on the maintenance/correction panels; both are fixed, and an authenticated page load now logs no errors.
- **Second live round (record structure and the design surfaces without product data).** Verified in the same session: the record page now renders the package's three tab groups (`Tổng quan | Tài liệu | Thảo luận`) inside a main column beside `aside.detail-rail`, with roving-tabindex keyboard support (ArrowLeft moved selection and focus from Thảo luận to Tài liệu) and inactive tabpanels `hidden` rather than unmounted, so no panel refetches on a switch. This also fixed the layout defect underneath: the panels had been direct children of `.detail-body`, whose `minmax(0,1fr) 344px` grid placed them in alternating columns, so the facts panel (and with it the long VND value) rendered inside the 344 px rail; facts now measure 676 px and the rail holds the history, the page-view note and the activity counts. The file dropzone no longer crowds (the hint's min-content let the row never wrap, so its text was crushed into a ~130 px column; the hint now takes its own line and the fields keep their basis — select 379/406/238 px at 1440/1200/900, no internal overflow). `/design/app-preview` additionally renders the vocabulary the product has no data for: the asking-price rows and change timeline (`.price-row`, `.timeline`/`.tl-item`) and the **Nhân sự & liên hệ** screen (`.directory-tabs` with working tab switching, employee accounts and contact book tables, `.cell-person`/`.sgn-avatar-sm`/`.cell-date`/`.cell-actions`). The applied harness profile was re-run against the package reference after the additions and still completes; its report lists the added vocabulary as `ref=undefined` because the reference kit has no counterpart at those indices.
- **Still not executed here:** the staging gates in this file that need more than one authenticated account (access-denial clearing between roles, private signed-file fetch, external email delivery), `npm run test:acceptance` (`.env.acceptance.local` is absent) and the production `next build` smoke. The session above used one sales account on the hosted dev project and did not exercise manager, admin or file-signing surfaces.

Property-discussion tests (#44) also cover anonymous/inactive/deactivated denial on both the table and the RPC, cross-owner posting without property-edit authority, blank and over-limit validation, retained attribution with immutable property/author/time, employee-scoped submission-key convergence and conflicting reuse, the archived read/post boundary, no side effects on property facts, and tied-time keyset paging without omission or duplication.

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

### Executed release-pipeline and analytics verification (issue #54)

Repository-side delivery preparation only: no cloud operation was performed and no workflow was dispatched.

- `actionlint 1.7.12` accepted all three workflow files, including the `migrate` job and `migration` input added to `.github/workflows/deploy.yml`. Shellcheck integration is genuinely engaged rather than assumed: actionlint reports `SC2086` for a deliberately unquoted variable in a throwaway copy, and reports nothing for the repository's workflows, so every `run:` script was shellchecked.
- `npm run check` passed with the pinned Node `24.14.0` / npm `11.14.1` toolchain: formatting, ESLint, strict TypeScript, unit and environment/release regressions, and 201 embedded schema assertions.
- `npm run build` compiled the production Next.js build with the inert dev fixture configuration. The analytics integration reaches the output: the built client chunks contain the `_vercel/insights` beacon path (observed in `.next/static/chunks/0852uv9sl-7b1.js`), so enabling the dashboard toggle is the only remaining step for collection.
- `@vercel/analytics` is pinned to `2.0.1` in `package.json` and `package-lock.json`; adding it changed no other dependency.

Not executed, and therefore unverified external prerequisites: no workflow was dispatched, no migration was applied, no Vercel project, project ID or domain is established by this evidence, neither Web Analytics toggle was enabled, no deployed request was measured, and the GitHub environments `dev`/`prod` with a required reviewer are unconfirmed — read-only repository checks observed no environments and no protection on `main` or `develop` at the time of writing. Until those exist, production delivery stays blocked. The dispatched behaviour of the pipeline, real migration application and the analytics view all remain unexecuted.

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
| Retry a detail-open request with the same key | Same event ID, no duplicate page-view KPI |
| Repeated owner-contact reveals for one property/Vietnam day | One owner-contact property; no duplicate credit; a reused key for another property is rejected |
| Detail open or owner-contact reveal around UTC 17:00 | Assigned to correct Vietnam calendar day |
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
| Direct Data API/RPC access to another property's discussion as anonymous, inactive, unlinked or deactivated identity | No rows and `42501` on guarded RPCs, including with a JWT issued before deactivation |
| Retry one comment submission with the same employee submission key | One original comment identity; no duplicate; conflicting property or text reuse rejected |
| Read and post archived-property discussion by role | Reviewer reads; ordinary employees do not; posting denied for every role |
| Two live sessions post and archive the same property | Serialized on the parent property; no comment commits after the archive commits |
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
| Open property/contact details | Required characteristics, typed VND/dimensions, preserved legacy/current addresses, verification badges and all linked owner/broker relationships are shown with names, relations and primary markers; unknown values are explicit; no owner phone is presented automatically and no disclosure control is offered |
| Open a property without a contact link or verified current mapping | No guessed contact or ward is supplied; the missing/unresolved state is visible |
| Record/retry a detail open and switch language | The documented page-view RPC retains retry identity without duplicate events; no physical visit is created |
| Switch VI → EN → VI while searching or viewing details | All journey strings change, including validation and denial states; query, result position and open property survive; source text, VND, m² and Vietnam dates retain meaning |
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

### Ticket #28 — protected detail and personal today activity acceptance (earlier revision executed; revised head not reproduced)

Extends the employee-access matrix above; it does not replace it. Real authorized Supabase Auth/Data API/RLS and browser evidence is required; mocks are not acceptance. Requires the authorized isolated development project with `20261011060031_personal_daily_activity.sql` applied and synthetic active, inactive, unlinked, operator and independent-employee fixtures.

**Revised-head status (11 October 2026).** The evidence below was gathered at the pre-review revision `65d1ad1`. The review change `c16889e` then re-scoped personal activity to protected revalidation and changed the stale-report and refocus paths, and the revised head has not reproduced that authenticated acceptance. This worktree has no scoped credentials or fixtures, no accessible cached Supabase query channel and no verified served target, so the real hosted Auth/Data API/RLS matrix and browser journey remain unverified at the revised head; embedded schema assertions and anonymous login HTML do not establish this acceptance.

| Scenario | Required observation |
| --- | --- |
| Active employee opens a property through a direct authorized link | Recorded facts, preserved legacy/current addresses and owner/broker names, relations and primary markers appear; owner phones are absent from the page and no disclosure control is offered; unknown facts and missing relationships stay explicitly unknown |
| Re-render, refocus or switch language on one open detail | The Page view keeps its UUID identity and yields exactly one event; a genuinely new navigation may add one more; no Owner-contact access or physical visit is created |
| Read today's personal report in the browser | Rendered event count, distinct-property count and Vietnam day equal the live `my_today_activity` result for the signed-in employee, including the just-recorded open |
| Employee with no Page view yet today | The report returns explicit zeros at the application boundary, not an error, blank panel or denial |
| Anonymous, unlinked or inactive identity calls the report | `401` (anonymous) or `403/access-denied` (authenticated but not active), never a zero report |
| Reviewer/operator reads their own report | Only that employee's activity appears even though their RLS spans colleague activity; no company-report UI is added |
| Deactivate the open employee, then refocus; sign out and use Back or a protected direct link | The membership recheck clears the report with the rest of the protected surface; denial is never rendered as zero activity |
| Switch VI/EN on an open detail | Activity labels, day and counts are localized; reported values and recorded source are unchanged and no extra event is recorded |
| Mobile and keyboard use of the detail and report | Controls are keyboard reachable with accessible labels; a failed report is distinguishable from a genuine zero, an empty inventory and a missing property |

`npm run test:schema` asserts own-only scope, the database Vietnam day and the zero-versus-`42501` boundary in embedded PostgreSQL. `scripts/employee-access-acceptance.mjs` exercises the hosted authenticated journey, including rendered report values matching the live session report.

**Executed against the authorized development project at the pre-review revision `65d1ad1` (11 October 2026); not re-run at the revised head.** Migration `20261011060031_personal_daily_activity.sql` was applied through the reviewed forward path: the CLI dry-run reported exactly that one pending migration with no seeds or roles, the push applied only it, the follow-up dry-run reported up to date, `my_today_activity` moved from `404 PGRST202` to `403/42501` for an unauthenticated caller, and every read-only row baseline was unchanged. A disjoint synthetic namespace (five Auth users, four employees, three properties with owner/broker contacts, one archived) was created through the operator plane; the existing fixtures and the supplied development login were untouched.

Real individual-session results over hosted Auth/Data API/RLS (task-local runner, sanitized output):

- anonymous report, detail and page-view → `401`;
- an event-free employee's own report → `200` with explicit `0/0` and the database Vietnam day;
- one logical open, retried with the same key, → one `page_view` event and no site visit, and the same key cannot be reused for another property;
- a new logical open → exactly one more event and one more distinct property;
- a colleague sees only their own zeros;
- inactive and unlinked identities → `403/access-denied` on report, detail and page-view;
- archived detail → `404` for the ordinary employee, `200` for the reviewer, whose report stays own-only;
- a JWT issued before deactivation → `403` on the next protected request with recorded events unchanged, and restoration re-enables the same employee.

**Executed browser journey at the pre-review revision `65d1ad1` (11 October 2026); not re-run at the revised head.** Run with the repository-pinned `chrome-devtools-axi` 0.1.39 in task-private tooling, attached to a task-private headless Chromium through the documented `BROWSER_URL` mode with a private HOME, profile, session and ports (the installed 0.1.33 could not launch a browser on this host, and the pinned driver's own launch path failed the same way; a direct headless Chromium worked, which is what the documented attach mode uses). Observed: the direct link renders recorded facts, preserved legacy/current addresses, owner and broker names, relations and the primary marker **with no owner phone anywhere in the DOM and no disclosure control**; today's own panel matches the live report (Vietnam day, 1 event/1 property, then 2/2 on a genuinely new open); retry and VI→EN→VI keep the same open property with no duplicate event; an event-free employee sees explicit zeros; anonymous `401` and inactive/unlinked `403`; archived detail `404` for the ordinary employee and readable by the reviewer; deactivation clears the panel on refocus; sign-out clears state and Back/direct navigation expose no protected data; at the emulated 390×844 viewport `document.scrollWidth` equals the viewport with no overflowing element, and the skip link moves focus to the main region with the labelled activity panel present.

**Fixture cleanup.** The disjoint `SGN28` namespace was created for this run and has been fully removed through the approved operator boundary after verifying each exact manifest ID by a read first: 5 activity events, 2 contact links, 3 addresses, 3 properties, 2 contacts and 4 employees deleted (HTTP 200 with the expected row counts), the synthetic Auth users removed through the Auth-admin API, and the project restored to its prior baseline (39 properties, 5 employees, 2 contacts, 82 activity events, 39 addresses, 32 files, 1 lock, 11 categories). An earlier blanket `404` during cleanup was a local request-builder bug — a missing leading slash before the resource path — not a permission boundary; no grant, policy, trigger or protection was changed. The supplied development login and all pre-existing fixtures were untouched throughout.

## Owner-contact disclosure acceptance (ticket #29)

Scope: the disclosure-to-today's-report path of [issue #29](https://github.com/Leonard-Data/SGN-Inventory/issues/29). This supersedes the #28 statement that the ordinary detail carries no disclosure control. Real individual-session Auth, Data API and RLS checks, the rendered VI/default and EN journey, and genuinely separate-session races are required; embedded PGlite assertions and the embedded Auth/Storage shims do not establish them.

| Gate | Required observation |
| --- | --- |
| Deliberate disclosure | Owner phone appears only after Show owner contact; page load, render, prefetch, language switch and Call disclose nothing and add no credit |
| Owner eligibility | The property's recorded `relation='owner'` link decides, so a shared contact is an owner on one property and only a broker on another; a broker-only property and a recorded owner without a phone are explicit and add no credit |
| Atomic outcome | A failed disclosure returns no phone payload and leaves no committed activity; the localized error offers a retry |
| Retry identity | A same-key retry after a lost response returns the original activity reference and day without a duplicate or rewrite; reusing the key for another property is rejected; no caller can choose the actor or day |
| Daily counting | Repeated reveals, concurrent tabs and several owners/phones give one property per employee per Vietnam day; another property or another employee counts independently |
| Archived boundary | Manager/admin keep authorized archived contact access without new credit; ordinary employees stay denied; archiving or correcting after a valid disclosure keeps the earlier credit |
| Report | Today's personal report shows page views, distinct properties viewed and the owner-contact count separately with explicit zeros, and never calls it attendance, a visit or a connected call |
| Call action | The Call link opens the device dialer for dialable recorded data; clicking it is not independent credit |
| Denial and boundaries | Anonymous, unlinked and inactive identities are denied; direct client activity writes stay denied; no phone value is stored in the activity row |
| Midnight | A new next-day disclosure counts for that day and a pre-midnight disclosure retried after midnight keeps its day (embedded deterministic boundary; no production backdating API) |

**Executed on 12 October 2026** against the authorized development project `tneucwzcrzteeixvttpu`, with the repository's forward migrations applied through the reviewed dry-run/push path (each dry-run reported exactly its own file with no seeds or roles, each push exited `0`, the follow-up dry-run reported up to date, `reveal_owner_contact` moved from `404 PGRST202` to `403/42501` for an unauthenticated caller, and every read-only row baseline was unchanged). The evidence below was re-run after the review follow-up `20261012075323_owner_contact_retry_identity.sql` at head `7dd0987`, and then fully re-run at head `d9cd021`, the review-fix commit that changes the client reveal/refresh behaviour and the English metric label, after both forward migrations were applied through the reviewed dry-run/push gate; all 15 recorded observation groups passed, and the embedded suite covers that follow-up's post-archive and phone-removed retry cases. The committed source is unchanged by this docs-only edit. A disjoint `SGN29` namespace was created through the operator plane and removed after the run.

Real individual-session Auth/Data API/RLS matrix (15 recorded observations, module `acceptance-29.py`):

- Event-free report returns an explicit zero owner-contact count.
- The recorded `relation='owner'` link and an available phone decide disclosure and credit one property, even though the shared contact's global `contact_type` is `broker`.
- A same-key retry recovers the original event reference and Vietnam day with exactly one row.
- Two genuinely independent app sessions revealing with one shared key concurrently converge on one event and one property.
- Reusing that key for another property is rejected, including on the archived review path; the same recorded owner through another property counts another property.
- A broker-only relation and a recorded owner without a phone are explicit (`owner-contact-missing`, `owner-phone-missing`) and add no credit.
- Direct client `activity_events` INSERT remains denied.
- Archived review keeps contact access with `credited=false` and no new credit, while the ordinary employee receives `404`.
- Anonymous, unlinked and inactive identities are denied on both the app route and the direct RPC.

Rendered VI/default and EN browser journey on the local application against the hosted project:

- Opening the detail shows no owner phone, records no owner-contact credit, and leaves the panel at an explicit zero.
- A deliberate Show owner contact reveals the recorded phone with an accessible `tel:` Call link, no button afterwards (no copy control), `user-select: none`, and one credited property matching the live session report.
- After a deliberate reveal on an uncredited property, and with the initial today report already landed, the rendered today panel reaches the credited owner-contact count of `1` and keeps page views, distinct properties viewed and the owner-contact count as separate rows with explicit zeros. The ordering where the reveal settles before the initial today-report read is not reproduced by this harness and is therefore not proven by this run; the abort semantics the credited re-read relies on are covered by `src/features/properties/detail-loader.test.ts` ("an invalidated activity load cannot replace the next load").
- The rendered English metric label is `Owner-contact properties` and the Vietnamese label is `Bất động sản đã xem liên hệ chủ nhà`; both were asserted from the rendered today panel in the VI and EN passes.
- The Call click and VI→EN→VI switching keep the source phone string and create no extra credit event.
- A broker-only property shows the localized Vietnamese missing-data message and, after switching to English, the English message.
- The reviewer's archived disclosure shows the phone and adds no owner-contact credit.
- At the emulated 390×844 viewport the disclosure control is a focusable, labelled native `button`, activation reveals the phone, and `document.scrollWidth` stays within the viewport.

**Assertion restored.** The review round restored the strict acceptance assertion in `scripts/employee-access-acceptance.mjs`, which now asserts every recorded activity kind is `page_view`; the proof that opening, refocusing and re-rendering a detail records page views and nothing else is intact.

**Automation caveats (disclosed, not smoothed over).** The pinned `chrome-devtools-axi` 0.1.39 attached to a task-private headless Chromium over `BROWSER_URL`. On this host its `fill`/`click`/`press` did not reliably reach the refactored React auth form or controls below the fold, so the run drove the same real handlers through the input's native value setter plus an `input` event, the form's own `requestSubmit()`, and the control's own activation; the reveal click, language switching and mobile reveal used those paths. The Call assertion is the link's real `tel:` href plus an unchanged activity count, because following `tel:` in headless Chrome leaves the protected page. These are harness behaviours, not observed product failures; the underlying app handlers and endpoints are the real ones.

**Fixture cleanup.** The disjoint `SGN29` namespace (5 Auth users, 4 employees, 5 properties, 1 address, 3 contacts, 6 contact links) was created through the operator plane and fully removed through it after verifying each declared id by a read first; the synthetic Auth users were removed through the Auth-admin API. The measured baseline is identical before creation and after removal — 19 employees, 50 properties, 9 contacts, 7 property-contacts, 54 addresses and 127 activity events — with zero drift and no `SGN29` row or Auth user remaining. An earlier failed fixture attempt left four synthetic employee rows that the same tooling purged before the recorded run, which is why an intermediate snapshot showed 23 employees. The discussion slice recorded 125 activity events at its own restoration while this run measured 127 both before and after, so the two-event difference predates this task and is not attributable to it. The supplied development login and every pre-existing fixture were untouched, and the task's server, Chromium and bridge were stopped with ports 3103/9333/9953 free.

The Vietnam-midnight and next-day credit rules (a new next-day disclosure counts for that day, a pre-midnight disclosure retried after midnight keeps its day, device timezone changes do not affect credit) are proven by the embedded schema suite; no production backdating API was added.

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

## Property discussion staging acceptance

Scope: [ticket #44 shared Property discussion](database-contract.md#ticket-44--shared-property-discussion). Use isolated development/staging with real Supabase Auth, Data API/RLS, the actual VI/EN browser interface and independent connections for contention. Mocked authorization, embedded database checks and readiness pages cannot substitute for this evidence. The development-project run recorded below is scoped development evidence, not production acceptance.

Prepare two active sales employees with distinct properties, an active staff identity, a manager or admin reviewer, an inactive linked identity, an unlinked authenticated identity, and archived/unarchived properties carrying 35+ comments with deliberately tied posting times.

| Scenario | Required observation |
| --- | --- |
| Active employee opens another employee's protected property detail | Real protected detail loads its discussion; author name and Vietnam posting time show newest-first; posting succeeds without granting property-edit authority |
| Post Vietnamese text with accents and internal line breaks, then reload | Stored and displayed text is byte-identical to the trimmed input; `body` renders as plain text and HTML-like input cannot execute script |
| Submit blank, whitespace-only and 2001-character text through the browser and direct API/RPC | Localized validation on both boundaries; no comment row is created |
| Ambiguous or failed post (network dropped after commit, and before commit) with the draft retained; retry with the same submission key | Commit visible immediately; the failure is never reported as success; retry converges on one original comment identity and creates no duplicate; conflicting reuse of that key is rejected |
| Anonymous, inactive, unlinked and live-deactivated identities call the endpoint and the direct Data API/RPC with an existing JWT | Discussion rows are invisible, guarded RPCs answer `42501`/`403`, and refocus clears displayed discussion without cached protected navigation exposure |
| Manager/admin and an ordinary employee open an archived property detail | Reviewer reads archived discussion; ordinary employees do not; posting is denied for every role |
| Two real sessions: one posts while another archives the same property | The two serialize on the parent property row; the post either commits before the archive or is denied after it, never after the archive commits |
| Page a 35+ comment discussion with many identical posting times | Pages of 30 are newest-first, cursor-based and complete: no comment is omitted or duplicated across pages |
| Switch VI → EN → VI while the discussion is open | Labels, validation, empty and error states switch; source comment text, author names and the open property are unchanged |
| Keyboard-only and 360px mobile use of the comment form, refresh and paging controls | All controls are reachable and operable; focus and announcements work; no horizontal overflow |

Add embedded database regressions only for consumer-visible invariants and run `npm run test:schema` for schema/workflow changes. Browser, real Data API/RLS and separate-session contention remain distinct proof. Record sanitized observations without tokens, credentials, private source payloads or customer records.

### Executed ticket #44 development evidence

`docs/property-comments-acceptance.json` records the real hosted-development/local-build run (`checkedAt` in that file) produced by `scripts/property-comments-acceptance.mjs`. It exercises the actual Next.js application in real Chrome profiles at the configured origin, real Supabase Auth sessions and the direct Data API/RPC boundary against the authorized development project `tneucwzcrzteeixvttpu`, with `20261012001931_property_comments.sql` applied on that project. All 17 observation groups passed; the sanitized report holds the observed values.

The recorded run was repeated at the reconciled head after the default branch moved to the `#53` authentication-interface refactor, because that refactor changes the sign-in surface this journey starts from. The evidence in the report is that reconciled-head run, not a pre-refactor measurement carried forward. **Disclosure:** the refactor gave the sign-in language switch an `aria-label`, which changed its accessible name; the harness now selects the switch by its `lang` attribute and reads the active locale from the shell element. The control itself is still present on the sign-in page and the VI/EN journey it drives is unchanged, so this is a harness adaptation, not a product change or a missing control.

- The reviewed forward migration `20261012001931_property_comments.sql` was the only pending migration in the CLI dry-run and was applied through that path with no seeds or roles; the table, policy, immutability trigger and both public invoker wrappers exist afterwards.
- Browser journey: VI default detail with a visible empty discussion; a Vietnamese multi-line comment with accents posted and displayed immediately with its author and Vietnam posting time; HTML-like input retained literally with no element injected and no script executed; explicit refresh without duplication; 30-entry newest-first page plus a following page over 35 comments that all share one posting time, with no omission or duplication; VI → EN → VI switching that keeps source text, labels and the open property; a colleague reading and posting on another employee's property with no property-edit controls; sign-out followed by protected navigation showing no cached discussion; live deactivation clearing the displayed discussion on refocus and landing on the localized denial page with no comment text left in the document.
- Direct user-session boundary: anonymous and unlinked identities read no rows and are rejected by both RPCs; an inactive identity and a session established before deactivation read no rows and receive `42501` when posting; direct client insert/update/delete on the table are denied and the retained attribution, text and revision are unchanged; blank, whitespace-only, 2001-character and missing-key submissions are rejected at the database boundary while 2000 characters are accepted; the same employee submission key converges on one original comment identity, conflicting text or property reuse returns `23505`, a new key deliberately creates another comment, and unknown parameters cannot forge actor or time; the archived property's discussion is reviewer-readable and ordinary-employee invisible, posting is denied for every role, and recovery of the original key rechecks the archive state and is refused.
- Application routes: the discussion read returns `200` with `Cache-Control: private, no-store, max-age=0`, unknown fields and malformed cursors are `400`, an identical retry recovers the original comment, and conflicting reuse is `409 comment-conflict`.
- Post/archive race with competing real sessions: the parent property row was held while four rounds ran a real posting session against a real archiving session. In the recorded reconciled-head run the archive won all four rounds — each post was denied as archived and committed no comment — while the earlier pre-refactor run recorded two rounds each way. Both distributions are legal serializations; the assertion that holds in every round is the invariant: a denied post leaves no comment, a winning post leaves exactly one comment whose server posting time precedes the archive's own server-timestamped history marker, no round produces a duplicate, and a same-key retry after the archive is refused. The sanitized report carries the per-round outcome counts.

**Fixture handling and restoration.** The task created a disjoint `SGN-TEST-44` namespace only — four synthetic employees with linked Auth identities, one unlinked Auth identity, five synthetic properties with legacy addresses, and 35 synthetic paging comments — recorded in a private manifest outside Git. It removed exactly that namespace through the operator plane (comments first, then dependent rows, properties, employees and the Auth users) and re-read the full baseline: every original table's row count and id-hash matches the pre-acceptance baseline exactly (50 properties, 19 employees, 125 activity events, 39 property-history rows and all other original rows unchanged). The migration itself remains applied; it is the deliverable schema, not fixture data.

**Remaining limits.** This is scoped development evidence on the authorized dev project. It does not establish production acceptance, a full VI/EN accessibility audit, keyboard-only and 360px mobile operation of the new controls (the rows above remain the staging gates for those), sustained multi-session contention at production load, or any part of the parent specification's moderation slice. The operator connection holds the parent row for the race window, so the race is real-session evidence rather than a production-load contention benchmark.

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


## Company employee-by-day activity acceptance (ticket #31)

Scope: the company employee-by-day report of [issue #31](https://github.com/Leonard-Data/SGN-Inventory/issues/31). Real individual-session Auth, Data API and RLS checks, the live role-change denial, exact personal/company reconciliation and the rendered VI/default and EN journey are required; embedded PGlite assertions and mocked responses are not acceptance.

| Gate | Required observation |
| --- | --- |
| Manager/admin report | A live manager and a live admin can open `/activity/company` and read today's summary plus history covering today and the preceding 29 Vietnam calendar days, then select another valid inclusive range |
| Complete scope | Every currently active employee/date combination appears, including an employee with no events and a completely empty day, with explicit zeros rather than omitted rows |
| Metric definition | Page view events, distinct properties viewed and Daily owner-contact access count stay separate; for one employee/day the values equal that employee's personal today report and the eligible committed events |
| Daily property counting | One distinct property per employee/Vietnam day; two employees disclosing the same property each count their own; separate properties sharing an owner stay separate |
| Eligibility and retention | Missing-owner/phone, broker-only, denied and newly archived disclosures add no credit; earlier valid credit survives later archival and contact correction; no old page view or physical visit is converted |
| Authorization | Anonymous `401`; sales, staff, inactive and unlinked identities `403/access-denied` by direct navigation, direct report request and filter tampering; a manager→sales downgrade removes authority on the next request with the previously issued JWT; deactivation does the same |
| Session and cache boundary | Ordinary requests use the validated publishable-key session and RLS with no service-role fallback; responses stay private/no-store; sign-out, denial and refocus clear the protected report so Back or cached navigation cannot show it to another browser user |
| Dates | The period and calendar rows follow `Asia/Ho_Chi_Minh`; changing the browser timezone or the interface language does not move a fact between periods or create activity |
| Range validation | Malformed, partial, reversed and over-long ranges are rejected with `400/invalid-input` or `400/invalid-range`, and a scope above the Data API row cap with `400/range-too-large`, never executed or shown as a zero report or a short read |
| States and localization | Loading, failure, access denied and genuine zero activity remain distinguishable in both Vietnamese/default and English; changing language preserves filters and counts and rewrites no source record |
| Accessibility | Filters and the report table are keyboard reachable with accessible labels on a mobile viewport, and the metric is labelled Owner-contact access rather than attendance, hours, completed calls or physical visits |

Embedded coverage: `scripts/company-activity-contract.mjs` (invoked by `npm run test:schema`) asserts the live manager/admin boundary, the complete active-employee/date matrix with empty days, per-employee/day metric separation, shared-property and shared-owner counting, personal/company agreement, invalid-range and over-cap rejection, denied-disclosure exclusion, deactivation exclusion and post-archive/post-correction credit retention. `src/features/employees/report-range.test.ts` covers the Vietnam-day default and range validation.

**Executed on 12 October 2026 at head `78213aae5490a4200f701e6df3af66e1504b0e9a`** against the authorized development project `tneucwzcrzteeixvttpu` after the shared project was handed to this lane. `npm run test:schema` covers the same rules in embedded PostgreSQL; the live run below is separate evidence.

**Schema application (disclosed method).** The guarded inputs supply the database URL and owner capability; the connection string was read as data and passed through the environment only, never argv, never shell-sourced and never printed. Because the CLI database commands require the connection string as a command-line flag, `20261012095708_company_employee_daily_activity.sql` was applied over the owner connection inside one transaction and recorded in `supabase_migrations.schema_migrations` as version `20261012095708` exactly as the forward path records it. Verified afterwards: `public.company_employee_daily_activity` exists as `security invoker` and `private.company_employee_daily_activity` as a definer function with EXECUTE granted to `authenticated` alone, the schema cache resolves the function, and an anonymous publishable-key call returns `42501`. The corrected `20261012095708` function was then reconciled at the tested head through the owner connection without touching migration history: the history row count stayed at 22 and its `20261012095708` version row stayed at 1. No other migration, table, policy, grant or seed changed; the release path still owns future migration application.

**Disjoint fixture.** A synthetic `SGN31` namespace was created by exact ID: six linked employees (manager, admin, salesA, salesB, staff, inactive) plus one authenticated-unlinked identity, all with real individual Auth sessions. Existing inventory was used read-only: one unarchived owner-eligible property, one archived owner-eligible property for authorized review, and a second unarchived property for page views. Six committed activity rows were recorded through the delivered `record_property_activity` and `reveal_owner_contact` RPCs, including two independent reveals of one property by one employee and one reveal of the same property by a second employee.

Real individual-session observations recorded by `scripts/company-activity-acceptance.mjs` (34 groups, sanitized report outside Git):

- manager and admin read the report; anonymous, sales, staff, inactive and authenticated-unlinked identities are denied with `42501`;
- every active employee and every requested Vietnam day is present, including an employee with no events and a completely empty day; the corrected active-only scope returned 12 currently active employees over the 14-day request as 168 rows; the delivered single-day range agrees between the RPC and the application endpoint;
- page view events, distinct properties viewed and owner-contact properties stay separate per employee/day, the company today row equals the employee's own `my_today_activity` result, two employees disclosing one property each count their own and repeated reveals count one property;
- a manager-to-sales downgrade and a deactivation both deny the next request with the already-issued session, and restoration returns it;
- broker-only and archived review added no owner-contact credit, and direct `activity_events` mutation stays `42501`;
- the application endpoint returns `401` anonymous, `403` for sales and staff, `400/invalid-range` and `400/invalid-input` for invalid and malformed ranges, `400/range-too-large` for a scope above the Data API row cap, the 30-day default period, and explicit zeros;
- a live manager browser renders the Vietnamese today summary and separated metrics with explicit zero rows, the date filter selects a single-day range, switching to English preserves filters and counts and records no activity, a browser forced to `Pacific/Kiritimati` sees the same Vietnam period and counts, sign-out plus Back exposes no report, a sales employee navigating directly is denied, and a deactivation clears the report on refocus and denies it;
- no transient retry was needed in the recorded run (earlier harness iterations did hit one upstream connect timeout and one transient `503` render; the recorded run required none, and no assertion was relaxed to hide a failure — the denial observation accepts the localized access-denied state rather than only the exact redirect path).

**Fixture handling and restoration.** The namespace held 6 employees, 1 unlinked Auth identity and 6 activity rows; it was removed by exact ID through the service-role path (activity rows, then employees, then Auth identities) and no property, address, contact, link, file or reservation was created or changed. The measured baseline is identical before and after creation and removal — 19 employees and 127 activity events with matching sorted-id hashes — so every original row, both retained passes from the earlier maintenance slice and the unattributable rows are preserved. The task server, three private Chromium instances, their profiles and the private fixture manifest were stopped and removed; ports 3101/9331/9332/9333 are free.

**Not covered here.** Existing read-only inventory supplies no broker-only property, no unarchived owner without a phone and no owner shared across two properties, so those exclusion and separation cases rest on `npm run test:schema`; no production edge, load or performance testing is claimed.

## Personal activity over Vietnam date ranges acceptance (ticket #30)

Scope: the personal activity report of [issue #30](https://github.com/Leonard-Data/SGN-Inventory/issues/30). Real individual-session Auth, Data API and RLS checks and the rendered VI/default and EN journey are required; embedded PGlite assertions and mocked responses are not acceptance. The report reuses the metric definitions already accepted for ticket #31 and the personal today report, so the personal/company reconciliation gate is shared.

| Gate | Required observation |
| --- | --- |
| Personal report | An active employee opens `/activity/me` and reads today's summary plus a daily table initially covering today and the preceding 29 Vietnam calendar days, then selects another valid inclusive range |
| Complete range | Every requested Vietnam day appears exactly once, including a day with no recorded events and a period with no activity at all, with explicit zeros rather than omitted rows |
| Metric definition and agreement | Page view events, distinct properties viewed and Daily owner-contact access count stay separate per day; for one day the values equal the eligible committed `activity_events` for the employee and agree with the same employee's `my_today_activity` result and the company report row for that day |
| Daily property counting | Repeated reveals or several owners on one property count once per employee/Vietnam day; separate properties sharing an owner count separately; broker-only, missing-owner/phone, denied and archived-review disclosures add no credit |
| Retention and midnight | Earlier eligible credit survives a later property archive or contact correction; a retry of a committed pre-midnight disclosure stays in its original day while a new next-day disclosure belongs to that day |
| Own scope | Own-only for every role, including a reviewer whose RLS spans colleagues; no route, action or query input can request another employee's activity, and sales/staff cannot read a colleague's report |
| Authorization | Anonymous `401`; inactive and unlinked identities `403/access-denied` both by page navigation and by direct report request, for an identity deactivated after its JWT was issued |
| Session and cache boundary | Ordinary requests use the validated publishable-key session and RLS with no service-role fallback; responses stay private/no-store; sign-out, denial and refocus clear the protected report so Back or cached navigation cannot show it to another browser user |
| Dates | The period and calendar rows follow `Asia/Ho_Chi_Minh`; changing the browser timezone or the interface language does not move a fact between days or create activity |
| Range validation | Malformed, partial, reversed and over-long ranges are rejected with `400/invalid-input` or `400/invalid-range`, never executed or shown as a zero report |
| States and localization | Loading, access denied, query failure and a real zero period remain distinguishable in both Vietnamese/default and English; switching language preserves the selected range and the counts and records neither a new detail open nor an owner-contact disclosure |
| Accessibility | The date controls and the daily table are keyboard reachable with accessible labels on a mobile viewport, and the metric is labelled Owner-contact access rather than attendance, hours, completed calls or physical visits |

Embedded coverage: `scripts/my-activity-contract.mjs` (invoked by `npm run test:schema`) asserts the own-employee scope for a reviewer role whose RLS spans colleagues, exact per-metric/per-Vietnam-day values against the committed events, daily distinct-property counting with repeated reveals collapsed, explicit zero days, Vietnam-day attribution across the `16:59:59Z`/`17:00:00Z` midnight boundary with a session timezone change, same-period agreement with the `company_employee_daily_activity` row for every requested day including a zero day, rejection of reversed/null/over-long ranges with the 366-day boundary accepted, and anonymous/unlinked/inactive/deactivation denial. `src/features/employees/report-range.test.ts` covers the 30-day default period and the inclusive range validation the application applies before the read.

Hosted harness (written, not yet executed): `scripts/my-activity-acceptance.mjs` is written to perform the live pass above under its own `SGN30` fixture manifest (owner, colleague, manager, inactive and authenticated-unlinked identities plus committed activity rows for several Vietnam days and both midnight controls), reads the manager/admin company report for the same period and asserts the separated metrics agree per employee and day, asserts the rendered loading, query-failure, invalid-range, real zero-period and access-denied states in Vietnamese/default and English (including a genuine browser-offline transport failure with Retry recovery and the in-flight `[role=status]` state), reports every observation and restores the pre-acceptance baseline before exit. It reads the shipped design-system markup (`main table.data-table`, `form[action="/activity/me"]`, `#my-report-from`/`#my-report-to`, `#my-today-summary`, `.sgn-user-btn`/`.sgn-popover`); the ticket #31 harness still selects the pre-design-system `table.report-table`, `form.report-filter`, `header button` and `#today-summary` structure, so that harness needs its own selector reconciliation before it can be re-run at this head. That drift is recorded here rather than fixed in this slice. Recorded quality follow-up: the personal report surface deliberately mirrors the accepted ticket #31 company report component (same shell, filter and table vocabulary) rather than sharing an extracted report component; extracting it would refactor the shipped company surface and is left out of this slice. Recorded follow-up for firstmate: `scripts/company-activity-acceptance.mjs` carries the same missing rendered-assertion gap this slice closed for the personal harness — it captures `[role=alert]`/`[role=status]` but never asserts the loading, query-failure, invalid-range or real zero-period states — and is left to the ticket #31 lane rather than edited here.

**Not yet executed: hosted and browser acceptance.** The shared development project is serialized and held by another lane, so the live Auth/Data API/RLS and browser journey above have not been executed and no hosted evidence exists for this head. No hosted evidence, fixture manifest or restoration record is claimed for ticket #30 yet; the embedded assertions are not a substitute for it and the written harness claims nothing until it runs.

## Honest completion limits

Issue #1 has real development Supabase and scoped app/Auth/Data API/browser evidence, plus separately completed active/inactive/unlinked delivered recovery with fixture restoration; historical foundation-only evidence above remains separate. Spec #33 has the complete six-ticket private-files journey and real isolated-development browser/API/RLS/Storage acceptance documented above. Embedded Auth/Storage shims alone do not prove email delivery, signed URLs, HTTP deployment protections or cloud release correctness. Production rollout still requires the separate staging/release gates and authorization; imports, broader workflows and deployment are not part of this delivery. Independent Spec #33 review workers were quota-blocked; inline review and all resulting corrections were completed, but independent human PR review remains required.
