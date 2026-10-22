# Interface system design — shell, components and page layouts

Design record (2026-10-12). Status: **implemented** for the token layer, the application shell, the inventory screen and the record page; the routes marked *(planned)* below are not built. Companion to [ADR 0001](adr/0001-app-shell-and-navigation-ia.md) (navigation/IA) and [design-foundation.md](design-foundation.md) (auth tokens). Behavior contracts live in [database-contract.md](database-contract.md); this document only describes layout and components. Application implementation of the remaining routes is separately authorized.

## 1. Scope

Covers the authenticated app shell, the shared component vocabulary, and the layout of every planned page: `/properties`, `/properties/[id]`, `/properties/new`, `/requests`, `/reviews/*`, `/rentals`, `/rentals/[id]`, `/people/employees`, `/profile`, `/people/contacts`, `/reports/activity`, `/reports/company`, `/admin/categories`, `/admin/units`. The auth pages (`/login`, `/recover`, `/reset-password`, `/access-denied` and the shell-free `/auth/invite` invitation destination) already exist; the shell never wraps them.

Reuse rule: the visual language is the *Saigon New House* design package, ported verbatim into `src/app/app.css` (tokens at `:root`) and `src/app/sgn-app.css` (the class vocabulary). **Those class names are the contract** — a screen composes them, it does not restyle them. Anything the package does not draw lives in `src/app/globals.css` (repo-only surfaces: maintenance disclosures, history comparison, owner contact, correction proposals, reservation states and the recorded employee administration blocks) and `src/app/sgn-surfaces.css` (extensions to package components); the repo-only record-surface controls join `.card-entry` in `sgn-app.css` (see §2). All three are valued on the same tokens, and none introduces a colour, radius or spacing value the token layer does not define. The auth surfaces keep their own `.sgn-auth` layout sheet over the same tokens.

## 2. Token decision (D1)

Two visual vocabularies existed before this work:

| Surface | Stylesheet | Type | Accent | Scope |
| --- | --- | --- | --- | --- |
| Inventory, detail, maintenance, files | `globals.css` | Arial (no token) | `--green:#087443` | `:root` |
| Auth | `sgn-auth.css` | Inter (`next/font`) | `--accent:#176c58` | `.sgn-auth` |

Both define `--muted` and `--danger` with different values. The newer, deliberate baseline is the auth system (tokens, fonts, a visual-compare harness); the inventory sheet predates it and has no radii/spacing tokens.

**Decision (shipped):** the *Saigon New House* design package is the visual baseline and is ported verbatim: `src/app/app.css` is its token layer (declared at `:root`, so every surface including `.sgn-auth` inherits one palette, one type ramp, one radius set, one spacing scale) and `src/app/sgn-app.css` is its app layer, which owns the shared class vocabulary. The package's `assets/sgn-app.css` is byte-identical to the port except for the documented adaptations — its runtime Google Fonts request is replaced by the `next/font` variables this application already self-hosts, and the chronological inventory work (#37) adds the repo-only `.card-entry` line and extends `.seg-btn` with the `[aria-current="true"]` selected state (§5.1), the inventory filters add the search island's wrapping dialog foot, and the record-surface acceptance round adjusts the dialog chrome (`.sgn-dialog-head`/`.sgn-dialog-body` padding), the `.detail-actions`/`.comment-actions` layout values and adds the repo-only `.icon-btn`, `.actions-menu`, `.pager` and `.cover-slot` controls (§4), and the property map location adds the repo-only `.sgn-location`/`.sgn-map*` controls (§4). Inventory, detail, maintenance and files no longer carry their own values: the legacy blocks the package also defines were deleted from `globals.css`. Control vocabulary is single: the auth screens were renamed from their `sgn-`-prefixed mirror onto the reference names (`.btn*`, `.field`, `.input`, `.lang-switch`, `.logo-tile`, `.auth-panel`) with `scripts/auth-visual-compare.mjs` as the check.

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
- **Shipped values:** `--sidebar-w: 248px`, `--topbar-h: 64px`, `--content-max: 1280px`, content padding `var(--space-8) var(--gutter-x) var(--space-16)` with `--gutter-x: clamp(20px, 3.4vw, 56px)`; the rail is `--brand-deep` and the accent never fills it. The nav renders only destinations whose route exists today (the shipped rows in §3.1); the remaining groups of ADR 0001 are added in the change that ships their routes, so the rail never links to a page that does not exist.
- **Role filter:** items come from the `role × item → visible` table in `src/features/navigation/`; hidden items are not rendered, not merely disabled. Route guards reuse the same table.
- **Responsive (shipped):** under 1040px the rail becomes an off-canvas drawer (`--motion-base` slide, `.sgn-scrim` behind it, menu button with `aria-expanded`/`aria-controls`); the drawer closes on `Escape`, on the scrim and on navigation, traps Tab inside itself, and returns focus to the menu button. Above 1040px the rail is sticky at `--sidebar-w`. `--logo-size` and `--topbar-h` step down at 1039px.
- **Access:** one skip link to `#main-content`; the shell never renders for a denied identity (§6).
- **Session:** on window refocus the shell re-checks `/api/session`; on denial it clears page data and leaves the shell (§6). A refocus that follows no concealment re-checks the live session only — an unchanged identity, role and access revision never re-read data that is already displayed, so switching windows leaves a visible list in place, while a changed identity, role or revision conceals the surface and reads again for the new authority. A protected read brackets its data with the session before and after it and, after three consecutive superseded revisions, stops with a localized notice that access changed and the page must be reloaded; no data from a superseded read is kept.

### 3.1 Menu groups → routes

| Group | Items (route) | Roles |
| --- | --- | --- |
| Inventory | Search (`/properties`); New property (`/properties/new`, shipped) | all |
| Reservations & Reviews | My requests (`/requests`); Reviews hub (`/reviews/…`, corrections shipped) | all; queues per role |
| Rentals | Agreements (`/rentals`) | staff, manager, admin |
| People | Employees (`/people/employees`, shipped: list with per-row recorded edit, admin); Vendors (`/people/vendors`, shipped, all roles); Contacts (`/people/contacts`, shipped: directory, Owners view and shared-detail correction, all roles) | admin; all; all |
| Reports | My activity (`/activity/me`, shipped); Company (`/activity/company`, shipped); Provinces (`/activity/provinces`, shipped) | all; manager/admin; manager/admin |
| Admin | Categories (`/admin/categories`); Units (`/admin/units`) | admin |

`/reviews` redirects to the first queue the role can see. Detail is reached from inventory, never from the menu.

## 4. Shared component vocabulary

The contract is `src/app/sgn-app.css` — the ported design package. Compose these; do not introduce a second control vocabulary or a value the tokens do not define.

| Component | Classes (package) | Notes |
| --- | --- | --- |
| Content region | `.sgn-content` (the shell's `<main id="main-content">`) | `--content-max` 1280px, `--gutter-x` padding; the page renders inside it and owns no `<main>` |
| Page head | `.page-head` > `.page-intro` (`.example` eyebrow, `h1`, `.intro-copy`) + `.page-actions` | one accent action per viewport |
| Toolbar / search | `.toolbar`, `.toolbar-search` (the search form), `.search` > `.input` + `.search-btn`, `.search-hint`, `.chips` > `.chip` | one wrapping row of search, the Cards/Table view switch and the filter trigger; filters as chips; the package's `.seg` is the view switch, rendered only above the phone breakpoint (below it cards are the list); the chronological ordering that used to sit here is submitted from the filter panel's advanced section (#194) |
| Card / section | `.panel` > `.panel-head` (`.panel-title`, `.panel-note`) / `.panel-body` / `.panel-foot` | white, `--radius-lg`, hairline border |
| Property card | `.property-card` inside `.property-list[data-view="cards"]` > `.cover` + `.card-body`/`.card-meta`/`.card-address`/`.card-entry`/`.card-foot`/`.card-actions` | the cover holds the plate, or a stored photograph; `.card-entry` (repo-only, added in `sgn-app.css`) shows the original entry date, legacy marker and Vietnam age in the chronological views, or the explicit unknown date and unknown age |
| Site plate | `.cover > svg.plate.plate-card`/`.plate-bare`/`.plate-hero`, `.plate-*` internals | one scale per record; repo-only placeholder text comes from the component |
| Status pill | `.badge` + `data-tone="neutral\|muted\|success\|warn\|danger\|accent"` | the localized label carries the meaning; the tone dot never replaces it |
| Buttons | `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-block`, `.is-loading`, `.icon-btn` (`data-busy`) | the auth screens use the same classes; `.icon-btn` is the icon-only control whose localized label is both the accessible name and the native tooltip |
| Actions menu | `.actions-menu` > `.actions-menu-item` (`role="menu"`/`role="menuitem"`) | the record action bar's single trigger: arrow keys rove, Escape closes and returns focus to the trigger, an outside press closes |
| Fields | `.field` > `.field-label-row` (`.field-req`), `.input`/`.select`/`.textarea`, `.field-unit`, `.check`, `.field-hint`, `.field-error` | one control set for every form |
| Rows / detail | `.detail-head`, `.detail-sub`, `.detail-body`, `.detail-rail`, `.chips.head-chips`, `.facts` > `.fact` (`dt`/`dd`, `.is-unknown`), `.record` > `.record-head`/`.record-title`/`.record-body`/`.record-meta` | facts print `Chưa rõ` for unknown values, never a dash |
| Files | `.doc-row`, `.doc-icon`, `.doc-name`, `.doc-meta`, `.doc-actions`, `.dropzone`, `.cover-slot`, `.pager` > `.pager-status` | replaces the legacy file list; the row actions are `.icon-btn` controls, the list is bounded to five rows a page and the empty cover slot is an add-cover action |
| History / price | `.timeline` > `.tl-item` (`.tl-time`, `.tl-title`, `.tl-body`, `.tl-actor`), `.hist-row` (`.hist-when`, `.hist-change`, `.hist-field`), `.price-series` (`.price-series-title`) > `.price-row` (`.price-when`, `.price-change`, `.price-note`, `.price-who`) | `property_history` events render through the history rows, each recorded value on one clipped line (`.history-comparison dd`) with the full text kept in the DOM and on its `title`; the record's recorded sale/rent series (#36) renders through the price rows |
| Comments | `.comment` (`.sgn-avatar` cell + body) > `.comment-author`, `.comment-meta`, `.comment-body`, `.comment-actions` (`.icon-btn`), `.composer` > `.composer-foot` | 2,000-character contract unchanged; the panel body supplies the card inset the row itself does not draw |
| States | `.state-panel` (+ `data-tone="danger"`, `.state-mark`, `.state-title`), `.skeleton-region` (`role="status"`) > `.skeleton`/`.sk-card`/`.sk-items`, `.alert` (+ `data-tone`), `.toast` | loading, empty, error and denial stay distinct; empty ≠ zero ≠ denied. Every surface that waits for data draws a skeleton of its own shape instead of a spinner or a loading line |
| Lists / tables | `.data-table.stackable` (`[data-num]`, `data-label`), `.pagination` > `.page-info` + `.page-buttons` > `.pager-btn` + `.pager-jump` (typed page) | tables stack to label/value cards under 640px |
| Dialogs | `.sgn-dialog` > `.sgn-dialog-panel`/`.sgn-dialog-head`/`.sgn-dialog-body`/`.sgn-dialog-foot` | native `<dialog>`: focus trap and Escape come from the platform. The dialog head always renders the title; a `.panel` mounted directly in `.sgn-dialog-body` gives up its own frame, heading and inset, so the surface has one title in the header and one border |
| Repo-only surfaces | `.maintenance*` (disclosures, inline editors), `.history-event`, `.history-comparison`, `.history-field`, `.owner-disclosure`, `.owner-phone`, `.reservation*` (`.reservation-effective`, `.reservation-pending`, `.reservation-request`), `.proposal-choices`, `.contact-choices`, `.eyebrow` (auth), `.comment-removed`, `.comment-edited`, `.comment-edit` and `.comment-moderation` (extensions to the comment row), `.vendor-note` and `.data-table .is-unknown` (vendor record), `.card-entry` (the chronological card line), `.sgn-location`/`.sgn-map*` (the location map and its caption row), and the inventory-stream controls `.inventory-chunk`, `.inventory-table`, `.inventory-row`/`.inventory-row-control`, `.inventory-cell`, `.inventory-price`, `.inventory-note`, `.inventory-gap`, `.seg a.seg-btn` and `.sgn-dialog[data-size="drawer"]`/`.quick-view*` | `globals.css` + `sgn-surfaces.css`, except `.card-entry`, the `.sgn-map*` location controls and the §2 record-surface controls in `sgn-app.css`; package tokens only |

## 5. Page layouts

All page bodies render inside the shell `main` region; `SessionHeader` is gone from them.

### 5.1 `/properties` — Inventory *(shipped)*

```
.sgn-content
  .page-head:  .page-intro (.example · h1 · .intro-copy)   |  .page-actions [ Company activity ] (manager/admin)
  .toolbar > .toolbar-search (form > .search > .input + .search-btn) · .seg (Cards | Table view switch — two same-page links with aria-current; rendered only above the phone breakpoint) · .btn filters trigger + count badge
  .row-between: .btn.btn-secondary.btn-sm (filters trigger + count badge) → dialog#inventory-filters (.sgn-dialog-panel > .form-grid-3 status·mode·type selects · .form-section > .form-grid contact name search, its bounded result list and Next page, with .field-hint · .form-section > .form-grid province/district/ward unit pickers - the levels the chosen address format has (legacy states all three, current states no district), every one shown at once with each dependent picker disabled and hinting until the level above it is chosen, with .field-hint and a .field-error when the catalog fails · .form-grid price/land-floor-area bounds with .field-unit · .form-section > .form-grid ordering select (no ordering · entry date: oldest first; an address that already states the newest entry date reflects it without offering it) · .sgn-dialog-foot Clear/Apply, or Run advanced search when the run it would perform is a whole-inventory search - a draft criterion the catalogue cannot answer, or the address's submitted query) · .chips > .chip (applied filter conditions, each with a remove control)
  .search-hint rows (search rules; the chronological scope and unknown-date placement when an order is active)
  .result-line in .row-between (the matching total, stated by every read)
  .inventory-stream[data-view="cards|table"]: gap(.inventory-gap, band.top) · .inventory-chunk × mounted · gap(band.bottom)
      cards: .inventory-chunk > .property-list[data-view="cards"] > .property-card × N
          .cover > Plate(card)  |  stored cover photograph
          .card-body: .card-meta (code · mode) · .card-address > a · .card-entry (original entry date · legacy marker · Vietnam age, or unknown date · unknown age) · .card-entry (creator display name, omitted when the creator no longer resolves) · .card-foot > .badge[data-tone] · .card-actions (quick view)
      table: .inventory-table > thead (the eleven column headings, sticky under the top bar) + one tbody.inventory-chunk per mounted chunk; each row's first cell is a th[scope="row"] holding .inventory-row-control, the rest .inventory-cell[data-column] with the price as .num.inventory-price; an unloaded chunk is one reserved full-width row
  .sgn-dialog[data-size="drawer"] > .quick-view (head: code · address · status badge · price; .facts, with the record's note as source text when it has one; quick upload; recent comments + composer; full-record link)
  states: .skeleton-region (loading) · .state-panel (empty) · .state-panel[data-tone="danger"] (error)
```
Shipped: the list is one continuous result set of everything the filters match, ordered newest created first by default (the entry-date chronology, which is the eligible-status database view, is chosen in the filter panel) and paged window by window as the page scrolls, with only the rows near the viewport mounted in the page and the matching count stated by the same rows that answer each window (issue #154; the numbered pager, the page-size parameter and the cursor trail are gone, and [`docs/adr/0002-inventory-list-stream-and-table-view.md`](adr/0002-inventory-list-stream-and-table-view.md) records why). The card cover is the site plate drawn from the record's own fields; a stored cover photograph wins; a record with no areas keeps the plate's muted placeholder. The Cards/Table `.seg` switch now ships above the phone breakpoint: switching keeps the search, the ordering and the filters (the view travels in the address beside them) and never changes the read, and the table draws the eleven requested columns with the price emphasised in tabular numerals, a missing value as an em dash and the total area as floor area with a land-area fallback (issue #155); below 641px the table is not offered and cards are the list. A row — card or table — is a real keyboard-reachable control: it opens the property's quick view from the right by click, Enter or Space; the drawer repeats the key metadata, states the recorded asking prices - a missing one as the same missing-value marker the record page states - and offers their edit to the same employee the full record's editor is offered to, saving through that editor's own maintenance path and reporting the server's answer to the browser catalogue so the row behind the panel takes the new price without a reload; it posts a comment without a reload, runs one attachment through the existing upload path and its per-class limits, links into the full detail page, closes on Escape and returns focus to the row that opened it (issue #156). The chronological order still starts a new journey without rewriting the search, and the active order adds the `.card-entry` line to each card. The two panels that used to sit under the results — the create-property form and the correction queue — moved to their own destinations (`/properties/new`, `/reviews/corrections`); `/properties` keeps search, results and the view switch. Status, listing mode, property type, an asking-price range, a land/floor area range in m², the address format a search is matched through (the panel offers the legacy address, open by default, and the current one; the format chip that always states the applied format clears it to a search of both formats once removed, issue #243), the address's administrative area (the levels the chosen address format has: a province/city picker and its dependent district and commune/ward pickers for a legacy address, a province/city picker and its dependent commune/ward picker for a current one, every level of the chosen format offered as soon as the panel opens with each dependent picker disabled and hinting until the level above it is chosen, issue #247) and a recorded contact linked to a property (the same bounded name search and Next-page selector the property maintenance panel uses, so the panel reads one page per request rather than the whole directory) are the search island's filters: the trigger sits beside the search box, the panel carries the same set in the dialog/form vocabulary rather than chips, and every applied condition returns as a removable chip while the address stays the single source of truth.
The address box itself narrows the loaded property catalogue in the browser as a person types - no request per keystroke, while the result is the loaded catalogue; an address that states a submitted search keeps that whole-inventory result until the box is submitted again - and the list states how many of the loaded properties match and that the search button searches the whole inventory; submitting the box keeps the server search it always had (issue #188, [ADR 0003](adr/0003-browser-property-catalogue-and-local-address-search.md)). The catalogue now keeps arriving in the background: after the first page the browser follows the endpoint's cursor to the end of the authorized inventory, deduplicating and indexing each batch, and a `.catalogue-progress` line beside the search help states the loaded count, the authorized total and an approximate percentage when the total is known - held below 100% until the final batch is indexed - or the loaded count alone when it is not, with a Retry beside it when the load stopped early and a last-updated time once it finished. The progress element carries a numeric value only while determinate and is not a live region; while the catalogue is incomplete an empty result reads as no matches in the loaded properties and adds that more matches may appear (issue #189). The deliberate Refresh control sits on that line once the catalogue is complete: it builds a replacement catalogue in the background, states the replacement's own loaded count and total on its own `.catalogue-progress` line while the line above keeps stating the catalogue in use, swaps it in only once the replacement is complete, and on a stopped refresh keeps the previous catalogue and its last-updated time and offers Retry (issue #190). A change the server commits - a saved fact or address, an applied correction, a create, a merge, a status change or an approval - replaces the affected row in that catalogue from the server's own answer and reindexes its addresses, so the list shows what the server now records and search finds the property under its current address and not the version it moved from; a change that no longer matches the active local query stops appearing, a change that raced a catalogue read is never overwritten by the older answer, and a status changed from the quick view re-reads the server windows the list is drawing instead of keeping the rows the page already held, while a change the server commits but cannot hand its summary back for makes the browser read the catalogue again rather than keep a row nothing confirms (issue #193). A lock is still decided by the database: a competing reservation shows the conflict above the panel's own controls and refreshes the property from server state rather than leaving the cached status on screen The filters, the ordering and the result paging then left the database: the ordinary browse, status, listing mode, property type, the address format, the asking-price and area ranges, the typed address and property-code match and the paging are all computed from the loaded rows and issue no request, and the filter panel states which criteria it can answer that way and which are a whole-inventory search - the province/city and commune/ward selects, the contact filter and the entry-date ordering - held until the panel is run, with its action named "Run advanced search" when the run it would perform is that search (any of them, or the address's submitted query). Advanced pages are cached under their own keys (the user scope, the submitted criteria, the ordering and the page) with a bounded retention separate from the catalogue's, and the list says which of the two answered it: a locally filtered or partially loaded result is never presented as a search of the whole inventory, and a typed text the browser matches nothing for states the fields it did match and offers the whole-inventory search for that text rather than leaving an empty local answer (issue #194, [ADR 0003](adr/0003-browser-property-catalogue-and-local-address-search.md)).
Opening a property from the list and coming back restores the list the person left - the text in the address box (typed, and not necessarily submitted), the filters, the ordering, the result view, the position in the stream on both axes and the document's own offset above the stream - without reading the catalogue again, and it is the same list for a locally filtered result as for a server one; a reload of the application is what starts over (issue #192, [ADR 0005](adr/0005-inventory-list-state-across-a-property-visit.md)). The position is applied once the results have rendered - after the read has stated the total the stream reserves its height from - and held until the stream's own scroll reaches it, so it lands on the rows it described instead of being clamped onto a height that is not there yet, and the windows around it are read again as the restored band asks for them. The stream is a labelled `region` in both views and takes a tab stop, because it is its own scrollport in both: with the region focused, PageDown scrolls it.### 5.2 `/properties/[id]` — Detail *(shipped, minus the items noted)*

```
.sgn-content
  quiet back link (.link-quiet) → returnTo (keeps the filtered result position)
  detail-head: .example eyebrow · h1 (record code) · .chips.head-chips (status + review status badges) · .detail-actions (one "Record actions" menu trigger: completed-sale confirmation for manager/admin, Reservation, Edit facts, Correction requests, My requests)
  archived notice: .alert[data-tone="neutral"] with the archive mark
  detail-body (two-column grid, single column under 1180px): main column + aside.detail-rail
    main column:
      .tabs[role=tablist] "Tổng quan · Tài liệu · Thảo luận" (roving tabindex, arrow/Home/End)
      .tabpanel "Tổng quan":
        panel .plate-hero (top of the grid)  → Plate(hero) | stored cover photograph
        panel Facts      → dl.facts with .fact rows; unknown values print Chưa rõ
        panel Price history → two .price-series groups (sale asking price / monthly asking rent) of .price-row (.price-when, .price-change, .price-note, .price-who), newest-first with per-series paging
        panel Addresses  → .record rows + mapping .badge, a legacy address's official province → district → ward line and its own ward's crosswalk state, .addrNote policy line, then for a shared address the .alert[data-tone="neutral"] count of the other records carrying it with a Compare action (issue #147)
        panel Location   → the recorded point as plain text (.sgn-location/.sgn-map*): its .sgn-map-caption line with an "open in map" link, or the explicit no-location line. The location map itself is not drawn on the record screen; it stays only in the edit form's coordinate picker
        panel Contacts   → .record rows + owner-contact disclosure (.owner-disclosure/.owner-phone)
        panel Vendors    → .record rows of linked supplier companies, separate from owners and brokers; an active-employee .maintenance disclosure on an unarchived property searches the directory, links one company and confirms removing a mistaken link (issue #74)
      .tabpanel "Tài liệu": panel Files → property-files Workspace (.doc-row vocabulary with labelled icon row actions, five-row .pager, cover with an add-cover icon action, dropzone)
      .tabpanel "Thảo luận": Discussion → 30-item list newest-first, .composer, author edit and withdrawal with reasoned manager/admin removal (.comment-actions labelled icon buttons, .comment-edited marker, .comment-edit editor, .comment-removed marker, .comment-moderation), and the reviewer-only retained history (.comment-history event list with Vietnam-time instants and the honest has-more notice)
    aside.detail-rail (sticky):
      panel History    → maintenance history rows (.hist-row) whose before/after halves and label/value pairs stack in the rail (.detail-rail .history-comparison), one clipped line per recorded value
      page-view note, then panel Activity → today's own counts
  record action dialogs (siblings of .detail-body, content mounted only while open), opened from the actions menu. Every dialog renders one title in its header; a section mounted inside it drops its own panel frame, heading and inset:
    dialog "Completed sale" → reviewer-only confirmation form (credited closer, actual Vietnam date, contract reference) or the recorded completion (.sale-completion/.sale-completion-recorded), manager/admin only
    dialog "Reservation" → effective/pending states (.reservation-effective/.reservation-pending) + request and decision forms; a manager/admin also gets the reasoned release control on an effective reservation
    dialog "Edit facts" → maintenance workspace (revision-checked) in three sections: *Property facts*, the default opening section, then *Address corrections* and *Contact corrections*. The tab strip switches to a labelled dropdown at 720px, so only one of the two shapes is ever rendered. *Property facts* also carries the map location editor, whose click-to-place map is the pointer path and whose type-the-coordinates controls are the keyboard alternative. Address rows and their correction controls live only in the address section, so the page's own address panel is not repeated here.
    dialog "Correction requests" → correction report (the .maintenance disclosure)
    dialog "My requests" → role-scoped correction queue; each request shows the fields the proposal names, as before/after pairs, with the retained amendments in a disclosure
    dialog "Compare records at one address" (opened from the address panel, not the actions menu) → .data-table.stackable comparing sale price, floor area, dimensions, owner names, status and listing mode with the kept record badged, [Keep both] which closes writing nothing, and a manager/admin-only [Merge records] reaching a second confirmation that names the kept and every merged record before it reports exactly what moved (issue #147)
```
Shipped as above. The three groups and the main/rail split follow the package's own record screen
(`ui_kits/app/components/App.jsx`: `overview | docs | comments` inside a `<div>`, beside `<aside class="detail-rail">`).
Before this the panels were direct children of `.detail-body`, so the two-column grid placed them in alternating
columns and the facts panel rendered inside the 344 px rail. Inactive tabpanels stay mounted but `hidden`, so a
tab switch neither refetches nor loses an in-flight upload. **Not implemented:** a dedicated record-edit route —
there is no `/properties/[id]/edit`; the record's *Edit facts* action opens the maintenance workspace in a dialog instead.
No new route was added.

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
Routes: `/reviews/corrections` (shipped as **Correction requests**: page-intro plus the correction queue, guarded by its own protected read — every active employee reads their own requests, and staff/manager/admin decide them), `/reviews/reservations`, `/reviews/rental-activation`, `/reviews/sale-completions`, `/reviews/closure-corrections`. Same layout shell; each queue is its own route and guard. `/reviews` redirects to the first permitted queue. Issue #38 ships the sale confirmation interaction on the property detail instead of the planned `/reviews/sale-completions` queue; that queue remains unbuilt. No physical-visit queue is planned at any point: visit submission and independent visit confirmation were retired in favour of the automatically recorded owner-contact access measure, retained `site_visit` rows are history only, and independent reservation approval is unaffected.

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

### 5.6 `/people/employees` (shipped: list, per-row recorded edit, invitation, guarded deactivation and permanent account deletion, admin)

```
page-intro (.example · h1 · .intro-copy)
panel Employees → details.maintenance [Record an invitation]
  email field + existing-role select → [Send invitation]
  recorded invitation summary: invited address · role · state badge (pending / reconciliation required / recorded / none recorded)
  provider-acceptance note (not delivery) · recorded provider failure detail · [Retry]
  .data-table.stackable: name · bio · email · role · access state · actions
  access badge + recorded invitation badge + recorded deactivation badge + recorded deletion badge
  [Edit details] → .deactivation-panel
    recorded email (fixed value, not a field) · display name · phone (optional) · role select · bio
    .field-hint on each bound and on the bio's visibility · [Save profile] · saved-changes note
  [Deactivate access]/[Reconcile sign-in block] → .deactivation-panel
    target identity · recorded action state · outstanding reservations (effective/pending + expiry)
    release-or-expiry note · finite provider-ban note · [Confirm deactivation]/[Retry] · [Close]
  [Delete sign-in account]/[Reconcile account deletion] → .deactivation-panel
    retained-employee identity · retention note · recorded state incl. blocked Storage ownership
    owned/reassigned file counts · outstanding reservations · typed-email confirmation field
    [Permanently delete the sign-in account]/[Retry] · [Close]
  .panel-foot → .pagination (.page-info + .page-buttons > .pager-btn)
  states: .panel-note[role=status] (loading) · .state-panel (empty) · .alert[data-tone=danger] (error)
```
Shipped: the list reads existing employee identities from `GET /api/employees` and shows the recorded display name, email, role, access state (`Đang hoạt động` / `Đã tắt truy cập` / `Chưa liên kết đăng nhập` / `Đã xóa tài khoản đăng nhập`) and the recorded invitation state, at most 30 rows per page with a keyset cursor. An employee with no recorded invitation is labelled not linked and never invited, and is never presented as a deleted person: the marker comes only from a recorded invitation row, and account deletion is a separate recorded state. The rail renders the destination for admin only and the proxy refuses a direct visit by another role. A live admin confirms deactivation from the row: membership is disabled first, the exact Auth sign-in block is confirmed through the server-only adapter, and the recorded `provider_pending` / `provider_failed` / `completed` state is shown next to the access badge so a disabled membership is never presented as a completed deactivation. The panel lists the departing employee's outstanding reservations with their expiries and states that release or expiry stays with the existing claimant, reviewer and expiry rules; no reservation is transferred or rewritten, and the finite provider ban is described with its renewal rule rather than as infinite. While the provider step is pending or failed, an admin can reopen the row and retry the same action.

Permanent account deletion is a second, separately recorded control on the same row, offered only for an employee whose sign-in account is still linked. Its confirmation names the exact retained employee and states that the sign-in account is permanently removed while the business record remains, describes the Storage ownership preflight and reassignment without promising to delete a file, lists the same outstanding reservations, and keeps its destructive control disabled until the employee's own email is typed — the target-specific confirmation vocabulary, reusing the existing field, hint, badge and panel classes rather than a remote dialog. The recorded state distinguishes `provider_pending`, `provider_failed`, `storage_blocked` and `completed`, so a blocked Storage ownership step is never shown as a generic failure or as a deletion. Deletion, inactive access and an unlinked imported person are three different badges, and a completed deletion row offers no lifecycle action at all.

A live admin also records an invitation from the `[Record an invitation]` disclosure: one validated normalized email and one existing company role, sent to that recorded address through the server-only adapter, with the recorded `provider_pending` / `provider_failed` / `recorded` state shown in the form and beside the row. A recorded invitation is described as the provider holding an identity for the recorded address, never as an accepted request, delivered mail or active access; a refused address (already a recorded employee), a conflicting role for an open invitation and a reused submission key each show their own message, and an ambiguous or failed send keeps the same recorded invitation and offers a retry. When the reconciliation read returns an employee with no invitation row, the summary says no invitation is recorded instead of leaving the state unknown.

A live admin edits one recorded employee from that row: one panel carries the display name, phone, role and bio, the sign-in email is shown as a fixed value and is not a field, and the save reports which recorded fields actually changed. The row shows each person's recorded bio in its own column. A deactivated or deleted employee offers the reason instead of a form, and a save that would leave no active admin is refused with its own message ([database contract](database-contract.md#employee-profile-edit-and-the-persons-own-profile)).

Still planned, not shipped: the last-activity column, the `[Activate]` row action, and any per-employee route. The invitee's own account setup is not an admin row action: it lives at the fixed `/auth/invite` destination (issue #69, §6).

### 5.6a `/profile` (shipped: the signed-in person's own name and bio)

```
page-intro (.example · h1 · .intro-copy)
panel (.page-section): display name (required, ≤120) · bio (≤280, plain text)
  .field-hint: the bio appears on this person's entry in the employee list
  sign-in email is stated as not a field · [Save profile]
  .panel-note[role=status]: saved / nothing changed
summary-list: recorded role
states: loading · .alert[data-tone=danger] (load or save failure) · denied keeps §6
```

Shipped: reached from the account menu, `/profile` sits in the proxy matcher and requires live membership. Both the read and the save resolve the person from the session, so the page carries no employee id and offers no phone, role or email field; the recorded role is shown, not edited. A saved name is handed back to the account menu so it needs no second session read. Vietnamese/default and English.

### 5.6b `/people/vendors` + `/people/vendors/[id]` (shipped, issue #73)

```
page-intro (.example · h1 · .intro-copy)
panel search: .toolbar > .search > .input + .search-btn, .search-hint
panel [Record a vendor] (staff/manager/admin only): .field × 6 → company name (required),
  contact name, phone lines, email, address/source text, notes; .form-foot submit
panel Vendor directory → .data-table.stackable: company (row link) · contact · phones · email
  .panel-foot → .pagination (.page-info + .page-buttons > .pager-btn)
  states: .panel-note[role=status] (loading) · .state-panel (empty / no match) · .alert[data-tone=danger] (error)
detail: quiet back link · .detail-head · panel .facts (recorded contact block; unknown details
  read as unknown, never a dash) · panel linked properties (.record rows: property code →
  property record, state badge, link time; bounded to 50 with an explicit cut note)
```
Shipped: `GET /api/vendors` serves the newest-first bounded directory through `list_vendors` (at most 30 rows, keyset cursor pair); `POST /api/vendors` creates one company through the guarded `create_vendor` operation for a live staff/manager/admin, keeping the draft and the submission key on failure; `GET /api/vendors/[id]` reads one recorded identity and its authorized linked-property projection (ticket #74), which hides an archived property outside the reader's role. Every active role sees the People → Vendors destination; only maintainers see the create panel, and the route and database refuse the mutation independently. Detail has no edit control in this slice; a property's own Vendor section is the only link/unlink surface, and every active employee sees those controls on an unarchived property they can read. Contact creation and contact-link maintenance remain staff/manager/admin-only.

### 5.7 `/people/contacts` (shipped, issue #71, all roles)

```
page-intro: People · Contacts · shared-identity note
panel: .tabs.directory-tabs filter navigation (All contacts · Owners) → .toolbar > .search
  (name only, literal fragment) + .search-hint
panel Contact directory → .data-table.stackable: contact (row name + classification) ·
  property relationship · recorded phone · linked properties (active-link count + codes) · [Open and correct]
  expanding row → .row-detail > .row-editor: recorded details (.facts) · affected properties
  (.impact + .chips) · same-person confirmation + allowlisted fields (MutationForm)
  reserved chunk → .inventory-gap row + .inventory-window > .skeleton-region, sized to the
  rows about to arrive
  .panel-foot → .result-line (rows the stream has read; no pager)
  states: .panel-note[role=status] (loading) · .state-panel (empty / no match, per view) ·
  .alert[data-tone=danger] (read failure, correction failure) ·
  .alert[data-tone=neutral] (contact-refusal)
```

Shipped as a stream (issues #176–#178): the contacts table keeps only the rows near the viewport in the page and reads the next window as the person scrolls near their end, using the shared window arithmetic and fetch-on-scroll hook in `src/features/stream`. The search and the Owners/All tabs still name the one read every window is a slice of, so changing either starts the stream again at its first window, and the pager is gone: the footer states the rows read so far instead of a page number. Read permissions, the recorded phone and the row editor are unchanged.

Shipped: `GET /api/contacts?query=&after=&view=` serves the ascending-id bounded page (at most 30 rows and a follow-page cursor) through `list_contacts`; every active employee reads it. The Owners view keeps only identities with a readable recorded `relation='owner'` link, so an identity classified as an owner without that link is not listed and a broker on one property may be listed as an owner of another. Each row shows its readable per-property relationships, the recorded phone strings (or the recorded source text) and the linked properties with their active-link count (#122); the count is the number of listed links whose property is not archived, which is the same condition the inventory contact filter applies, and it is stated even when it is zero — so a row listing a labelled archived property reads "0 active links" instead of an untrue total, while a contact with no readable link keeps the "no linked property" reading rather than a zero. A relationship hidden by the archived-property boundary is simply not presented, and the correction refuses rather than leaking it. `GET /api/contacts/[id]/name` returns only the recorded display name of one readable identity — the same member read the directory lists with and no affected-property guard — so an applied inventory filter can name its contact even where the guarded detail refuses. `GET /api/contacts/[id]` returns the recorded identity, the revision and the readable affected properties; the expansion shows them and saves through `POST /api/contacts/[id]` — the same revision-checked shared-identity operation the property maintenance panel uses, with the affected-property preview and the explicit same-person confirmation. Changed values appear immediately after the save and on each affected property's fresh read, and the correction records no property history entry (issue #109). Creating a shared contact and creating/replacing/unlinking a property relationship remain staff/manager/admin controls and are not offered here; the expansion is offered for an identity with at least one readable property link to every active employee, and for an unlinked identity to staff/manager/admin only (issue #72), while sales still sees the linked-only editor.

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

Shipped for issue #38: the completed-sales ranking alone is delivered at `/reports/completed-sales` — a manager/admin rail entry with the validated Vietnam range filter, tied ranks, an explicit total and the separate unknown-attribution note; the reviewer-only confirmation form lives on the property detail in a dialog opened from the record action bar rather than as a `/reviews/sale-completions` queue, and the province and completed-rental panels above remain planned, while the owner-contact activity ranking ships on the delivered company-activity report at `/activity/company` (see the shipped-route note below, #34).

### 5.10 `/admin/categories` · `/admin/units` (new, admin)

```
page-intro · [New category] / [New unit]
.data-table: name · builtin · created by · created at   (list + create only; no rename/delete/merge)
```

## 6. Cross-cutting states

- **Fixed invitation destination:** `/auth/invite` is the shell-free `(auth)` route an invitation email points at (issue #68) and the invitee's own acceptance journey (issue #69). The link's fragment carries the invite session; the screen reads it once, posts it to the session endpoint and drops it from the URL only after that endpoint answers, so no token survives in history or a referrer. The `auth-card` then shows one of the localized phases: verifying, the setup form (recorded email read-only, required name, new password with the existing strength meter, confirmation), setup complete, or a refusal. The refusal keeps the existing error surface and offers retry only for a transient outage, otherwise a link to sign-in. Every phase stays shell-free, claims no delivery, and shows no employee data beyond the recorded address; the language switch here sets presentation language only.
- **Denied / inactive:** the shell is never rendered. `/access-denied` stays in the `(auth)` group and is shown shell-free; a membership or identity denial returns `403` with a localized access-denied message, never an empty inventory. An object-level refusal (`contact-refusal`) keeps the current page and its state with a localized inline message instead ([maintenance contract](maintenance-contract.md#shared-identities-and-local-links)).
- **Loading / empty / error:** the package's own states — `.skeleton-region` (one polite `role="status"` announcement over `aria-hidden` shapes, held back briefly so instant data never flashes) for loading, `.state-panel` (with `.state-mark`, `.state-title`, optional `data-tone="danger"`) for empty and error, `.alert` for inline feedback and `.toast` for transient confirmation — each with localized text. Empty ≠ denied and empty ≠ zero: an event-free day is an explicit `0`, not a blank.
- **Failed saves:** keep the draft, show a localized error, never a false success.
- **Save confirmations:** one `.toast-region` host in the shell announces every committed save in a polite live region (bottom right at desktop widths, top centre below the top bar at 640px and under), dismissible by its own button and by the keyboard, expiring on its own; a committed save from a dialog closes that dialog first, so the confirmation never competes with the surface it came from. A refused save raises none.
- **Sign-out / denial after load:** clear displayed inventory, contact and discussion data; Back/refresh must not reveal it.

## 7. Localization, accessibility, responsive

- **i18n:** VI default + EN for every label, badge, control, empty/loading/error state and format. Shell/nav/global strings in `src/i18n/messages.ts`; page areas get feature-local files (e.g. `src/features/reviews/messages.ts`). Never translate source records; Vietnamese addresses, phone strings, VND and m² stay verbatim. Dates `dd/MM/yyyy`, times in `Asia/Ho_Chi_Minh`.
- **Accessibility:** skip link; visible focus (`:focus-visible`); every input has a label; interactive hit areas ≥44px; status conveyed by text, not colour alone; `<details>` disclosure is keyboard-operable; drawer has a focus trap; tables use `<th scope>`.
- **Responsive breakpoints (shipped):** 1039/1040px (rail → drawer; `--logo-size`, `--topbar-h` step down; `.detail-head`/`.detail-body` collapse), 720px (the language switch switches to its short form; the Edit-facts section chooser switches from the tab strip to its dropdown), 640px (content padding, `.property-list` to one column, `.facts`/`.price-row`/`.doc-row` stack, `.data-table` to stacked cards, dialogs widen to the viewport), 480px (history comparison stacks to one column, and its values stay one clipped line each at every width, so no history row overflows the page). Print hides the rail, topbar, scrim and toasts.

## 8. Open decisions and flags

- **D1 (tokens): resolved** — see §2 for what shipped.
- **Badge tones: resolved** — `.badge` is the package's outline pill with `data-tone`; the mapping-status and record-status labels keep their localized text and were checked at 375/1039/1040/1440px.
- **Shell refactor: resolved** — `src/features/employees/session-header.tsx` is deleted; the shell owns the crumbs, the language switch (persisted through `set_my_locale`, cookie-backed, re-rendered by the root layout) and the account menu.
- **Tables:** the company and personal activity reports and the employee list render `.data-table.stackable`; reviewer/queue lists still stay as `.history-event` rows because each row expands to a decision form.
- **Locale propagation:** locale is a cookie + `set_my_locale` preference; the shell re-renders the route on change, so page components no longer own locale state (`applyLocale` was removed from `useProtectedData`).

### Shipped-state gaps (deliberate, not silent)

- Navigation renders four groups: Inventory (`/properties` and `/properties/new`, every role), Reservations & Reviews (`/reviews/corrections`, every role — the queue reads the caller's own requests while only staff/manager/admin decide), People (`/people/employees`, admin; `/people/vendors` and `/people/contacts`, every role) and Reports (`/activity/me`, every role; `/activity/company`, `/activity/provinces` and `/reports/completed-sales`, manager/admin). The ADR's other two groups (Rentals, Admin) ship with their routes.
- The inventory results are **cards and table**: the package's `.seg` switch ships as two same-page links (Cards | Table) above the phone breakpoint, and the table is not offered below 641px; the chronological oldest/newest ordering left the toolbar's order select (#37) for the filter panel's advanced section, so the ordinary browse can filter the loaded catalogue without a read (#194), and the stream, its windows and the drawer are described in §5.1 (#154–#156). The package's `.cell-plate` table thumbnails still have no consumer: the table's columns are the ten the ticket names and no plate column.
- The card shows the record's existing fact set (code, mode, address, status), plus the original inventory entry date, legacy marker and Vietnam age in the chronological views (#37), or the explicit unknown date and unknown age. The prototype's card also prints area and price lines; adding them would be new data display beyond this restyle, so they were left out.
- The record page's *Edit facts* action opens the maintenance workspace in a dialog; no dedicated edit route exists.
- The change timeline (`.timeline`/`.tl-item`) and the **Nhân sự & liên hệ** screen (employee accounts + contact book, `.directory-tabs`, `.cell-person`, `.sgn-avatar-sm`) are rendered in the design review route `/design/app-preview` from fictional fixtures. The asking-price timeline (`.price-row`) now ships on the record from the recorded sale/rent series (#36); the employee list ships separately (§5.6), and the contact book's `.directory-tabs`, `.cell-person` and expanding `.row-detail`/`.row-editor` vocabulary now ships on the real directory (§5.7) — only the fictional fixtures stay in the review route. `/requests`, the rest of `/reviews/*`, `/rentals*`, `/admin/*` remain unbuilt and are only described above.
- The personal activity report (#30) shipped at **`/activity/me`** rather than this document's planned `/reports/activity`, with its own acceptance evidence and API path (`/api/activity/me`), and the company employee-by-day report (#57) shipped at **`/activity/company`** rather than the planned `/reports/company` with API path (`/api/activity/company`); both routes were left where the features shipped and the rail's Reports group points at them. Issue #34 added the owner-contact activity ranking to that shipped report as the `# · employee · owner-contact properties` table above the daily history, read through `employee_owner_contact_ranking` behind the same endpoint, range filter and denial states. The province owner-contact table (#35) shipped as its own manager/admin route at **`/activity/provinces`** with API path (`/api/activity/provinces`) rather than inside the planned company panel set, because it ships independently of the employee ranking and the completed-rental rankings, which remain unbuilt. `/requests`, the rest of `/reviews/*`, `/rentals*`, `/admin/*` remain unbuilt and are only described above.
- The auth surfaces keep their own layout sheet (`.sgn-auth` + `sgn-auth.css`); they share the token layer and the control vocabulary but they are shell-free by design (ADR 0001).
- **Not in scope:** no geographic map, no physical-visit UI, no threads/reactions/mentions, no dashboards beyond §5.9, and no archived-property exception beyond the existing reviewer read boundary and the reasoned manager/admin discussion removal in §5.2.
