# SGN Inventory — MVP foundation

Stack: **Next.js App Router + TypeScript**, **Supabase Postgres/Auth/Storage**, **Vercel**.
Prepared 10 October 2026 for <https://github.com/Leonard-Data/SGN-Inventory>.

This package contains the database foundation, workbook preparation, issue #1 employee access and Spec #33's private Property file workspace: actual-content validation, interrupted-upload recovery, company Document categories, authorized category correction and explicit private cover photos. **It is not a completed inventory application or production release.** Real delivered mailbox/password recovery passed for active, inactive and unlinked identities. The file/category/cover slices were exercised through real authenticated browsers and Supabase Auth/Data API/RLS/Storage on the authorized development project, with synthetic fixture restoration. Broader MVP workflows remain planned. Twelve forward migrations are connected; no customer workbook import or Vercel deployment was performed.

The first release is a shared property inventory: search addresses and characteristics, inspect owner/broker contacts and documents, record employee activity, and reserve a property after independent approval. An approved reservation records **commission attribution**, with no commission calculation or payout. Rental agreements include month-by-month occupancy/dues and manually recorded rent receipts/refunds. Vietnamese and English UI support is mandatory.

Start with [CONTEXT.md](CONTEXT.md), then [docs/architecture.md](docs/architecture.md), [docs/schema.md](docs/schema.md) and [docs/migration-plan.md](docs/migration-plan.md). [docs/database-contract.md](docs/database-contract.md) is the application/agent API contract. [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) guide coding agents.

For engineering setup, start with [docs/setup.md](docs/setup.md) and [docs/development.md](docs/development.md): pinned stack, coding conventions, source layout, Windows/POSIX setup, hooks, CI and isolated `dev`/`prod` releases.

## Included work

| Path                                                    | Purpose                                                                                                    |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/`                                  | Twelve migrations: foundation, search, archived views and the complete private-file/category/cover contract |
| `supabase/config.toml`                                  | Local configuration; only `public` is exposed; open signup disabled                                        |
| `scripts/prepare_workbook.py`                           | Read-only analysis; optional credential-free local staging                                                 |
| `scripts/validate-schema.mjs`                           | Executes migrations and authorization/business assertions in embedded PostgreSQL                           |
| `docs/workbook-profile.json`                            | Sanitized full-workbook counts and migration issues                                                        |
| `docs/workbook-mapping.md`                              | Actual source columns and transformation rules                                                             |
| `docs/address-model.md`                                 | Legacy/current addresses, official versions and ambiguous boundary changes                                 |
| `docs/rental-localization-contract.md`                  | Mandatory VI/EN UI, rental lifecycle, active months, dues and manual receipts/refunds                      |
| `docs/workflows-security.md`                            | Employee roles, approvals, KPIs and file access                                                            |
| `docs/delivery-plan.md`                                 | Next.js structure, implementation order and acceptance gates                                               |
| `docs/validation-results.json`                          | Actual test results with explicit limitations                                                              |
| `src/app/`, `src/features/`, `src/i18n/`, `src/lib/`    | Employee access and private-file/category/cover routes, user-scoped data access, VI/EN UI and configuration health |
| `.github/workflows/`                                    | Read-only CI; manually gated app deployment and database dry-run/apply                                     |
| `.husky/pre-commit`                                     | Staged formatting, lint, types and JavaScript/schema tests                                                 |
| `.env.example`, `.env.dev.example`, `.env.prod.example` | Credential-free local/dev/prod configuration examples                                                      |
| `scripts/employee-access-acceptance.mjs`                | Reusable real-browser/application/Supabase development acceptance; no mocked authorization                 |

## Required initial setup and local verification

Use Node.js `24.14.0` and npm `11.14.1`. Agent-assisted project setup requires the official GitHub CLI (`gh`), Chrome and all three agent CLIs. Install missing agent CLIs globally and verify them before project work; they are not application dependencies:

```bash
npm install --global gh-axi@0.1.36 chrome-devtools-axi@0.1.39 lavish-axi@0.1.85
gh-axi --version
chrome-devtools-axi --version
lavish-axi --version
npm ci
npm run check
npm run build
npm run dev
```

Copy `.env.example` to ignored `.env.local`, supply the intended dev publishable credentials, expected project reference, private file-validation key and exact local origin, then run `npm run check:env`. Open `/login` (VI by default) or `/login?lang=en`; successful login loads the saved employee preference. Spec #33's isolated worktree used `http://localhost:3038`, leaving the user's existing server untouched. See [executed acceptance](docs/testing.md) for scoped browser/Supabase evidence and private fixture prerequisites.

Authenticate the official GitHub CLI for GitHub work. Use `gh-axi` for GitHub, `chrome-devtools-axi` for browser work and `lavish-axi` for visual decisions/reports; consult current command help before use. See [required agent setup](docs/setup.md#required-initial-setup-agent-command-line-tools) for prerequisites, `PATH` guidance and authorization boundaries. Optional agent hooks/plugins are not required.

For the full local Supabase stack, install Docker, inspect `npx supabase start --help` and `npx supabase db reset --help`, then start/reset a **local** project. These migrations are for a fresh database; do not apply them unreviewed to an existing CRM.

Workbook profiling (Python 3.11+):

```bash
python -m pip install -r requirements-import.txt
python scripts/prepare_workbook.py /secure/Databases.xlsx --out /secure/import-run
```

Add `--stage` only to create private local staging records. Never commit the workbook, staging files, customer contacts, passwords, legal files or credentials.

## GitHub approval

GitHub publication was approved on 10 October 2026. The remote now contains `main`; the connected account has repository write access. This engineering setup does not push repository changes or trigger deployments. Supabase provisioning, customer-data import and cloud deployment remain separate authorization scopes.
