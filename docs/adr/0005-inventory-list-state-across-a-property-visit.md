# Inventory list state across a property visit

Status: accepted (2026-10-20)

Opening a property from the list and coming back lost the list. The result set itself already
travelled in the address — the search, the ordering, the filters and the view — and a property's
link carries that address back as `returnTo`, so the read behind the list was the same one. What
was lost was the list's own state: the text in the address box (typed, and not necessarily
submitted, so it was never in the address), and where the stream was scrolled.

We decided that state is held in browser memory above the routes as the one list the person left,
in a carrier mounted once in the shared authenticated layout beside the catalogue's own provider
([ADR 0003](0003-browser-property-catalogue-and-local-address-search.md)). The list reads its
opened position from the carrier and writes the list back as it is left, so a visit to a property
and back restores the search text, the filters, the ordering, the scroll position and the result set
without reading the catalogue again, and a reload of the application starts over. The scroll
position is stored on both axes, measured from the stream's own top and left rather than the page's,
along with the document's own offset above the stream — the stream is a bounded scrollport, so the
page it sits in is the other half of what frames the rows — and it is applied once the results have
rendered — after the read has stated the total the stream reserves its height from and after the
measured column count has settled the chunk size — and held until the browser's own scroll reaches
it and the stream's reserved height has grown past it, so the position lands on the rows it
describes instead of being clamped onto a height that is not there yet.

## Considered options

- Carrying the box text and the position in the address — rejected: the stream's own rule keeps a
  window offset out of the properties address (`docs/adr/0002`), and every row's link would carry
  the scroll, so the links would change on every scrolled frame and redraw the mounted rows.
- Restoring through browser history (`router.back()`) — rejected: the virtualised stream's height
  comes from a read, so the browser's own restoration would run before the rows it describes exist,
  and `returnTo` is the documented way back into a narrowed list.
- Persistent storage (sessionStorage, IndexedDB) — rejected: the acceptance is that a reload of the
  application starts a fresh list, and this release has no persistent browser state (ADR 0003).
- Lifting the stream's own windows into the shared layout as well — not in this slice: the criterion
  is that returning reloads no catalogue, and a catalogue result reads nothing at all. An advanced
  search paints from the pages its own bounded cache retains and reads no page while they are within
  the retention window, so its windows stay that read's machinery (ADR 0002) rather than being
  duplicated above the routes.

## Consequences

- The carrier holds nothing authoritative and no row: it is where a list was left, not what it
  showed. Nothing about authorization changes, and the catalogue's own cache key still decides
  which rows exist for a caller.
- The list paints the rows the browser already holds (issue #265): a return renders both kinds of result
  set without waiting for the list's own session read. A catalogue result paints the index the provider
  above the route keeps for the session on the first render, and an advanced search paints the windows
  its own bounded cache holds as soon as its first cached window is answered - a page still within the
  retention window is answered without a request, and a page past it is read again, as that cache
  already rules. Both read and paint under one scope: the session's own once it answers, and until then
  the scope key the catalogue above the route was authorized under, which is the identity, role and
  access revision the shell already holds. That first paint is a cached view under the last known
  authorized scope, not a fresh authorization, and it is available only until the surface's own read has
  answered: the read still runs and still governs. A session that answers as another scope empties the
  catalogue, the key becomes that session's own, and the windows read under the former scope are
  dropped with it; a concealment a later read detects stays concealed rather than being undone by held
  rows, and a read that stopped with an error states its error rather than a list nothing confirmed.
  This is also why `useProtectedData` conceals a surface only when that surface has rendered something:
  hiding on the first answer of a read is not a change of identity, and it put a blank results area
  over rows that were already painted.
- A result set the carrier holds no entry for opens at its own first rows with the address's own
  search, which is what a reload and a first visit both do.
- A later address inside one visit (another ordering, filter set or view) is a different result set
  and opens at its own first rows; the position applies once, to the list the person opened.
- The restored position is held until the stream's reserved height reaches it, and that height is
  the stream's own estimate until the chunks around it are measured, so a deep position settles on
  the rows it names as the rows around it are measured rather than in the first frame; a person who
  scrolls the list while it is still settling keeps their own position and ends the restore.
