# Application shell and navigation information architecture

Status: accepted (2026-10-12)

No application shell exists today: `src/app/layout.tsx` is a document layout and the authenticated `SessionHeader` (brand, VI/EN, sign-out) is reused ad hoc by the inventory and detail pages. Roles are `sales | staff | manager | admin` (`20261010013004_inventory_core.sql`); SQL exposes `private.is_reviewer()` and `private.can_edit_property()`, the rest are inline role predicates. Property comments, inventory analytics, rentals, reservation review and employee management exist as confirmed designs but have no navigation.

We decided one authenticated shell — a persistent left sidebar plus a thin top bar (locale switch, user menu), collapsing to a drawer on small screens — delivered as a single `(app)` route group with a nested `layout.tsx`. Shell-free authentication pages (`login`, `recover`, `reset-password`, `access-denied`) live in an `(auth)` group. The menu has six groups: Inventory, Reservations & Reviews, Rentals, People, Reports, Admin. Each independent review flow keeps its own queue route under one Reviews section. Navigation config and the role→visibility table live in `src/features/navigation/`. `/properties` is the landing route for every role.

## Considered options

- Top-nav-only, or a second admin-only shell — rejected: one shell keeps locale/session logic in one place.
- One merged approvals inbox — rejected: the six review flows have different reviewer-independence and authority rules and cannot share a row model.
- Rendering access-denied inside `(app)` — rejected: a denied/inactive identity must not see the shell or its IA.
- Scattered `role === 'manager'` checks, or a general capability framework — rejected in favour of one small visibility table, since scattered checks are the gap already found in the code.

## Consequences

- Access-denied and auth pages are shell-free by structure; `/access-denied` stays a route inside `(auth)` rather than a state of the authenticated area.
- Reviews is one menu section but N routes; the section groups them without faking a shared authority model.
- The visibility table governs presentation only. Database helpers and RLS stay authoritative for actual authority.
- Route groups do not change URLs, so existing `/properties` and `/login` links keep working when the pages move into the groups.
- Supersedes the conflicting rows of the "Planned application structure" table in `docs/delivery-plan.md`.

The shell, shared component vocabulary and every planned page's layout are described in [`docs/interface-design.md`](interface-design.md).
