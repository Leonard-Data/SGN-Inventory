# SGN Inventory — MVP foundation

Stack: **Next.js App Router + TypeScript**, **Supabase Postgres/Auth/Storage**, **Vercel**.
Prepared 10 October 2026 for <https://github.com/Leonard-Data/SGN-Inventory>.

This package contains the database foundation, executable schema migrations, workbook preparation, and a runnable bilingual Next.js readiness page with development/release tooling. It is **not a working inventory application**: employee sign-in and inventory workflows remain planned. No customer data has been imported and this setup has not provisioned or deployed Supabase/Vercel resources.

The first release is a shared property inventory: search addresses and characteristics, inspect owner/broker contacts and documents, record employee activity, and reserve a property after independent approval. An approved reservation records **commission attribution**, with no commission calculation or payout. Rental agreements include month-by-month occupancy/dues and manually recorded rent receipts/refunds. Vietnamese and English UI support is mandatory.

Start with [CONTEXT.md](CONTEXT.md), then [docs/architecture.md](docs/architecture.md), [docs/schema.md](docs/schema.md) and [docs/migration-plan.md](docs/migration-plan.md). [docs/database-contract.md](docs/database-contract.md) is the application/agent API contract. [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) guide coding agents.

For engineering setup, start with [docs/setup.md](docs/setup.md) and [docs/development.md](docs/development.md): pinned stack, coding conventions, source layout, Windows/POSIX setup, hooks, CI and isolated `dev`/`prod` releases.

## Included work

| Path                                                    | Purpose                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `supabase/migrations/`                                  | Four migrations: core, RLS/workflows, storage/search/analytics, rentals and language preferences |
| `supabase/config.toml`                                  | Local configuration; only `public` is exposed; open signup disabled                              |
| `scripts/prepare_workbook.py`                           | Read-only analysis; optional credential-free local staging                                       |
| `scripts/validate-schema.mjs`                           | Executes migrations and authorization/business assertions in embedded PostgreSQL                 |
| `docs/workbook-profile.json`                            | Sanitized full-workbook counts and migration issues                                              |
| `docs/workbook-mapping.md`                              | Actual source columns and transformation rules                                                   |
| `docs/address-model.md`                                 | Legacy/current addresses, official versions and ambiguous boundary changes                       |
| `docs/rental-localization-contract.md`                  | Mandatory VI/EN UI, rental lifecycle, active months, dues and manual receipts/refunds            |
| `docs/workflows-security.md`                            | Employee roles, approvals, KPIs and file access                                                  |
| `docs/delivery-plan.md`                                 | Next.js structure, implementation order and acceptance gates                                     |
| `docs/validation-results.json`                          | Actual test results with explicit limitations                                                    |
| `src/app/`, `src/i18n/`, `src/lib/`                     | Bilingual readiness page, configuration health and validated environment Module                  |
| `.github/workflows/`                                    | Read-only CI; manually gated app deployment and database dry-run/apply                           |
| `.husky/pre-commit`                                     | Staged formatting, lint, types and JavaScript/schema tests                                       |
| `.env.example`, `.env.dev.example`, `.env.prod.example` | Credential-free local/dev/prod configuration examples                                            |

## Verify locally

Use Node.js `24.14.0` and npm `11.14.1`, then:

```bash
npm ci
npm run check
npm run build
npm run dev
```

Open `http://localhost:3000` (Vietnamese) or `/?lang=en`. Copy `.env.example` to ignored `.env.local`, supply local/dev publishable credentials and run `npm run check:env` to enable configuration health. See the setup runbook for Python checks and optional Docker/Supabase verification.

For the full local Supabase stack, install Docker, inspect `npx supabase start --help` and `npx supabase db reset --help`, then start/reset a **local** project. These migrations are for a fresh database; do not apply them unreviewed to an existing CRM.

Workbook profiling (Python 3.11+):

```bash
python -m pip install -r requirements-import.txt
python scripts/prepare_workbook.py /secure/Databases.xlsx --out /secure/import-run
```

Add `--stage` only to create private local staging records. Never commit the workbook, staging files, customer contacts, passwords, legal files or credentials.

## GitHub approval

GitHub publication was approved on 10 October 2026. The remote now contains `main`; the connected account has repository write access. This engineering setup does not push repository changes or trigger deployments. Supabase provisioning, customer-data import and cloud deployment remain separate authorization scopes.
