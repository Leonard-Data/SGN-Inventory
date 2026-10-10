# Claude project guidance

Read and follow `AGENTS.md` as the shared coding-agent instructions. Read `CONTEXT.md` and `docs/database-contract.md` before implementation.

Use the Next.js/Supabase/Vercel architecture. Preserve database-enforced employee authorization, reservation approval, dual Vietnamese addresses, distinct visit/view KPIs, mandatory Vietnamese/English UI, and reviewed rental-month/payment handling. This package currently implements the database foundation and profiling tools; the Next.js UI and production import are future work.

Run `npm run test:schema` after database changes. Keep the database contract and product context in sync. Do not commit customer data or spreadsheet passwords. GitHub publication of this initial package was approved on 10 October 2026; follow the recorded authorization in AGENTS.md. Publishing remains blocked until repository write access is available.
