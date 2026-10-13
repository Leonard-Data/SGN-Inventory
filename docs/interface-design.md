# Interface system design — shell, components and page layouts

Design record (2026-10-12). Status: **implemented** for the token layer, the application shell, the inventory screen and the record page; the routes marked *(planned)* below are not built. Companion to [ADR 0001](adr/0001-app-shell-and-navigation-ia.md) (navigation/IA) and [design-foundation.md](design-foundation.md) (auth tokens). Behavior contracts live in [database-contract.md](database-contract.md); this document only describes layout and components. Application implementation of the remaining routes is separately authorized.

## 1. Scope

Covers the authenticated app shell, the shared component vocabulary, and the layout of every planned page: `/properties`, `/properties/[id]`, `/properties/new`, `/requests`, `/reviews/*`, `/rentals`, `/rentals/[id]`, `/people/employees`, `/people/contacts`, `/reports/activity`, `/reports/company`, `/admin/categories`, `/admin/units`. The auth pages (`/login`, `/recover`, `/reset-password`, `/access-denied`) already exist and are unchanged except that the shell never wraps them.

Reuse rule: the visual language is the *Saigon New House* design package, ported verbatim into `src/app/app.css` (tokens at `:root`) and `src/app/sgn-app.css` (the class vocabulary). **Those class names are the contract** — a screen composes them, it does not restyle them. Anything the package does not draw lives in `src/app/globals.css` (repo-only surfaces: maintenance disclosures, history comparison, owner contact, correction proposals, reservation states) and `src/app/sgn-surfaces.css` (extensions to package components); both are valued on the same tokens, and neither introduces a colour, radius or spacing value the token layer does not define. The auth surfaces keep their own `.sgn-auth` layout sheet over the same tokens.

## 2. Token decision (D1)

Two visual vocabularies existed before this work:

| Surface | Stylesheet | Type | Accent | Scope |
| --- | --- | --- | --- | --- |
| Inventory, detail, maintenance, files | `globals.css` | Arial (no token) | `--green:#087443` | `:root` |
| Auth | `sgn-auth.css` | Inter / Oswald (`next/font`) | `--accent:#176c58` | `.sgn-auth` |

Both define `--muted` and `--danger` with different values. The newer, deliberate baseline is the auth system (tokens, fonts, a visual-compare harness); the inventory sheet predates it and has no radii/spacing tokens.

**Decision (shipped):** the *Saigon New House* design package is the visual baseline and is ported verbatim: `src/app/app.css` is its token layer (declared at `:root`, so every surface including `.sgn-auth` inherits one palette, one type ramp, one radius set, one spacing scale) and `src/app/sgn-app.css` is its app layer, which owns the shared class vocabulary. The package's `assets/sgn-app.css` is byte-identical to the port except for the one documented adaptation — its runtime Google Fonts request is replaced by the `next/font` variables this application already self-hosts. Inventory, detail, maintenance and files no longer carry their own values: the legacy blocks the package also defines were deleted from `globals.css`. Control vocabulary is single: the auth screens were renamed from their `sgn-`-prefixed mirror onto the reference names (`.btn*`, `.field`, `.input`, `.lang-switch`, `.logo-tile`, `.auth-panel`) with `scripts/auth-visual-compare.mjs` as the check.

**Rejected:** leaving `globals.css` in place with a third token set for the shell — two greens, two body fonts and two badge colours in one product, and a guaranteed later migration.

Consequence, honoured: the migration was measured, not eyeballed — `scripts/auth-visual-compare.mjs` profiles the auth surfaces against the preserved auth reference, and its `PROFILE=applied` profile compares the shared surfaces (shell, cards, panels, controls, states) against the package's own applied reference at 375/1039/1040/1440px. The evidence for the last run of both profiles lives outside the repository (design review artifacts) and the harness prints the diff per surface.

## 3. App shell

The shell replaces the per-page `SessionHeader`. Locale switch and sign-out move into the top bar; pages no longer render their own header.

```
┌──────────────────────────────────────── .sgn-app / (app)/layout.tsx ────────────────────────────────────────┐
│ ┌ sidebar (--sidebar-w: 248px, sticky, full height) ─┐ ┌ topbar (--topbar-h: 64px, sticky) ───────────────────────────────────────┐ │
│ │ .sgn-lockup  logo tile + wordmark     │ │ breadcrumb / page title        LanguageSwitch  [user menu ▾] │ │
│ │                                       │ ├─────────────────────────────────────────────────────────────┤ │
│ │ NAV (role-filtered, §3.1)             │ │                                                             │ │
│ │  Inventory                            │ │  <main> page content region                                 │ │
│ │  Reservations & Reviews               │ │  --gutter-x, --content-max: 1280px, see below                │ │
│ │  Rentals                              │ │                                                             │ │
│ │  People                               │ │                                                             │ │
│ │  Reports                              │ │                                                             │ │
│ │  Admin                                │ │                                                             │ │
│ │                                       │ │                                                             │ │
│ │ active item: left accent bar, --soft  │ │                                                             │ │
│ └───────────────────────────────────────┘ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Components (shipped):** `.sgn-app` (grid frame), `.sgn-skip`, `.sgn-sidebar`, `.sgn-lockup` + `.logo-tile` + `.sgn-brand-name`, `.sgn-nav` > `.sgn-nav-group` (`.sgn-nav-label`, `.sgn-nav-item` with `aria-current="page"`), `.sgn-sidebar-foot`, `.sgn-main`, `.sgn-scrim`, `.sgn-topbar` (`.sgn-menu-btn`, `.sgn-crumbs`, `.sgn-topbar-right`), `.lang-switch`/`.lang-btn` (the reused bilingual switch), `.sgn-user`/`.sgn-user-btn`/`.sgn-avatar`/`.sgn-user-copy`/`.sgn-popover` (the account menu), `.sgn-content` (the content region). The shell lives in `src/features/navigation/app-shell.tsx` and is mounted by `src/app/(app)/layout.tsx`; `SessionHeader` no longer exists.
- **Shipped values:** `--sidebar-w: 248px`, `--topbar-h: 64px`, `--content-max: 1280px`, content padding `var(--space-8) var(--gutter-x) var(--space-16)` with `--gutter-x: clamp(20px, 3.4vw, 56px)`; the rail is `--brand-deep` and the accent never fills it. The nav renders only destinations whose route exists today (`/properties`); the other five groups of ADR 0001 are added in the change that ships their routes, so the rail never links to a page that does not exist.
- **Role filter:** items come from the `role × item → visible` table in `src/features/navigation/`; hidden items are not rendered, not merely disabled. Route guards reuse the same table.
- **Responsive (shipped):** under 1040px the rail becomes an off-canvas drawer (`--motion-base` slide, `.sgn-scrim` behind it, menu button with `aria-expanded`/`aria-controls`); the drawer closes on `Escape`, on the scrim and on navigation, traps Tab inside itself, and returns focus to the menu button. Above 1040px the rail is sticky at `--sidebar-w`. `--logo-size` and `--topbar-h` step down at 1039px.
- **Access:** one skip link to `#main-content`; the shell never renders for a denied identity (§6).
- **Session:** on window refocus the shell re-checks `/api/session`; on denial it clears page data and leaves the shell (§6). A refocus that follows no concealment re-checks the live session only — an unchanged employee and role never re-read data that is already displayed, so switching windows leaves a visible list in place, while a changed employee or role conceals the surface and reads again for the new authority.

### 3.1 Menu groups → routes

| Group | Items (route) | Roles |
| --- | --- | --- |
| Inventory | Search (`/properties`); New property (`/properties/new`, shipped) | all |
| Reservations & Reviews | My requests (`/requests`); Reviews hub (`/reviews/…`, corrections shipped) | all; queues per role |
| Rentals | Agreements (`/rentals`) | staff, manager, admin |
| People | Employees (`/people/employees`); Contacts (`/people/contacts`) | admin; staff/manager/admin |
| Reports | My activity (`/activity/me`, shipped); Company (`/activity/company`, shipped) | all; manager/admin |
| Admin | Categories (`/admin/categories`); Units (`/admin/units`) | admin |

`/reviews` redirects to the first queue the role can see. Detail is reached from inventory, never from the menu.

## 4. Shared component vocabulary

The contract is `src/app/sgn-app.css` — the ported design package. Compose these; do not introduce a second control vocabulary or a value the tokens do not define.

| Component | Classes (package) | Notes |
| --- | --- | --- |
| Content region | `.sgn-content` (the shell's `<main id="main-content">`) | `--content-max` 1280px, `--gutter-x` padding; the page renders inside it and owns no `<main>` |
| Page head | `.page-head` > `.page-intro` (`.example` eyebrow, `h1`, `.intro-copy`) + `.page-actions` | one accent action per viewport |
| Toolbar / search | `.toolbar`, `.search` > `.input` + `.search-btn`, `.search-hint`, `.chips` > `.chip` | filters as chips; the package's `.seg` view switch is unused (the app renders cards only) |
| Card / section | `.panel` > `.panel-head` (`.panel-title`, `.panel-note`) / `.panel-body` / `.panel-foot` | white, `--radius-lg`, hairline border |
| Property card | `.property-card` inside `.property-list[data-view="cards"]` > `.cover` + `.card-body`/`.card-meta`/`.card-address`/`.card-foot`/`.card-actions` | the cover holds the plate, or a stored photograph |
| Site plate | `.cover > svg.plate.plate-card`/`.plate-bare`/`.plate-hero`, `.plate-*` internals | one scale per record; repo-only placeholder text comes from the component |
| Status pill | `.badge` + `data-tone="neutral\|muted\|success\|warn\|danger\|accent"` | the localized label carries the meaning; the tone dot never replaces it |
| Buttons | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-block`, `.is-loading` | the auth screens use the same classes |
| Fields | `.field` > `.field-label-row` (`.field-req`), `.input`/`.select`/`.textarea`, `.field-unit`, `.check`, `.field-hint`, `.field-error` | one control set for every form |
| Rows / detail | `.detail-head`, `.detail-sub`, `.detail-body`, `.detail-rail`, `.chips.head-chips`, `.facts` > `.fact` (`dt`/`dd`, `.is-unknown`), `.record` > `.record-head`/`.record-title`/`.record-body`/`.record-meta` | facts print `Chưa rõ` for unknown values, never a dash |
| Files | `.doc-row`, `.doc-icon`, `.doc-name`, `.doc-meta`, `.doc-actions`, `.dropzone` | replaces the legacy file list |
| History / price | `.timeline` > `.tl-item` (`.tl-time`, `.tl-title`, `.tl-body`, `.tl-actor`), `.hist-row` (`.hist-when`, `.hist-change`, `.hist-field`), `.price-series` (`.price-series-title`) > `.price-row` (`.price-when`, `.price-change`, `.price-note`, `.price-who`) | `property_history` events render through the history rows; the record's recorded sale/rent series (#36) renders through the price rows |
| Comments | `.comment` (`.sgn-avatar` cell + body) > `.comment-author`, `.comment-meta`, `.comment-body`, `.comment-actions`, `.composer` > `.composer-foot` | 500-character contract unchanged |
| States | `.state-panel` (+ `data-tone="danger"`, `.state-mark`, `.state-title`), `.busy-bar`, `.busy-line` + `.spinner`, `.skeleton`/`.sk-card`, `.alert` (+ `data-tone`), `.toast` | loading, empty, error and denial stay distinct; empty ≠ zero ≠ denied |
| Lists / tables | `.data-table.stackable` (`[data-num]`, `data-label`), `.pagination` > `.page-info` + `.page-buttons` > `.pager-btn` | tables stack to label/value cards under 640px |
| Dialogs | `.sgn-dialog` > `.sgn-dialog-panel`/`.sgn-dialog-head`/`.sgn-dialog-body`/`.sgn-dialog-foot` | native `<dialog>`: focus trap and Escape come from the platform |
| Repo-only surfaces | `.maintenance*` (disclosures, inline editors), `.history-event`, `.history-comparison`, `.history-field`, `.owner-disclosure`, `.owner-phone`, `.reservation*` (`.reservation-effective`, `.reservation-pending`, `.reservation-request`), `.proposal-choices`, `.contact-choices`, `.eyebrow` (auth), `.comment-removed`, `.comment-edited`, `.comment-edit` and `.comment-moderation` (extensions to the comment row) | `globals.css` + `sgn-surfaces.css`; package tokens only |

## 5. Page layouts

All page bodies render inside the shell `main` region; `SessionHeader` is gone from them.

### 5.1 `/properties` — Inventory *(shipped)*

```
.sgn-content
  .page-head:  .page-intro (.example · h1 · .intro-copy)   |  .page-actions [ Company activity ] (manager/admin)
  .toolbar > .search > .input + .search-btn, .search-hint
  .chips > .chip (applied conditions) · .result-line in .row-between
  .property-list[data-view="cards"] > .property-card × N
      .cover > Plate(card)  |  stored cover photograph
      .card-body: .card-meta (code · mode) · .card-address > a · .card-foot > .badge[data-tone]
  .pagination > .page-info + .page-buttons > .pager-btn
  states: .busy-line (loading) · .state-panel (empty) · .state-panel[data-tone="danger"] (error)
```
Shipped: the card cover is the site plate drawn from the record's own fields; a stored cover photograph wins; a record with no areas keeps the plate's muted placeholder. The package's `.seg` Cards/List/Table switch is **not** implemented (the app renders cards only) and the ordering control is not implemented — both are open items, not silent omissions. The two panels that used to sit under the results — the create-property form and the correction queue — moved to their own destinations (`/properties/new`, `/reviews/corrections`); `/properties` keeps search, results and pagination.

### 5.2 `/properties/[id]` — Detail *(shipped, minus the items noted)*

```
.sgn-content
  quiet back link (.link-quiet) → returnTo (keeps the filtered result position)
  detail-head: .example eyebrow · h1 (record code) · .chips.head-chips (status + review status badges)
  archived notice: .alert[data-tone="neutral"] with the archive mark
  detail-body (two-column grid, single column under 1180px): main column + aside.detail-rail
    main column:
      .tabs[role=tablist] "Tổng quan · Tài liệu · Thảo luận" (roving tabindex, arrow/Home/End)
      .tabpanel "Tổng quan":
        panel .plate-hero (top of the grid)  → Plate(hero) | stored cover photograph
        panel Facts      → dl.facts with .fact rows; unknown values print Chưa rõ
        panel Price history → two .price-series groups (sale asking price / monthly asking rent) of .price-row (.price-when, .price-change, .price-note, .price-who), newest-first with per-series paging
        panel Addresses  → .record rows + mapping .badge, .addrNote policy line
        panel Contacts   → .record rows + owner-contact disclosure (.owner-disclosure/.owner-phone)
        panel Reservation→ effective/pending states (.reservation-effective/.reservation-pending) + request and decision forms
        panel Maintenance→ in-page maintenance workspace (revision-checked)
        panel Corrections→ report + role-scoped queue
      .tabpanel "Tài liệu": panel Files → property-files Workspace (.doc-row vocabulary, cover, dropzone)
      .tabpanel "Thảo luận": Discussion → 30-item list newest-first, .composer, author edit and withdrawal with reasoned manager/admin removal (.comment-actions, .comment-edited marker, .comment-edit editor, .comment-removed marker, .comment-moderation)
    aside.detail-rail (sticky):
      panel History    → maintenance history rows (.hist-row)
      page-view note, then panel Activity → today's own counts
```
Shipped as above. The three groups and the main/rail split follow the package's own record screen
(`ui_kits/app/components/App.jsx`: `overview | docs | comments` inside a `<div>`, beside `<aside class="detail-rail">`).
Before this the panels were direct children of `.detail-body`, so the two-column grid placed them in alternating
columns and the facts panel rendered inside the 344 px rail. Inactive tabpanels stay mounted but `hidden`, so a
tab switch neither refetches nor loses an in-flight upload. **Not implemented:** the record's Edit action —
there is no `/properties/[id]/edit` route, so editing stays the in-page maintenance disclosure. No new route was added.

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
Routes: `/reviews/corrections` (shipped as **Correction requests**: page-intro plus the correction queue, guarded by its own protected read — every active employee reads their own requests, and staff/manager/admin decide them), `/reviews/reservations`, `/reviews/visits`, `/reviews/rental-activation`, `/reviews/sale-completions`, `/reviews/closure-corrections`. Same layout shell; each queue is its own route and guard. `/reviews` redirects to the first permitted queue.

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

### 5.6 `/people/employees` (shipped: list only, admin)

```
page-intro (.example · h1 · .intro-copy)
panel Employees → .data-table.stackable: name · email · role · access state
  .panel-foot → .pagination (.page-info + .page-buttons > .pager-btn)
  states: .panel-note[role=status] (loading) · .state-panel (empty) · .alert[data-tone=danger] (error)
```
Shipped: the list reads existing employee identities from `GET /api/employees` and shows the recorded display name, email, role and access state (`Đang hoạt động` / `Đã tắt truy cập` / `Chưa liên kết đăng nhập`), at most 30 rows per page with a keyset cursor. An unlinked imported person is labelled not linked, never invited: the schema records no invitation. The rail renders the destination for admin only and the proxy refuses a direct visit by another role.

Still planned, not shipped: the `[Invite employee]` disclosure, the last-activity column, the `[Activate|Deactivate]` and `[Change role]` row actions, last-admin protection and the "review approved locks before deactivation" warnings. No per-employee route.

### 5.7 `/people/contacts` (new, staff/manager/admin)

```
page-intro · [New contact]
search input (name / phone, accent-insensitive)
.data-table: name · role/relationship · phone · linked properties
  expanding row → .maintenance-editor to correct the shared contact (with affected-properties confirmation)
```
Reuses the maintenance edit-in-place pattern.

### 5.8 `/activity/me` (shipped, all)

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

- **Denied / inactive:** the shell is never rendered. `/access-denied` stays in the `(auth)` group and is shown shell-free; a membership or identity denial returns `403` with a localized access-denied message, never an empty inventory. An object-level refusal (`contact-refusal`) keeps the current page and its state with a localized inline message instead ([maintenance contract](maintenance-contract.md#shared-identities-and-local-links)).
- **Loading / empty / error:** the package's own states — `.busy-line` (+ `.spinner`) and `.busy-bar` for progress, `.skeleton`/`.sk-card` where the final geometry is known, `.state-panel` (with `.state-mark`, `.state-title`, optional `data-tone="danger"`) for empty and error, `.alert` for inline feedback and `.toast` for transient confirmation — each with localized text. Empty ≠ denied and empty ≠ zero: an event-free day is an explicit `0`, not a blank.
- **Failed saves:** keep the draft, show a localized error, never a false success.
- **Sign-out / denial after load:** clear displayed inventory, contact and discussion data; Back/refresh must not reveal it.

## 7. Localization, accessibility, responsive

- **i18n:** VI default + EN for every label, badge, control, empty/loading/error state and format. Shell/nav/global strings in `src/i18n/messages.ts`; page areas get feature-local files (e.g. `src/features/reviews/messages.ts`). Never translate source records; Vietnamese addresses, phone strings, VND and m² stay verbatim. Dates `dd/MM/yyyy`, times in `Asia/Ho_Chi_Minh`.
- **Accessibility:** skip link; visible focus (`:focus-visible`); every input has a label; interactive hit areas ≥44px; status conveyed by text, not colour alone; `<details>` disclosure is keyboard-operable; drawer has a focus trap; tables use `<th scope>`.
- **Responsive breakpoints (shipped):** 1039/1040px (rail → drawer; `--logo-size`, `--topbar-h` step down; `.detail-head`/`.detail-body` collapse), 720px (the language switch switches to its short form), 640px (content padding, `.property-list` to one column, `.facts`/`.price-row`/`.doc-row` stack, `.data-table` to stacked cards, dialogs widen to the viewport), 480px (history comparison stacks). Print hides the rail, topbar, scrim and toasts.

## 8. Open decisions and flags

- **D1 (tokens): resolved** — see §2 for what shipped.
- **Badge tones: resolved** — `.badge` is the package's outline pill with `data-tone`; the mapping-status and record-status labels keep their localized text and were checked at 375/1039/1040/1440px.
- **Shell refactor: resolved** — `src/features/employees/session-header.tsx` is deleted; the shell owns the crumbs, the language switch (persisted through `set_my_locale`, cookie-backed, re-rendered by the root layout) and the account menu.
- **Tables:** the company and personal activity reports and the employee list render `.data-table.stackable`; reviewer/queue lists still stay as `.history-event` rows because each row expands to a decision form.
- **Locale propagation:** locale is a cookie + `set_my_locale` preference; the shell re-renders the route on change, so page components no longer own locale state (`applyLocale` was removed from `useProtectedData`).

### Shipped-state gaps (deliberate, not silent)

- Navigation renders four groups: Inventory (`/properties` and `/properties/new`, every role), Reservations & Reviews (`/reviews/corrections`, every role — the queue reads the caller's own requests while only staff/manager/admin decide), People (`/people/employees`, admin) and Reports (`/activity/me`, every role; `/activity/company`, manager/admin). The ADR's other two groups (Rentals, Admin) ship with their routes.
- The inventory results have **cards only**: the package's Cards/List/Table `.seg` switch and the ordering control are not implemented, and `.cell-plate` table thumbnails therefore have no consumer yet.
- The card shows the record's existing fact set (code, mode, address, status). The prototype's card also prints area and price lines; adding them would be new data display beyond this restyle, so they were left out.
- The record page has no Edit action (no edit route exists; editing stays the in-page maintenance disclosure).
- The change timeline (`.timeline`/`.tl-item`) and the **Nhân sự & liên hệ** screen (employee accounts + contact book, `.directory-tabs`, `.cell-person`, `.sgn-avatar-sm`) are rendered in the design review route `/design/app-preview` from fictional fixtures: the app has no contact-book endpoint, and the review route is where that unused vocabulary is inspectable. The asking-price timeline (`.price-row`) now ships on the record from the recorded sale/rent series (#36); the employee list ships separately (§5.6). The remaining product route (`/people/contacts`) and its data contract are separate, unauthorized work.
- The personal activity report (#30) shipped at **`/activity/me`** rather than this document's planned `/reports/activity`, with its own acceptance evidence and API path (`/api/activity/me`), and the company employee-by-day report (#57) shipped at **`/activity/company`** rather than the planned `/reports/company` with API path (`/api/activity/company`); both routes were left where the features shipped and the rail's Reports group points at them. `/requests`, the rest of `/reviews/*`, `/rentals*`, `/people/contacts`, `/admin/*` remain unbuilt and are only described above.
- The auth surfaces keep their own layout sheet (`.sgn-auth` + `sgn-auth.css`); they share the token layer and the control vocabulary but they are shell-free by design (ADR 0001).
- **Not in scope:** no geographic map, no physical-visit UI, no threads/reactions/mentions, no dashboards beyond §5.9, and no archived-property exception beyond the existing reviewer read boundary and the reasoned manager/admin discussion removal in §5.2.
