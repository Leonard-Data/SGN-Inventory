# SGN Inventory — MVP foundation

Stack: **Next.js App Router + TypeScript**, **Supabase Postgres/Auth/Storage**, **Vercel**.
Prepared 10 October 2026 for <https://github.com/Leonard-Data/SGN-Inventory>.

This package contains the proposed database, executable schema migrations, a workbook staging tool, verification, and the development contract. It does not yet contain a working Next.js application. No customer data has been imported and no Supabase or Vercel resource has been modified. GitHub publication was approved on 10 October 2026; the connected account needs repository write access.

The first release is a shared property inventory: search addresses and characteristics, inspect owner/broker contacts and documents, record employee activity, and reserve a property after independent approval. An approved reservation records **commission attribution**, with no commission calculation or payout. Rental agreements include month-by-month occupancy/dues and manually recorded rent receipts/refunds. Vietnamese and English UI support is mandatory.

Start with [CONTEXT.md](CONTEXT.md), then [docs/architecture.md](docs/architecture.md), [docs/schema.md](docs/schema.md) and [docs/migration-plan.md](docs/migration-plan.md). [docs/database-contract.md](docs/database-contract.md) is the application/agent API contract. [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) guide coding agents.

## Included work

| Path | Purpose |
| --- | --- |
| `supabase/migrations/` | Four migrations: core, RLS/workflows, storage/search/analytics, rentals and language preferences |
| `supabase/config.toml` | Local configuration; only `public` is exposed; open signup disabled |
| `scripts/prepare_workbook.py` | Read-only analysis; optional credential-free local staging |
| `scripts/validate-schema.mjs` | Executes migrations and authorization/business assertions in embedded PostgreSQL |
| `docs/workbook-profile.json` | Sanitized full-workbook counts and migration issues |
| `docs/workbook-mapping.md` | Actual source columns and transformation rules |
| `docs/address-model.md` | Legacy/current addresses, official versions and ambiguous boundary changes |
| `docs/rental-localization-contract.md` | Mandatory VI/EN UI, rental lifecycle, active months, dues and manual receipts/refunds |
| `docs/workflows-security.md` | Employee roles, approvals, KPIs and file access |
| `docs/delivery-plan.md` | Next.js structure, implementation order and acceptance gates |
| `docs/validation-results.json` | Actual test results with explicit limitations |

## Verify locally

Use Node.js 22 or later, then:

```bash
npm ci
npm run test:schema
```

For the full local Supabase stack, install Docker, inspect `npx supabase start --help` and `npx supabase db reset --help`, then start/reset a **local** project. These migrations are for a fresh database; do not apply them unreviewed to an existing CRM.

Workbook profiling (Python 3.11+):

```bash
python -m pip install -r requirements-import.txt
python scripts/prepare_workbook.py /secure/Databases.xlsx --out /secure/import-run
```

Add `--stage` only to create private local staging records. Never commit the workbook, staging files, customer contacts, passwords, legal files or credentials.

## GitHub approval

The user approved publication on 10 October 2026. The target repository was inspected again and remains empty. The initial package is prepared for the default main branch; publication is blocked until the connected GitHub account has write access. Recheck the remote branch before publishing. Provisioning Supabase, importing data and deploying production remain separate delivery steps.
