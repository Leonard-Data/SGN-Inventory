# Inventory list stream and table view

Status: accepted (2026-10-19); the ordinary browse and the supported filters now answer from the browser-held catalogue, so the server read described here answers whole-inventory searches ([ADR 0003](0003-browser-property-catalogue-and-local-address-search.md), #194)

The properties list was read one numbered page at a time (`page_inventory`), with a page-size selector and an older cursor trail as separate transports for the same set. A virtualised list cannot express page numbers: the rows the page holds change as a person scrolls, so "page 7" names nothing stable. We decided the list is one stream of everything the filters match. The server orders the whole filtered set — newest created first by default, or the eligible oldest-first/newest-first entry chronology — and answers consecutive windows of about a hundred rows at the window's own offset, stating the matching total on the same read. The browser reserves the whole stream's estimated height and keeps only the rows near the viewport in the page. Numbered pages, the page-size parameter and the cursor trail are removed from the address; the result view (`view=`, cards or table) is carried beside the search, the ordering and the filters, so switching views or applying a filter keeps the result set and never changes the read.

The count and the rows share one filtered read: every read answers `total_count` computed from the same filtered set as its window (a window past the end, or a filter that matches nothing, answers the counting row alone), so the header count and the rows can never describe different inventories. The ordering is an argument of that one read, so the ordinary browse and the entry-date chronology share one predicate instead of two result sets that could drift.

## Considered options

- Keeping numbered pages beside the stream — rejected: a page number is not expressible in a virtualised list, and two ways to read the same set drift apart.
- Keeping the page-size selector — rejected: the window length is a transport detail (about a hundred rows), not a user choice; the total and the rows are honest whatever the length.
- Fetching the whole result set into memory — rejected at the imported ~18k rows: the page would hold everything, and the count would still need its own read.
- Cursor paging — rejected: a cursor trail is a second paging model for a list that has no pages; it was already dead machinery being retired.

## Consequences

- Supersedes [#141](https://github.com/Leonard-Data/SGN-Inventory/issues/141) (page-size selector: 30, 60 or 120 rows) and [#142](https://github.com/Leonard-Data/SGN-Inventory/issues/142) (retire the inventory cursor paging machinery): both describe the paged model this decision replaces. The cursor parameters and the numbered pager are gone rather than kept in step.
- `page_inventory` remains in the database, unreferenced by the application, with a cleanup note in `supabase/migrations/20261019041526_inventory_stream_list.sql`; dropping it is a future cleanup migration, not a rewrite of this one.
- The address no longer carries `page` or `pageSize`; the API refuses them instead of answering a different window. A stale address with `page=` still opens the list, at the top of the stream, because the stream has no page to honour.
- The read clamps a window to 200 rows and defaults to 100; the application asks for 100.
- Below the phone breakpoint the table view is not offered at all: the cards view is the list there, and a `view=table` address on a phone is answered with cards.
- Paging would be worth revisiting only if the product needs address-able, stable slices of the result (for example, "send me page 3 as a document") or random access to a middle window over a connection too slow to stream: that would require pinning a stable key-ordered window and stating the count from the same snapshot. Neither is in scope.

The read's own contract — parameters, ordering, the counting row — is documented in [`docs/database-contract.md`](../database-contract.md); the surface and its views are described in [`docs/interface-design.md`](../interface-design.md).
