# Instructions for coding agents

Read `CONTEXT.md` and `docs/database-contract.md` before changing the project. The migration SQL is the physical schema authority. This is a foundation package; do not claim a working app exists yet.

## Authorization and tools

- Treat the user as the captain. Destructive, irreversible, security-sensitive, discard and merge actions require the captain to explicitly authorize the concrete action.
- Keep overrides limited to the expressly authorized object and action. Never infer an override, broaden it, apply it by analogy, transfer it to another object or action, or turn one request into standing authority. Resolve ambiguous scope or conflicting instructions with one concise clarification before acting.
- Preserve refused work. Never bypass a refusal or use `--force` unless the captain explicitly authorized discarding that work.
- Use `gh-axi` for GitHub, `chrome-devtools-axi` for browser work, and compatible `lavish-axi` for visual decisions or reports. Consult current help before use rather than relying on memorized flags.
- Never add an agent name as a commit co-author.

## Architecture

- Use Next.js App Router, TypeScript and Supabase on Vercel. Keep one application and one Postgres database.
- Keep component rendering separate from feature-level data access. Validate every Server Action and Route Handler input.
- Request-scoped Supabase server clients must use the user's session and publishable key. Use current official SSR guidance; validate the session server-side. Do not authorize from a raw `getSession()` response or editable user metadata.
- Never expose a secret/service-role key to browser code or a `NEXT_PUBLIC_` variable. Ordinary app requests must remain subject to RLS.
- Pin dependencies and commit lockfiles. Node.js 22+ is required. Verify current package and SSR API versions before building the UI.
- Do not cache authenticated inventory, employee/contact data, signed document links or user sessions in a shared public cache.

## UI and Vercel skills

- UI implementation and React/Next.js performance work: read and follow [vercel-react-best-practices](.agents/skills/vercel-react-best-practices/SKILL.md), including the rule files relevant to the change.
- Reusable component API design or composition refactors: read and follow [vercel-composition-patterns](.agents/skills/vercel-composition-patterns/SKILL.md).
- UI review, accessibility or UX audits: read and follow [web-design-guidelines](.agents/skills/web-design-guidelines/SKILL.md); fetch its current guidelines before each review.
- Vercel deployment work: read and follow [deploy-to-vercel](.agents/skills/deploy-to-vercel/SKILL.md); for token-authenticated CLI work, also read [vercel-cli-with-tokens](.agents/skills/vercel-cli-with-tokens/SKILL.md).
- Apply these skills within this project's authorization, data boundaries, pinned tool versions and acceptance requirements; those take precedence over upstream examples. Check credential presence without printing secret values. Installing or invoking a skill grants no deployment authority.

## Database invariants

- Every new exposed table needs explicit grants and RLS in the same migration. Never grant `anon` access to inventory.
- Use `security_invoker = true` for views. Keep privileged functions in `private`, use a fixed search path, explicitly revoke default EXECUTE and check the live employee role.
- Public RPC wrappers are invoker functions. Do not add a public definer function to bypass an access error.
- No direct client writes to `property_locks`, `lock_events`, `activity_events`, `properties`, `property_addresses`, `contacts` or `property_contacts`. Use documented RPCs.
- Lock transitions acquire the parent property row `FOR UPDATE` before the lock row; keep this order everywhere. Preserve the partial unique index for one approved reservation.
- Never allow self approval or self visit confirmation. Database enforcement is required even when UI controls are hidden.
- Effective lock = approved AND expiry after current time. Pending requests do not reserve. Do not build a second lock boolean on properties.
- Distinguish page views from confirmed physical visits; calculate Vietnam business day in the database.
- Preserve typed VND, m², phone strings and source text. Rental monthly dues and manual receipt/refund records are in scope; commission calculations, payouts, payment gateway integration and general accounting remain out of scope.
- Never overwrite original legacy addresses or auto-map partial ward transitions. Current addresses must not contain district fields.
- Do not silently change source relationships, drop unmatched rows or use sheet positions as foreign keys.

## Required localization and rental behavior

- Support both `vi` (default) and `en` throughout navigation, labels, forms, validation, status badges, notifications and dashboards. Persist the user preference via `set_my_locale`; do not hardcode Vietnamese strings in components.
- Keep Vietnamese addresses, legal source text, phone formats, VND, m² and Vietnam business dates correct in either UI language. Language switching must not translate or rewrite source records.
- Use rental agreements/months/payment RPCs from the contract. One active agreement rents a whole property. Keep occupancy state and payment state separate.
- Derive rental month paid/partial/unpaid, overdue balance and refund due from confirmed receipt/refund records. Never patch a paid boolean or count pending receipts as money received.
- Protect independent activation/payment review, integer VND, same-key retries and property → agreement → month → payment locking order. Preserve corrected/voided receipt history.

## Migration and verification

- Create new migrations with `supabase migration new <name>` after checking CLI help. Never rewrite a migration once deployed.
- Run `npm run test:schema` for schema/workflow changes. Add tests only for new invariants or regression risks.
- Embedded tests do not replace real Supabase RLS/API/Storage verification. Run staging acceptance checks in `docs/testing.md` before production.
- Import scripts default to dry run. No live migration, destructive reset, production deploy or GitHub write without the task's authorization.
- Keep raw workbooks, staging JSONL, customer documents and secrets outside Git. Sanitized reports are acceptable.
- Update `docs/database-contract.md` and `CONTEXT.md` alongside approved contract changes.

## Scope and reporting

Implement only approved MVP backlog work. Talk in outcomes, not mechanics: report actual changes, verification and remaining limits. Report failures plainly with the evidence; never present failed work as successful. Do not add AI matching, maps, payment calculations, external notifications or multi-tenancy without an approved requirement.

The user approved GitHub publication of this initial package on 10 October 2026. Do not ask for the same approval again. Recheck the remote state and publish the prepared initial commit when repository write access is available. Supabase provisioning, production import and deployment are separate authorization scopes.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
