# SGN project context

## Product decision

Replace the AppSheet/Google Sheets property inventory with a small, maintainable application. The source is `Databases.xlsx`, profiled on 10 October 2026. The chosen stack is Next.js, Supabase and Vercel; earlier Reflex/Cloudflare proposals are superseded.

## Scope and defaults

- One company and one shared inventory. Managers review company-wide; no branch/team isolation in this MVP.
- Two required UI languages: Vietnamese (`vi`, default) and English (`en`); Vietnamese regional formats remain mandatory in both. Store UTC instants; calculate work days in `Asia/Ho_Chi_Minh`.
- Search legacy and current addresses, listing mode, property type, access type, price, dimensions and status.
- Employees browse owner/broker contacts and private legal/photos files. Internal contacts are shared among active employees.
- Four application roles: sales, staff, manager, admin. Invite-only Auth; authority comes from live employee rows.
- Actual visits require independent confirmation. Page views are a separate activity metric.
- A pending lock is a request; only an approved and unexpired lock reserves the property and identifies the claimant for commission attribution.
- Default pending request expiry: 48 hours; approved reservation: 7 days, reviewer-selectable 1–30 days. Extensions require a new reviewed request after release/expiry.
- Rental agreements, monthly occupancy/dues, and manually recorded receipts/refunds are in scope. No commission amount/rate, payouts, payment gateway, general accounting, customer portal, public listing, complex CRM pipeline or mobile native app.

## Address decisions

Keep the original district-bearing address. New entry defaults to province/city → commune/ward, with no current district. Legacy and current addresses are separate records. Do not guess a split-ward conversion. Display unresolved mappings visibly and use a separate analytic bucket. National address catalogs and approved crosswalk records still need ingestion; they are not bundled as verified seed data.

## Evidence and outstanding work

There are 19,233 property rows, 17 employee rows and 56,932 legacy click events. Twenty-three property rows lack IDs; one nonblank ID is shared by two rows. `Contracts` has 20,480 rows and zero direct property-ID matches. See the sanitized profile and mapping document; do not assume sheet row numbers establish relationships.

The user added mandatory VI/EN localization and rental status/month/payment handling on 10 October 2026. Schema and workflow tests run locally in embedded PostgreSQL with Supabase Auth/Storage shims. Real Auth, storage API, multi-session contention, Next.js routes and deployment still require staging validation. UI and promotion ETL are planned, not implemented.

## Repository and approval

Target: <https://github.com/Leonard-Data/SGN-Inventory>. The user approved adding this initial package to GitHub on 10 October 2026. Publication is authorized but the connected account currently lacks push permission. Prepare the initial main-branch commit and publish once write access is available, after rechecking remote state. Raw workbook and customer records remain excluded.

## Reading order

1. This file and `AGENTS.md`.
2. `docs/database-contract.md`, `docs/schema.md` and the migration SQL.
3. `docs/address-model.md` and `docs/workflows-security.md`.
4. `docs/migration-plan.md`, `docs/workbook-mapping.md` and `docs/delivery-plan.md`.

Update this file when an approved product decision changes; do not leave competing architecture instructions in different files.
