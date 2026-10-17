# Development conventions

## Stack and depth

One Next.js App Router application, TypeScript, React, plain CSS, Supabase Postgres/Auth/private Storage and Vercel. npm is the only JavaScript package manager. Node `24.14.0` and npm `11.13.0` are the reproducible local/CI baseline; Vercel uses Node `24.x`. The project minimum is stricter than the original Node 22+ requirement.

| Tool                               | Exact dependency                                 |
| ---------------------------------- | ------------------------------------------------ |
| Next.js / React / React DOM        | `16.4.0` / `19.3.0` / `19.3.0`                   |
| TypeScript                         | `6.0.3`                                          |
| Supabase JavaScript / SSR          | `2.117.3` / `0.12.7`                             |
| Supabase CLI / embedded PGlite     | `2.120.0` / `0.5.8`                              |
| Embedded PostgreSQL (schema races) | `18.4.0-beta.17`                                 |
| ESLint / Next lint configuration   | `9.39.5` / `16.4.0`                              |
| Prettier / Husky / lint-staged     | `3.9.9` / `9.1.7` / `17.6.0`                     |
| Vercel CLI                         | `63.1.2`                                         |
| Workbook tooling                   | Python `3.11+`, pinned `requirements-import.txt` |

`package.json` and `package-lock.json` are authoritative. Install with `npm ci`. Commit both when updating dependencies; never use an unpinned `npx ...@latest` in automation. ESLint 9 is intentional: the selected Next lint plugins do not all declare ESLint 10 support. Verify official documentation and peer requirements before upgrades.

Every workflow job that installs dependencies bootstraps pinned npm `11.13.0` after `setup-node` and before `npm ci`; selecting Node `24.14.0` alone supplies npm `11.9.0`, which the strict package engine correctly rejects. Keep the bootstrap version aligned with the package toolchain.

Maintenance caveat: npm marks ESLint `9.39.5` unsupported. It is retained for the selected Next plugins' declared compatibility, not treated as a long-term supported choice. Upgrade lint tooling when the complete plugin set supports a maintained major; do not hide peer conflicts with force/legacy-peer-deps. Python requirements also pin `et-xmlfile` and `tzdata` so Windows setup does not depend on a missing system IANA timezone database.

A **Module** puts substantial behavior behind one small **Interface**. Its Interface includes invariants, ordering, configuration, error modes and performance, not just TypeScript types. **Depth** gives callers **Leverage** and maintainers **Locality**. Prefer feature-level operations that hide bounded queries, input validation and error interpretation, not thin generic CRUD forwarding.

A **Seam** is where the Interface lives; an **Adapter** satisfies it. Do not introduce repository/provider hierarchies for a single adapter. Accept dependencies when they genuinely vary, return results rather than mutate caller state, and test through the same Interface callers use. The deletion test: a useful Module's deletion redistributes complexity into callers; deleting a pass-through just removes complexity.

The implemented environment Module is an example: `readEnvironment(values, expectedProjectRef?)` centralizes stage/origin/key validation for runtime and release callers. Release checks additionally centralize branch and cross-stage target selection. Neither introduces a hypothetical adapter hierarchy.

## Source layout

Implemented foundation, employee-access, private-file and issue #7 maintenance slices:

```text
src/
  app/
    layout.tsx                 # Root rendering and metadata
    page.tsx                   # Redirect to protected inventory
    login/, access-denied/     # Localized sign-in and explicit membership denial
    recover/, reset-password/  # Real delivered recovery, including denied identities
    properties/                # Protected browse and read-only details
    auth/                      # PKCE/token-hash recovery callbacks
    api/                       # Validated auth/session/inventory/locale + health
    globals.css                # Shared responsive presentation
    sgn-auth.css               # Canonical authentication tokens + components (#50)
    design/auth-preview/       # Isolated review-only design preview (#50)
  proxy.ts                     # Session refresh, live membership and saved locale
  features/employees/          # Membership guard, auth screens/shell/controls, protected state
  features/properties/         # Bounded queries, details, page views and formatting
  features/property-files/     # Private file read workspace, types, signed URLs
  features/property-maintenance/ # Create/edit maintenance, address/contact forms, history
  features/corrections/        # Correction submission, queue and amendment rendering
  features/property-comments/  # Shared Property discussion, submission-key recovery, paging and comment removal
  features/vendors/            # Vendor directory reads, guarded create, one optional contact block and explicit property links
  features/contacts/           # Shared-contact directory read, view rules and correction data access
  features/sales/              # Sale completion confirmation, completed-sale ranking and boundary rules
  i18n/messages.ts             # Equivalent typed VI/EN journey dictionaries
  lib/supabase/route.ts         # User-scoped SSR cookies/cache/input boundary
  types/database.ts            # Generated from the live dev public schema
  lib/environment.ts           # Pure validated environment Interface
  lib/environment.test.ts      # Configuration invariants
scripts/
  check-environment.mjs         # Operator-facing configuration check
  release-guard.mjs             # Branch/project isolation, pending migrations and release smoke
  release-guard.test.mjs        # Cross-stage regression risks
  validate-schema.mjs           # Existing embedded SQL assertions
  audit-retention-contract.mjs  # Embedded private audit-retention regressions
  maintenance-contract.mjs      # Embedded maintenance/history regressions
  correction-contract.mjs       # Embedded correction-workflow regressions
  comments-contract.mjs         # Embedded discussion role/validation/retry/paging regressions
  comment-removal-contract.mjs  # Embedded removal authority, retention and terminal-state regressions
  vendor-contract.mjs           # Embedded vendor authority, validation, retry and paging regressions
  property-vendor-links-contract.mjs # Embedded property-vendor link authority, correction and history regressions
  vendor-acceptance.mjs         # Hosted vendor-directory and property-vendor-link acceptance harnesses (see testing.md)
  contact-directory-contract.mjs    # Embedded shared-contact directory read/correction regressions
  contact-directory-acceptance.mjs  # Hosted real browser/Supabase contact-directory acceptance (executed 17 October 2026)
  sale-completion-contract.mjs   # Embedded sale-completion authority, atomicity, retry and ranking regressions
  sale-completion-acceptance.mjs # Written real browser/Supabase sale-completion acceptance (not yet executed here)
  employee-access-acceptance.mjs # Real app/browser/Auth/RLS dev fixture acceptance
  auth-visual-compare.mjs        # Exact-viewport auth design comparison vs preserved prototype
  prepare_workbook.py           # Existing private, dry-run preparation
  test_preparation.py
supabase/
  migrations/                  # Physical schema authority
  tests/                       # Real local Supabase structural checks
.github/workflows/             # CI; gated PR previews, main production, explicit DB changes
.husky/pre-commit
```

Create additional feature directories only for approved backlog work. Employee access, read-only inventory, private files and issue #7 maintenance/corrections are implemented; the shared Property discussion (#44) has its development-project acceptance executed, with staging/production and keyboard-only/360px mobile gates still unexecuted; issue #45's comment removal and moderation is implemented on that discussion, with its hosted acceptance executed at application head `45f356a` ([testing.md](testing.md#ticket-45-removal-acceptance-executed-13-october-2026)); staging/production and keyboard-only/360px mobile gates remain unexecuted; issue #18's reservation request and independent decision is implemented on the property detail, with its acceptance evidence and remaining gates in [testing.md](testing.md#reservation-acceptance-ticket-18); issue #38's independently confirmed sale completion and completed-sale ranking is implemented on the property detail and `/reports/completed-sales`, with embedded/unit regressions and a written but unexecuted real-browser acceptance harness ([testing.md](testing.md#sale-completion-acceptance-issue-38)); issue #65's admin employee list is implemented with its hosted acceptance harness written but not yet executed, and issue #73's vendor directory is implemented with its hosted acceptance executed at the reviewed head `2a1d69c` ([testing.md](testing.md#vendor-directory-acceptance-issue-73)); issue #71's shared-contact directory is implemented at `/people/contacts` with its hosted acceptance executed on 17 October 2026, subject to the gates recorded there ([testing.md](testing.md#contact-directory-acceptance-ticket-71)); issue #74's property vendor links are implemented on the property record and the vendor detail, with embedded/unit regressions and its hosted acceptance executed at the reviewed head `86e397a` after the stale-context code was corrected to `PT409`; that historical run executed against the pre-removal schema, which wrote `vendor_link` rows in `public.property_history` for link and unlink and whose harness asserted those rows, while the current head projects none because the trigger is dropped and history stays price-only; it also predates the approved all-active-employee authority, so current hosted proof remains pending ([testing.md](testing.md#property-vendor-link-acceptance-issue-74)); rental and remaining UI work is tracked in [delivery-plan.md](delivery-plan.md). The real-mailbox recovery gate prevents claiming completed issue #1 acceptance.

- `src/app/`: route composition, presentation, narrow validated Server Actions/Route Handlers. No direct inventory SQL/query orchestration in rendering.
- `src/features/<feature>/`: validation, feature data access, domain results and workflow operations; keep feature-specific rendering beside the feature when useful. Export a small Interface, not every internal helper.
- `src/lib/supabase/route.ts`: one request-scoped server/refresh adapter following current official SSR guidance. Browser code calls same-origin application endpoints; no application-global server client or privileged fallback.
- `src/components/`: shared presentation only after actual reuse; not a dumping ground for business rules.
- `src/i18n/`: typed equivalent VI/EN dictionaries. `src/types/database.ts`: CLI-generated live public-schema types, never handwritten copies.

## Coding rules

- Two spaces, UTF-8, LF, final newline. Prettier owns JavaScript/TypeScript/JSON/CSS/YAML/Markdown formatting. Python uses four spaces. Existing migrations, schema runner and historical contract documents retain their formatting; do not rewrite deployed SQL for style.
- TypeScript strict mode and `noUncheckedIndexedAccess`. Avoid `any`, unexplained type assertions and unsafe number conversions. Let local inference work; specify exported inputs/results. Use `unknown` for untrusted data and validate before use.
- camelCase values/functions, PascalCase types and React rendering functions, descriptive kebab-case ordinary filenames; preserve Next file conventions and existing names. Use `@/` imports inside the app, explicit `.ts` imports only for native Node test/tool entry points and the modules those entry points load.
- Server rendering by default; add `'use client'` only for necessary interaction. Keep effects and client state small. Do not add state libraries, styling frameworks, telemetry or abstractions without an approved need.
- Validate every external input, including Route Handlers and Server Actions. Expose localized actionable validation, access-denied and conflict results; keep raw database errors and diagnostics private. No exception suppression or privileged fallback to make a failing query appear successful.
- No shared public caching of sessions, employee/contact/inventory data or document URLs. Health returns only configuration readiness, not keys, connection details or employee data. It does not prove database connectivity or authorization.

## Security and domain contract

Read [CONTEXT.md](../CONTEXT.md), [database-contract.md](database-contract.md) and the migration SQL before feature changes. Foundation setup does not change their authorization/business contract.

- Ordinary requests use the publishable key and user's session, with RLS. Validate the session server-side with the official SSR guidance, never trust raw `getSession()` or editable user metadata; check live employee membership.
- `src/proxy.ts` implements session refresh and protected-page membership using the current convention. Route responses and proxy redirects retain refreshed cookies and SDK cache headers, with private/no-store headers on protected responses.
- New exposed tables require grants and RLS in the same new migration. Views use `security_invoker = true`. Privileged internals live in `private`, fixed search path, default EXECUTE revoked, live role checked; public wrappers remain invoker functions.
- Preserve property-before-lock and property → agreement → month → payment locking order. Use the contract RPCs rather than several client writes. Preserve independent review, idempotency, receipt history and one active whole-property rental.
- Preserve legacy addresses, source text, phone strings, integer VND and m². Current addresses contain no district. Never infer relationships from sheet position or guess partial ward mappings.
- All feature navigation, forms, errors, notifications and dashboards must support `vi` and `en`. Protected employee language persistence uses `set_my_locale`; pre-auth `lang`/locale cookies are presentation only. Do not translate stored source records. Vietnam business dates come from the database.
- Check `npx supabase migration new --help`, then create a new migration with the pinned CLI. Never rewrite a deployed migration. Contract changes update `CONTEXT.md` and `docs/database-contract.md` together and add invariant/regression evidence.

## Checks and contribution flow

1. Branch from `develop` for feature work; use descriptive `feat/...`, `fix/...` or `chore/...` names. Pull requests target `develop`; reviewed releases merge to `main`. No direct production pushes. Once the external protection/configuration gates in [setup.md](setup.md) exist and the stage-scoped switches are set, same-repository PRs receive dev-only Vercel previews under `CD_PREVIEW_ENABLED`, a `develop`/`stage=dev` dispatch releases the stable dev review site under `CD_DEV_ENABLED`, and `main` releases production under `CD_PROD_ENABLED` after CI and a verify-only database check. Every switch is off by default and no stage's switch can start another stage's run; `CD_PROD_ENABLED` stays unset until staging acceptance and a separate production release decision. Database application stays explicitly authorized; native Vercel Git deployment stays disabled.
2. `npm run format` formats supported nonignored files. `npm run check` checks formatting, lint, types, environment/release regressions and embedded schema behavior. `npm run test:import` covers workbook preparation; `npm run build` proves Next compilation.
3. Commit hooks format only staged supported files, then run lint, type checking and `npm test`. The hook stops on the first failure. Python preparation and production build run in CI rather than every commit. `npm ci` installs the hook through `prepare`; CI sets `HUSKY=0`.
4. Test uncertain consumer-visible invariants, transitions, precedence, authorization and boundaries through the Module's Interface. No mock echoes, source-string tests or incidental wording/default assertions. Preserve deterministic isolated fixtures; tests must never need production credentials.
5. Pull requests explain approved scope, contract changes, exercised verification and remaining limits. Use imperative scoped commit messages such as `chore: configure isolated release environments`; no mandatory commit-message hook.
6. CI is required for merges. Hooks are convenience, not security gates; bypassing them does not bypass CI. Never commit workbooks, staging JSONL, legal files, credentials or real customer fixtures.

Embedded PostgreSQL and readiness HTTP checks are not real Supabase Auth/Data API/RLS/Storage or inventory browser acceptance. Those remain the gates in [testing.md](testing.md).

### Real employee-access development acceptance

Use an already-running local build against the separately authorized dev project. Keep credentials and the private synthetic fixture manifest outside Git. An ignored `.env.acceptance.local` may contain only `SGN_ACCEPTANCE_FIXTURES=<absolute private manifest path>` and `SGN_ACCEPTANCE_OPERATOR=<absolute private operator config path>`; the manifest supplies accepted active/inactive/unlinked/operator identities, their private passwords and exact synthetic property IDs, and the operator config supplies the owner SQL connection (`dbUrl`) used to toggle the synthetic employee's activation, since the lifecycle guard refuses direct client writes.

Run `node --env-file=.env.local --env-file=.env.acceptance.local scripts/employee-access-acceptance.mjs --allow-deactivation --report docs/employee-access-acceptance.json` only with concrete authorization to deactivate/reactivate the named synthetic employee. The script verifies dev stage/project and fixture ownership, restores activation in `finally`, uses real user/publishable sessions and separate Chrome user-data directories, and never treats mocked RLS or generated recovery links as email delivery. Consult `chrome-devtools-axi --help` before use. Its automated report excludes human-coordinated mailbox recovery; active, inactive and unlinked delivered cases separately passed and the dedicated recovery fixture was restored. Use both evidence sources for scoped issue #1 acceptance; neither establishes full MVP or production completion.

## References

- [Next.js installation and App Router tooling](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase cookie-based SSR clients and session/cache rules](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Vercel environments and first-deployment behavior](https://vercel.com/docs/deployments/environments)
