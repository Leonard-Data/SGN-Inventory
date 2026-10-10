# Development conventions

## Stack and depth

One Next.js App Router application, TypeScript, React, plain CSS, Supabase Postgres/Auth/private Storage and Vercel. npm is the only JavaScript package manager. Node `24.14.0` and npm `11.14.1` are the reproducible local/CI baseline; Vercel uses Node `24.x`. The project minimum is stricter than the original Node 22+ requirement.

| Tool                             | Exact dependency                                 |
| -------------------------------- | ------------------------------------------------ |
| Next.js / React / React DOM      | `16.4.0` / `19.3.0` / `19.3.0`                   |
| TypeScript                       | `6.0.3`                                          |
| Supabase JavaScript / SSR        | `2.117.3` / `0.12.7`                             |
| Supabase CLI / embedded PGlite   | `2.120.0` / `0.5.8`                              |
| ESLint / Next lint configuration | `9.39.5` / `16.4.0`                              |
| Prettier / Husky / lint-staged   | `3.9.9` / `9.1.7` / `17.6.0`                     |
| Vercel CLI                       | `63.1.2`                                         |
| Workbook tooling                 | Python `3.11+`, pinned `requirements-import.txt` |

`package.json` and `package-lock.json` are authoritative. Install with `npm ci`. Commit both when updating dependencies; never use an unpinned `npx ...@latest` in automation. ESLint 9 is intentional: the selected Next lint plugins do not all declare ESLint 10 support. Verify official documentation and peer requirements before upgrades.

All three GitHub workflows install pinned npm `11.14.1` after `setup-node` and before `npm ci`; selecting Node `24.14.0` alone supplies npm `11.9.0`, which the strict package engine correctly rejects. Keep the bootstrap version aligned with the package toolchain.

Maintenance caveat: npm marks ESLint `9.39.5` unsupported. It is retained for the selected Next plugins' declared compatibility, not treated as a long-term supported choice. Upgrade lint tooling when the complete plugin set supports a maintained major; do not hide peer conflicts with force/legacy-peer-deps. Python requirements also pin `et-xmlfile` and `tzdata` so Windows setup does not depend on a missing system IANA timezone database.

A **Module** puts substantial behavior behind one small **Interface**. Its Interface includes invariants, ordering, configuration, error modes and performance, not just TypeScript types. **Depth** gives callers **Leverage** and maintainers **Locality**. Prefer feature-level operations that hide bounded queries, input validation and error interpretation, not thin generic CRUD forwarding.

A **Seam** is where the Interface lives; an **Adapter** satisfies it. Do not introduce repository/provider hierarchies for a single adapter. Accept dependencies when they genuinely vary, return results rather than mutate caller state, and test through the same Interface callers use. The deletion test: a useful Module's deletion redistributes complexity into callers; deleting a pass-through just removes complexity.

The implemented environment Module is an example: `readEnvironment(values, expectedProjectRef?)` centralizes stage/origin/key validation for runtime and release callers. Release checks additionally centralize branch and cross-stage target selection. Neither introduces a hypothetical adapter hierarchy.

## Source layout

Implemented foundation and employee-access slice:

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
  proxy.ts                     # Session refresh, live membership and saved locale
  features/employees/          # Membership guard, auth screens, protected state
  features/properties/         # Bounded queries, details, page views and formatting
  features/property-files/     # Private file read workspace, types, signed URLs
  i18n/messages.ts             # Equivalent typed VI/EN journey dictionaries
  lib/supabase/route.ts         # User-scoped SSR cookies/cache/input boundary
  types/database.ts            # Generated from the live dev public schema
  lib/environment.ts           # Pure validated environment Interface
  lib/environment.test.ts      # Configuration invariants
scripts/
  check-environment.mjs         # Operator-facing configuration check
  release-guard.mjs             # Branch/project isolation and release smoke
  release-guard.test.mjs        # Cross-stage regression risks
  validate-schema.mjs           # Existing embedded SQL assertions
  employee-access-acceptance.mjs # Real app/browser/Auth/RLS dev fixture acceptance
  prepare_workbook.py           # Existing private, dry-run preparation
  test_preparation.py
supabase/
  migrations/                  # Physical schema authority
  tests/                       # Real local Supabase structural checks
.github/workflows/             # CI; explicit app and database release
.husky/pre-commit
```

Create additional feature directories only for approved backlog work. Employee access and read-only inventory are implemented; reservation, rental and maintenance UI remains in [delivery-plan.md](delivery-plan.md). The real-mailbox recovery gate prevents claiming completed issue #1 acceptance.

- `src/app/`: route composition, presentation, narrow validated Server Actions/Route Handlers. No direct inventory SQL/query orchestration in rendering.
- `src/features/<feature>/`: validation, feature data access, domain results and workflow operations; keep feature-specific rendering beside the feature when useful. Export a small Interface, not every internal helper.
- `src/lib/supabase/route.ts`: one request-scoped server/refresh adapter following current official SSR guidance. Browser code calls same-origin application endpoints; no application-global server client or privileged fallback.
- `src/components/`: shared presentation only after actual reuse; not a dumping ground for business rules.
- `src/i18n/`: typed equivalent VI/EN dictionaries. `src/types/database.ts`: CLI-generated live public-schema types, never handwritten copies.

## Coding rules

- Two spaces, UTF-8, LF, final newline. Prettier owns JavaScript/TypeScript/JSON/CSS/YAML/Markdown formatting. Python uses four spaces. Existing migrations, schema runner and historical contract documents retain their formatting; do not rewrite deployed SQL for style.
- TypeScript strict mode and `noUncheckedIndexedAccess`. Avoid `any`, unexplained type assertions and unsafe number conversions. Let local inference work; specify exported inputs/results. Use `unknown` for untrusted data and validate before use.
- camelCase values/functions, PascalCase types and React rendering functions, descriptive kebab-case ordinary filenames; preserve Next file conventions and existing names. Use `@/` imports inside the app, explicit `.ts` imports only for native Node test/tool entry points.
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

1. Branch from `develop` for feature work; use descriptive `feat/...`, `fix/...` or `chore/...` names. Pull requests target `develop`; reviewed releases merge to `main`. No direct production pushes.
2. `npm run format` formats supported nonignored files. `npm run check` checks formatting, lint, types, environment/release regressions and embedded schema behavior. `npm run test:import` covers workbook preparation; `npm run build` proves Next compilation.
3. Commit hooks format only staged supported files, then run lint, type checking and `npm test`. The hook stops on the first failure. Python preparation and production build run in CI rather than every commit. `npm ci` installs the hook through `prepare`; CI sets `HUSKY=0`.
4. Test uncertain consumer-visible invariants, transitions, precedence, authorization and boundaries through the Module's Interface. No mock echoes, source-string tests or incidental wording/default assertions. Preserve deterministic isolated fixtures; tests must never need production credentials.
5. Pull requests explain approved scope, contract changes, exercised verification and remaining limits. Use imperative scoped commit messages such as `chore: configure isolated release environments`; no mandatory commit-message hook.
6. CI is required for merges. Hooks are convenience, not security gates; bypassing them does not bypass CI. Never commit workbooks, staging JSONL, legal files, credentials or real customer fixtures.

Embedded PostgreSQL and readiness HTTP checks are not real Supabase Auth/Data API/RLS/Storage or inventory browser acceptance. Those remain the gates in [testing.md](testing.md).

### Real employee-access development acceptance

Use an already-running local build against the separately authorized dev project. Keep credentials and the private synthetic fixture manifest outside Git. An ignored `.env.acceptance.local` may contain only `SGN_ACCEPTANCE_FIXTURES=<absolute private manifest path>`; the manifest supplies accepted active/inactive/unlinked/operator identities, their private passwords and exact synthetic property IDs.

Run `node --env-file=.env.local --env-file=.env.acceptance.local scripts/employee-access-acceptance.mjs --allow-deactivation --report docs/employee-access-acceptance.json` only with concrete authorization to deactivate/reactivate the named synthetic employee. The script verifies dev stage/project and fixture ownership, restores activation in `finally`, uses real user/publishable sessions and separate Chrome user-data directories, and never treats mocked RLS or generated recovery links as email delivery. Consult `chrome-devtools-axi --help` before use. Its automated report excludes human-coordinated mailbox recovery; active, inactive and unlinked delivered cases separately passed and the dedicated recovery fixture was restored. Use both evidence sources for scoped issue #1 acceptance; neither establishes full MVP or production completion.

## References

- [Next.js installation and App Router tooling](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase cookie-based SSR clients and session/cache rules](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Vercel environments and first-deployment behavior](https://vercel.com/docs/deployments/environments)
