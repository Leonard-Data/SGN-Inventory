# Next.js implementation and release plan

## Planned application structure

The database and docs are implemented in this package; the folders below are the planned Next.js code layout, not existing UI files.

| Path | Responsibility |
| --- | --- |
| `src/app/(auth)/login/page.tsx` | Login and invitation/recovery flow |
| `src/app/(app)/properties/page.tsx` | Inventory search/filter/page |
| `src/app/(app)/properties/[id]/page.tsx` | Property details, contacts, files, reservation banner |
| `src/app/(app)/activity/page.tsx` | Own daily activity and visit submission |
| `src/app/(app)/reservations/page.tsx` | Own requests and effective locks |
| `src/app/(app)/rentals/page.tsx` | Tenancy/occupancy inventory with VI/EN labels |
| `src/app/(app)/rentals/[id]/page.tsx` | Agreement details; staff/reviewer monthly dues and payment review |
| `src/app/(app)/reviews/page.tsx` | Independent reservation/visit/file review queue |
| `src/app/(app)/admin/employees/page.tsx` | Guarded user management |
| `src/app/(app)/admin/analytics/page.tsx` | Area and employee dashboards |
| `src/lib/supabase/client.ts` | Browser publishable-key client |
| `src/lib/supabase/server.ts` | Request/cookie-scoped server client |
| `src/lib/supabase/proxy.ts` | Session refresh/verification support using current official SSR conventions |
| `src/features/properties/` | Search, form validation, detail queries and mutations |
| `src/features/addresses/` | Versioned unit selectors and mapping review |
| `src/features/reservations/` | RPC calls, state badges and decision forms |
| `src/features/activity/` | Idempotent event capture and confirmed-visit report |
| `src/features/files/` | Metadata registration, upload, completion and signed download |
| `src/features/employees/` | Invite/link/deactivate with reviewed roles |
| `src/features/rentals/` | Agreement lifecycle, monthly occupancy/dues and reviewed manual receipts/refunds |
| `src/components/` | Shared input, table, status, dialog and navigation components |
| `src/i18n/vi.ts` and `src/i18n/en.ts` | Complete equivalent dictionaries, validated key parity and localized messages |
| `src/types/database.ts` | Generated Supabase types; do not edit manually |

Keep Server Actions narrow and input-validated. Reuse user-scoped data clients in feature services. Do not create a parallel unrestricted CRUD API for Supabase tables.

## Implementation backlog

| Order | Deliverable | Acceptance criteria |
| --- | --- | --- |
| 1 | Local/staging DB and Auth foundation | Migrations apply on real Supabase; reviewed users can log in; inactive/unlinked users denied |
| 2 | Responsive inventory and property detail | Vietnamese accent/legacy/current search; clear mode/type/access; 30-row pages; contact/file cards |
| 3 | Property/address maintenance | Role-scoped edits; positive numeric validation; explicit legacy input; current ward selector; reviewer verification |
| 4 | Private file protocol | Register → upload → confirm → signed read; interrupted upload recovery; no public legal links |
| 5 | Approval-based reservations | Independent approval; duplicate/competing requests handled clearly; expiry and release reflected immediately |
| 6 | Activity and review | Detail opens are page views; visits submitted/confirmed separately; unique confirmed-property daily KPI |
| 7 | Employee management and analytics | Last-admin protected invitation/role/deactivation action; zero-day reports; verified/unresolved area split |
| 7a | Bilingual interface and language preference | Full VI/EN dictionary parity and switching; VND, Vietnamese addresses and Vietnam calendar retained |
| 7b | Rental management | Draft/independent activation/end/cancel; active months; confirmed partial/full receipts, overdue and refund balances |
| 8 | Reviewed import ETL | Parameterized staging loader and promotion; identity reconciliation; correct contacts/files; same-snapshot retry |
| 9 | Acceptance and release | Real RLS/Storage, competing-session test, browser flow, reconciliation and recovery rehearsal pass |

Build auth + inventory first, then reservations/visits, then analytics and complete import. Use sanitized representative fixtures during UI development, not the raw customer workbook in previews.

## Vietnamese/English UX requirements

- Required language codes `vi` and `en`, default `vi`; persist employee preference and support switching throughout the app. Number/date formatting may follow `vi-VN` or `en-GB` presentation, while currency remains VND and business timezone `Asia/Ho_Chi_Minh`; dates displayed `dd/MM/yyyy` and times in Vietnam.
- Show prices as “tỷ” or “triệu” for readability while converting exactly to whole VND for storage. Rent is labeled per month.
- Use m² for area and metres for dimensions. Preserve alley/house strings and Vietnamese accents.
- Separate “Loại giao dịch” (sale/rent), “Loại bất động sản” (house/land/etc.) and “Đặc điểm lối vào” (street/alley).
- Address badges: “Địa chỉ cũ”, “Địa chỉ mới”, “Chưa xác minh”. Reservation labels: “Chờ duyệt”, “Đã khóa”, “Từ chối”, “Đã giải phóng”, “Hết hạn”.
- “Lượt xem” is page interaction; “Bất động sản đã thăm” is independently confirmed physical visits.
- Show claimant/expiry on reserved properties. A pending request shows its review state, not an effective reservation.
- Unknown legal/area/category information stays visibly unknown; upload and internal review do not establish legal ownership.

## CI and environments

After GitHub approval, add a workflow that installs locked dependencies, runs schema/preparation tests, and checks frontend formatting/types/lint/build when the frontend exists. A failed database test blocks schema promotion. Apply schema changes via a reviewed database pipeline, not Vercel build side effects.

Use Vercel Git integration for approved repository deployments. Preview environment = staging project and sanitized data; production environment = production project. Verify Auth callback URLs, session handling and private caching per environment. Pin supported Next.js/React/Supabase packages at implementation time; this package intentionally pins only its existing test/CLI tools.

Production release sequence: database compatibility change → application build/preview validation → approved deployment → smoke checks → monitor. Add destructive/restrictive schema changes only after the application is compatible. Keep prior app deployment available for rollback and use forward database fixes when recovery is safer.

## Out-of-scope extensions

Rental month dues, manual receipts/refunds and VI/EN support are now required. Commission rates/calculation/payouts, automated payment collection, multi-company isolation, branch/team scopes, a public property portal, automatic split-boundary geocoding, maps, automated customer messaging and AI enrichment require separate decisions. They must not creep into this first release.
