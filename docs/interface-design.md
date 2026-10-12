# Interface system design — shell, components and page layouts

Design record (2026-10-12). Status: **not implemented**. Companion to [ADR 0001](adr/0001-app-shell-and-navigation-ia.md) (navigation/IA) and [design-foundation.md](design-foundation.md) (auth tokens). Behavior contracts live in [database-contract.md](database-contract.md); this document only describes layout and components. Application implementation is separately authorized.

## 1. Scope

Covers the authenticated app shell, the shared component vocabulary, and the layout of every planned page: `/properties`, `/properties/[id]`, `/requests`, `/reviews/*`, `/rentals`, `/rentals/[id]`, `/people/employees`, `/people/contacts`, `/reports/activity`, `/reports/company`, `/admin/categories`, `/admin/units`. The auth pages (`/login`, `/recover`, `/reset-password`, `/access-denied`) already exist and are unchanged except that the shell never wraps them.

Reuse rule: every new page is composed from the classes already in `src/app/globals.css` (`.panel`, `.property-card`, `.property-list`, `.badge`, `.pagination`, `.maintenance*`, `.history-event`, `.details`, `.page-intro`, `.search-panel`) plus the auth system in `src/app/sgn-auth.css`. New classes are introduced only where §3 lists them, and each is named to match the existing `sgn-`/flat convention.

## 2. Token decision (D1)

Two visual vocabularies exist today:

| Surface | Stylesheet | Type | Accent | Scope |
| --- | --- | --- | --- | --- |
| Inventory, detail, maintenance, files | `globals.css` | Arial (no token) | `--green:#087443` | `:root` |
| Auth | `sgn-auth.css` | Inter / Oswald (`next/font`) | `--accent:#176c58` | `.sgn-auth` |

Both define `--muted` and `--danger` with different values. The newer, deliberate baseline is the auth system (tokens, fonts, a visual-compare harness); the inventory sheet predates it and has no radii/spacing tokens.

**Decision (recommended):** promote the auth tokens and controls into one shared app layer, `src/app/app.css`, scoped to `.sgn-app`. The shell and all authenticated pages consume it; `.sgn-auth` becomes a child of the same token scope. Inventory, detail, maintenance and files migrate off the ad-hoc `globals.css` values onto these tokens (type, `--accent`, radii, spacing) as part of the shell work. One type system, one accent, one set of radii.

**Alternative:** leave `globals.css` in place for inventory and give the shell its own third token set. Cheaper now, but ships two greens, two body fonts and two badge colours in one product, and guarantees a migration later anyway.

Consequence of the decision: the migration touches working pages, so it must be verified by the visual-compare harness (`scripts/auth-visual-compare.mjs`) extended to the inventory/detail pages, not eyeballed.

## 3. App shell

The shell replaces the per-page `SessionHeader`. Locale switch and sign-out move into the top bar; pages no longer render their own header.

```
┌──────────────────────────────────────── .sgn-app / (app)/layout.tsx ────────────────────────────────────────┐
│ ┌ sidebar (240px, sticky, full height) ─┐ ┌ topbar (56px, sticky) ───────────────────────────────────────┐ │
│ │ .sgn-lockup  logo tile + wordmark     │ │ breadcrumb / page title        LanguageSwitch  [user menu ▾] │ │
│ │                                       │ ├─────────────────────────────────────────────────────────────┤ │
│ │ NAV (role-filtered, §3.1)             │ │                                                             │ │
│ │  Inventory                            │ │  <main> page content region                                 │ │
│ │  Reservations & Reviews               │ │  padding 24px clamp(20px,4vw,56px) 72px; max-width 1280px   │ │
│ │  Rentals                              │ │                                                             │ │
│ │  People                               │ │                                                             │ │
│ │  Reports                              │ │                                                             │ │
│ │  Admin                                │ │                                                             │ │
│ │                                       │ │                                                             │ │
│ │ active item: left accent bar, --soft  │ │                                                             │ │
│ └───────────────────────────────────────┘ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Components:** `.sgn-app` (frame), `.sgn-sidebar`, `.sgn-navg .sgn-nav-group`, `.sgn-navg .sgn-nav-item` (`aria-current="page"`), `.sgn-topbar`, `.sgn-crumbs`, plus the reused `LanguageSwitch`/`PasswordField` family becoming shared controls.
- **Role filter:** items come from the `role × item → visible` table in `src/features/navigation/`; hidden items are not rendered, not merely disabled. Route guards reuse the same table.
- **Responsive:** at `<1040px` the sidebar collapses to the compact horizontal header (reuse the auth rail breakpoint and `--logo-size:42px`), the nav becomes a drawer opened by a menu button with focus trap and `aria-expanded`; the drawer closes on route change and on `Escape`.
- **Access:** one skip link to `#main-content`; the shell never renders for a denied identity (§6).
- **Session:** on window refocus the shell re-checks `/api/session`; on denial it clears page data and leaves the shell (§6).

### 3.1 Menu groups → routes

| Group | Items (route) | Roles |
| --- | --- | --- |
| Inventory | Search (`/properties`) | all |
| Reservations & Reviews | My requests (`/requests`); Reviews hub (`/reviews/…`) | all; queues per role |
| Rentals | Agreements (`/rentals`) | staff, manager, admin |
| People | Employees (`/people/employees`); Contacts (`/people/contacts`) | admin; staff/manager/admin |
| Reports | My activity (`/reports/activity`); Company (`/reports/company`) | all; manager/admin |
| Admin | Categories (`/admin/categories`); Units (`/admin/units`) | admin |

`/reviews` redirects to the first queue the role can see. Detail is reached from inventory, never from the menu.

## 4. Shared component vocabulary

| Component | Classes | Origin | Notes |
| --- | --- | --- | --- |
| Page container | `<main>` | reuse | 1280px cap, responsive padding |
| Page header | `.page-intro` (`h1` + `.eyebrow` + `.intro-copy`) | reuse | title + one-line purpose per page |
| Card / section | `.panel` | reuse | white, 16px radius, hairline border; `.panel` accent top-border reserved for the primary detail panel |
| Property card | `.property-card` inside `.property-list` | reuse | grid `auto-fit minmax(320px,1fr)` |
| Status pill | `.badge` + `[data-tone="neutral\|success\|warn\|danger\|accent"]` | extend | today `.badge` is gold-only; statuses need tones. Colour is never the only signal — the badge text is the localized label |
| Button | `.sgn-btn`, `.sgn-btn-primary/-secondary/-block` | promote | reuse the auth variants app-wide; add `.sgn-btn-danger` |
| Field | `.sgn-field`, `.sgn-input`, `.sgn-label-row`, `.sgn-field-error` | promote | one control set for every form |
| Disclosure | `<details class="maintenance">` | reuse | creation, report, filters, invite |
| Inline editor | `.maintenance-editor` | reuse | edit-in-place blocks |
| Event/row card | `.history-event`, `.history-comparison`, `.history-field` | reuse | queue items and history entries |
| List | `.property-list`, `.file-list > .file-row` | reuse | no generic table existed |
| Data table | `.data-table` (`table/thead/tbody`, `[data-num]` right-align + `tabular-nums`) | new | first tables in the app: reports + employee/contact lists; stacks to label/value cards under 640px |
| Pagination | `.pagination` | reuse | keyset cursors; UUID order today |
| Section nav (detail) | `.section-nav` (sticky, `aria-label`) | new | detail page anchors only |
| Empty / loading / error | `<p role="status">` / `<p role="alert">` | reuse | no new classes; messages localized |

## 5. Page layouts

All page bodies render inside the shell `main` region; `SessionHeader` is gone from them.

### 5.1 `/properties` — Inventory (exists; add ordering + new-property)

```
page-intro:  eyebrow "Inventory" · h1 · intro-copy
[ New property ]  (opens the existing creation disclosure, staff/reviewer only)
search-panel form: query · mode · type · status · [order: newest|oldest] · [Search]
status / alert paragraphs
property-list (grid):
  property-card × N
    CoverImage · h2>a (code + address) · meta line · address lines + .badge(mapping status)
pagination  [First] [Prev] [Next]
```
Adds an ordering control (original inventory entry dates; unknown shown explicitly). New-property is an action, not a route (§3.1).

### 5.2 `/properties/[id]` — Detail (exists; add section nav, discussion, price timeline)

```
detail-breadcrumb: Inventory / <code>
detail-heading: eyebrow · h1 · .badge.detail-status ;  [+ archived badge]
section-nav (sticky): Facts · Addresses · Contacts · Files · Discussion · Price history · History · Activity
details (two-column grid):
  panel Facts (dl)            | panel Addresses (articles + .badge)
                              | panel Contacts (articles + relation/primary .badge)
panel Files        → property-files Workspace
panel Discussion   → comments (new): 30-item list newest-first, composer, edit/remove, moderator reason
panel Price history→ asking-price timeline (new): date · actor · before → after, sale and rent separate
panel History      → maintenance History (exists)
panel Activity     → today's own counts (exists)
panel Correction report / queue (exists, role-scoped)
```
Discussion and price history reuse `.panel` + `.history-event`/list patterns; no new route.

### 5.3 `/requests` — my requests (new)

```
page-intro: h1 · intro-copy
panel Reservations:
  list of .history-event rows: property link · status .badge · dates · [withdraw]
panel Corrections:
  list of .history-event rows: target · status .badge · time · [amend][withdraw]
pagination
```
One page, two stacked panels (no tabs), matching "requests, not review".

### 5.4 `/reviews/*` — review queues (new)

```
page-intro: queue name · intro-copy
panel (filters as <details>): status · date range · [Apply]
queue rows: .history-event — subject link · claimant/actor · dates · evidence · .badge status
  expanding row reveals decision form: [reason textarea] [Approve] [Reject]
pagination
```
Routes: `/reviews/reservations`, `/reviews/corrections`, `/reviews/visits`, `/reviews/rental-activation`, `/reviews/sale-completions`, `/reviews/closure-corrections`. Same layout shell; each queue is its own route and guard. `/reviews` redirects to the first permitted queue.

### 5.5 `/rentals` + `/rentals/[id]` (new)

```
/rentals
  page-intro · [New draft]
  filter: state (draft|active|ended|cancelled)
  .data-table: property · tenant · term · monthly rent · state .badge
  pagination

/rentals/[id]
  detail-heading: property link · state .badge
  panel Agreement: terms (dl) · creator/approver · [Edit draft] (draft only)
  panel Months: .data-table month · due · paid · balance · state .badge
  panel Payments: receipts/refunds list (.history-event) + [Record receipt] [Record refund]
  panel Actions: [Verify] [Activate] [End] [Cancel] [Request closure correction] (role-gated)
```
Master (agreement) + detail (months/payments), reusing `.details` grid.

### 5.6 `/people/employees` (new, admin)

```
page-intro · [Invite employee]  (opens .maintenance disclosure: email, role)
.data-table: name · email · role · status (active/inactive/invited) · last activity
  row actions: [Activate|Deactivate] [Change role]
```
No per-employee route. Last-admin protection and "review approved locks before deactivation" surfaced as inline warnings.

### 5.7 `/people/contacts` (new, staff/manager/admin)

```
page-intro · [New contact]
search input (name / phone, accent-insensitive)
.data-table: name · role/relationship · phone · linked properties
  expanding row → .maintenance-editor to correct the shared contact (with affected-properties confirmation)
```
Reuses the maintenance edit-in-place pattern.

### 5.8 `/reports/activity` (new, all)

```
page-intro: Vietnam business day
metric cards (.panel × 3): page views · distinct properties viewed · owner-contact accesses
.data-table: date · page views · distinct properties
```
Own data only, including for reviewers.

### 5.9 `/reports/company` (new, manager/admin)

```
page-intro + date range [from][to] (default: today + 29 prior Vietnam days) [Apply]
panel Province owner-contact activity:
  .data-table: province · accesses ; "Unverified location" row ; sorted high→low ; colour-coded cells (text label retained)
panel Completed sales ranking:
  .data-table: # · employee · count ; tied totals share rank
panel Completed rentals ranking:
  .data-table: # · employee · count
panel Owner-contact activity ranking:
  .data-table: # · employee · total distinct-property accesses
footnote: historical rankings can change after cancellation/correction
```
Three separate rankings, no composite score; no geographic map (per the confirmed analytics plan).

### 5.10 `/admin/categories` · `/admin/units` (new, admin)

```
page-intro · [New category] / [New unit]
.data-table: name · builtin · created by · created at   (list + create only; no rename/delete/merge)
```

## 6. Cross-cutting states

- **Denied / inactive:** the shell is never rendered. `/access-denied` stays in the `(auth)` group and is shown shell-free; API responses return `403` and a localized access-denied message, never an empty inventory.
- **Loading / empty / error:** plain `<p role="status">` and `<p role="alert">` with localized text, matching the existing pages. Empty ≠ denied and empty ≠ zero: an event-free day is an explicit `0`, not a blank.
- **Failed saves:** keep the draft, show a localized error, never a false success.
- **Sign-out / denial after load:** clear displayed inventory, contact and discussion data; Back/refresh must not reveal it.

## 7. Localization, accessibility, responsive

- **i18n:** VI default + EN for every label, badge, control, empty/loading/error state and format. Shell/nav/global strings in `src/i18n/messages.ts`; page areas get feature-local files (e.g. `src/features/reviews/messages.ts`). Never translate source records; Vietnamese addresses, phone strings, VND and m² stay verbatim. Dates `dd/MM/yyyy`, times in `Asia/Ho_Chi_Minh`.
- **Accessibility:** skip link; visible focus (`:focus-visible`); every input has a label; interactive hit areas ≥44px; status conveyed by text, not colour alone; `<details>` disclosure is keyboard-operable; drawer has a focus trap; tables use `<th scope>`.
- **Responsive breakpoints:** reuse existing — 1040px (sidebar → drawer), 680px (`page-intro`/`search-panel` stack), 640px (`main` padding, `.details` → one column, `.data-table` → stacked cards), 480px (history comparison stacks).

## 8. Open decisions and flags

- **D1 (tokens):** §2 keeps the auth system as the app-wide baseline. If the cheaper alternative is chosen instead, only §2 and the class mapping in §4 change; page layouts do not.
- **First tables:** §4 introduces `<table>` for the first time (reports, employee/contact lists). Reviewer/queue lists stay as `.history-event` article rows rather than tables, because each row expands to a decision form.
- **Badge tones:** extending `.badge` changes the current gold-only badges on inventory/detail; the migration must keep the mapping-status badges readable in both languages.
- **Shell refactor:** absorb `src/features/employees/session-header.tsx` into the top bar; inventory/detail drop their own header. Verified only when implementation is authorized.
- **Not in scope:** no geographic map, no physical-visit UI, no threads/reactions/mentions, no dashboards beyond §5.9, no design for any archived-property exception beyond the existing reviewer read boundary.
