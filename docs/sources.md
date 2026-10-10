# Sources and evidence

Reviewed 10 October 2026. Government sources describe the policy baseline; the database design and verification workflow are application decisions. Check for later official changes when ingesting catalogs.

| Source | Use in this design |
| --- | --- |
| [Decision 19/2025/QĐ-TTg — official government record](https://chinhphu.vn/?classid=1&docid=214409&orggroupid=3&pageid=27160) | Official administrative code lists and 1 July 2025 effective baseline |
| [Official government explanation of two-tier operation](https://media.chinhphu.vn/van-hanh-chinh-quyen-dia-phuong-hai-cap-chinh-phu-chu-dong-dia-phuong-san-sang-102250620174201678.htm) | Current form hierarchy without district |
| [Resolution 1685/NQ-UBTVQH15 — official HCMC reorganization text](https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-1685-nq-ubtvqh15-sap-xep-cac-dvhc-cap-xa-cua-thanh-pho-ho-chi-minh-nam-2025-119250616211341304.htm) | Whole/partial changes; property-level verification for split wards |
| [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) | Explicit grants + RLS and invoker views |
| [Supabase SSR clients / Next.js](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs) | Request-scoped browser/server clients and session handling |
| [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control) | Private object policies and controlled upload/read paths |
| [Supabase table exposure change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) | Explicit table grants in migrations rather than assuming default exposure |
| [Supabase Node.js 20 support deprecation](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20) | Node.js 22+ runtime baseline |
| [Vercel Next.js integration](https://vercel.com/docs/frameworks/full-stack/nextjs) | Next.js hosting architecture and preview/production separation |
| Uploaded Databases.xlsx, SHA-256 in `workbook-profile.json` | Actual columns, sheet counts and relation/data-quality findings |

The official code list is not embedded in this package. Its ingestion and verification are separate migration deliverables. Raw workbook content, employee password values, owner contacts and attachment bytes are not included in the repository package.
