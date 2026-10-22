'use client';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { renderedSession } from '@/features/employees/protected-load';
import type { EmployeeSession } from '@/features/employees/types';
import { SkeletonCards } from '@/features/skeleton';
import { CardChunk } from './property-cards';
import { PropertyDrawer } from './property-drawer';
import { TableChunk, TableHead } from './property-table';
import { SearchIsland } from './search-island';
import { useInventoryStream } from './use-inventory-stream';
import { useCatalogue } from './catalogue-provider';
import { emptyResultWording, type EmptyResultSource } from './catalogue-load';
import type { CatalogueRefreshView } from './catalogue-refresh';
import {
  catalogueMatches,
  resultMode,
  searchEndpoint,
} from './catalogue-results';
import type { CatalogueMatch } from './address-index';
import { useListStateCarrier } from './list-state-provider';
import { positionReady, readListState, writeListState } from './list-state';
import {
  activeFilterCount,
  filterParams,
  searchedAddressFormat,
  type InventoryFilters,
} from './filters';
import {
  cardChunkRows,
  cardColumns,
  DEFAULT_INVENTORY_VIEW,
  inventoryHref,
  inventoryViewParam,
  parseInventoryView,
  PHONE_MAX_WIDTH_PX,
  shownInventoryView,
} from './view';
import {
  localStreamWindows,
  STREAM_CHUNK_ROWS,
  STREAM_ESTIMATE_PX,
  STREAM_PAGE_SIZE,
  streamBand,
  streamChunkCount,
  streamChunkHeights,
  streamChunkRows,
  streamOffsets,
  streamWindows,
} from './stream';
import { SUMMARY_TABLE_COLUMNS } from './table';
import type { PropertySummary } from './types';

const NO_MEASURED: ReadonlyMap<number, number> = new Map();
const NO_FORMATS: ReadonlyMap<string, string> = new Map();
// A typed search the loaded catalogue cannot answer yet: no rows to filter, not a failed read.
const NO_MATCHES: CatalogueMatch[] = [];

// The viewport query behind the switch: below this width the ten-column table is not offered at
// all, so nobody lands on a table that cannot work there.
const WIDE_QUERY = `(min-width: ${PHONE_MAX_WIDTH_PX + 1}px)`;
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const wideSnapshot = () => window.matchMedia(WIDE_QUERY).matches;
const wideOnServer = () => false;

// The empty result area's own wording, chosen by the catalogue module: an answer drawn from the
// loaded properties is never presented as an empty inventory.
function emptyResultText(
  text: typeof messages.vi,
  source: EmptyResultSource,
): string {
  switch (emptyResultWording(source)) {
    case 'catalogue-no-matches':
      return text.catalogueLocalEmpty;
    case 'catalogue-none-created':
      return text.catalogueLocalNoneCreated;
    case 'catalogue-failed':
      return text.catalogueLocalFailed;
    case 'catalogue-loading':
      return text.catalogueLocalLoading;
    case 'filtered':
      return text.emptyFiltered;
    case 'inventory':
      return text.empty;
  }
}

// The refresh line's own wording: the replacement being loaded is described separately from the
// catalogue in use, a continued generation says so, and a stopped one states what Retry will do
// instead of reading as a load that finished.
function refreshStatusText(
  text: typeof messages.vi,
  numberFormat: Intl.NumberFormat,
  view: CatalogueRefreshView,
): string {
  switch (view.status) {
    case 'idle':
      return '';
    case 'failed':
      return text.catalogueRefreshStopped.replace(
        '{loaded}',
        numberFormat.format(view.loadedCount),
      );
    case 'refreshing': {
      const { loadedCount, totalCount, progressPercent, resumed } = view;
      if (totalCount === null || progressPercent === null)
        return (
          resumed
            ? text.catalogueRefreshResumedUnknown
            : text.catalogueRefreshUnknown
        ).replace('{loaded}', numberFormat.format(loadedCount));
      return (
        resumed ? text.catalogueRefreshResumedKnown : text.catalogueRefreshKnown
      )
        .replace('{loaded}', numberFormat.format(loadedCount))
        .replace('{total}', numberFormat.format(totalCount))
        .replace('{percent}', numberFormat.format(progressPercent));
    }
  }
}

export function Inventory({
  initialLocale,
  initialQuery,
  view,
  sort,
  filters,
}: {
  initialLocale: Locale;
  initialQuery: string;
  view: string | null;
  sort: string | null;
  filters: InventoryFilters;
}) {
  const text = messages[initialLocale];
  const locale = initialLocale;
  const parsedView = parseInventoryView(view);
  const requestedView = parsedView.ok
    ? parsedView.view
    : DEFAULT_INVENTORY_VIEW;
  const viewParam = inventoryViewParam(requestedView);
  // A table address on a phone is answered with cards: the view is not offered there, so the
  // address cannot put a person on one.
  const wide = useSyncExternalStore(subscribeWide, wideSnapshot, wideOnServer);
  const shownView = shownInventoryView(requestedView, wide);
  // The filters the address states travel with every read of this stream: the free-text search,
  // the ordering, the filter island and the view switch all carry the same set.
  const activeFilters = filterParams(filters);
  const filterCount = activeFilterCount(filters);
  // The format the list's searches read through, which decides the address each row states.
  const addressFormat = searchedAddressFormat(filters);
  // The address of the list as it stands: the search, the ordering, the view and the filters. It
  // names the result set this list is showing, so it is also what the carrier holds the list's own
  // state under and what a property's link carries back as `returnTo`.
  const resultLocation = inventoryHref({
    query: initialQuery,
    sort,
    view: requestedView,
    filters,
  });
  const endpoint = searchEndpoint({ query: initialQuery, sort, filters });
  // The session is this surface's own protection: the shell reads it, and the stream below reads
  // nothing until it has answered.
  const {
    employee,
    data: session,
    error: sessionError,
    busy,
    surface,
    logout,
    clear,
    reload,
  } = useProtectedData<EmployeeSession>('/api/session');
  const denyFiles = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  const [searchError, setSearchError] = useState(false);
  // The list the person left, read once for the address this list is opened at: the text the
  // address box held (typed, and not necessarily submitted), whether it was edited at all, and
  // where the stream was scrolled. A result set the carrier holds no entry for opens at its own
  // first rows with the address's own search, which is also where a reload of the application
  // starts: the carrier is browser memory for the session, not storage.
  const carrier = useListStateCarrier();
  const [restored] = useState(() => readListState(carrier, resultLocation));
  const [typed, setTyped] = useState(() => restored?.text ?? initialQuery);
  const [addressEdited, setAddressEdited] = useState(
    () => restored?.edited ?? false,
  );
  const catalogue = useCatalogue(session);
  // The authorization scope: the employee, their role and the server-maintained access revision.
  // A replacement catalogue is not a new authority, so it neither reopens a submitted search nor
  // closes the quick view of a record that is still readable.
  const sessionKey = session
    ? `${renderedSession(session.employee)}:${session.accessRevision}`
    : null;
  // Which result set the address describes: the filters, the ordering and the paging the loaded
  // catalogue can answer are computed in the browser, and a criterion the catalogue has no field
  // for is an explicit whole-inventory search (issue #194). The split is `catalogue-results.ts`,
  // so which filters are offered locally and which route to advanced search is tested without a
  // browser.
  const mode = resultMode({ query: initialQuery, filters, sort });
  const {
    windows,
    total: matching,
    order,
    error: streamError,
    request,
    refresh,
    retry,
  } = useInventoryStream({
    // A catalogue result names no endpoint at all, so the browser answers from the rows it holds
    // and no search-data request is made until the person runs an advanced search.
    source: employee && parsedView.ok && mode === 'advanced' ? endpoint : null,
    scope: sessionKey ?? 'no-session',
    onDenied: denyFiles,
  });
  // The text the box narrows the loaded catalogue with, or null while the result set is the
  // advanced search's. Every catalogue result - the ordinary browse, a supported filter, a typed
  // query - is filtered, ordered and paged from rows the browser already holds and reads nothing.
  //
  // The typed value renders immediately and the heavier local match runs at a lower priority, so
  // Vietnamese text composition stays responsive. Measurement decides whether the work later
  // moves to a Web Worker (#195).
  const deferredTyped = useDeferredValue(typed);
  const localQuery = mode === 'catalogue' ? deferredTyped.trim() : null;
  const localActive = localQuery !== null;
  // The local answer exists as soon as any batch is indexed, so the first page is searchable
  // before the traversal finishes and before the authorized total arrives. A catalogue with
  // nothing indexed yet states the load itself, never a filtered result over rows the browser does
  // not hold.
  const localReady = localActive && catalogue.index.length > 0;
  const catalogueFailed =
    catalogue.status === 'failed' && !catalogue.progress.isComplete;
  // The employee the creator selection compares against; the list reads nothing until the session
  // has answered, so an absent one matches nothing rather than everyone.
  const employeeId = session?.employee.id ?? null;
  const matches = useMemo(() => {
    if (!localActive) return null;
    return localReady
      ? catalogueMatches(catalogue.index, {
          query: localQuery,
          filters,
          employeeId,
        })
      : NO_MATCHES;
  }, [
    localActive,
    localReady,
    catalogue.index,
    localQuery,
    filters,
    employeeId,
  ]);
  // The rows the local answer holds, and the stored format each one matched through. The format is
  // only stated while a query is actually filtering: an empty box lists every loaded property and
  // has no match to explain.
  const matchedRows = useMemo(
    () => matches?.map((match) => match.record) ?? null,
    [matches],
  );
  const matchedFormats = useMemo(
    () =>
      matches && localQuery
        ? new Map(matches.map((match) => [match.record.id, match.format]))
        : NO_FORMATS,
    [matches, localQuery],
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [opened, setOpened] = useState<{
    record: PropertySummary;
    opener: HTMLElement | null;
    scope: string | null;
  } | null>(null);
  const currentOpened =
    sessionKey !== null && opened?.scope === sessionKey ? opened : null;
  // The quick view states the address the row it was opened from states.
  const openedAddressFormat = currentOpened
    ? matchedFormats.get(currentOpened.record.id) || addressFormat
    : addressFormat;
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );

  // ── the stream's own geometry ─────────────────────────────────────────────
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  // The same element as a ref, because restoring the scroll position writes to it and a value read
  // out of the render is not the place to write to a node from.
  const streamNode = useRef<HTMLDivElement | null>(null);
  const bindStream = useCallback((node: HTMLDivElement | null) => {
    streamNode.current = node;
    setContainer(node);
  }, []);
  const [viewport, setViewport] = useState({
    top: 0,
    left: 0,
    page: 0,
    height: 0,
  });
  // Where the stream sits: its own two-axis scroll, read off the node that owns the scrollport, and
  // the document's offset above it. The band is measured from the stream's scroll and the carrier
  // holds all of it, so what frames the rows comes from one reading.
  const syncViewport = useCallback(
    (node: HTMLDivElement) => {
      const next = {
        top: node.scrollTop,
        left: node.scrollLeft,
        page: window.scrollY,
        height: node.clientHeight,
      };
      setViewport((current) =>
        current.top === next.top &&
        current.left === next.left &&
        current.page === next.page &&
        current.height === next.height
          ? current
          : next,
      );
    },
    [setViewport],
  );
  const [width, setWidth] = useState(0);
  const total = matches !== null ? matches.length : (matching ?? 0);
  // A catalogue result is ready once any batch is indexed, or once the load ended without one: the
  // list states the load itself rather than an empty inventory before that, and never presents a
  // filtered view of the rows it happens to hold as a search of the whole inventory.
  const ready =
    matches !== null
      ? localReady || catalogue.progress.isComplete || catalogueFailed
      : matching !== null;
  // What the results area holds: the locally matched rows of the loaded catalogue, or the server
  // stream. Both are one total order the page draws as chunks of rows, so the area below has one
  // shape either way.
  const local = matches !== null;
  const shownWindows = useMemo(
    () => (matchedRows !== null ? localStreamWindows(matchedRows) : windows),
    [matchedRows, windows],
  );
  // The measured column count: the card grid the stream lays out, and the chunk size in whole
  // rows of it, so a chunk boundary never leaves a half-filled row behind.
  const columns = useMemo(() => cardColumns(width), [width]);
  const chunkRows =
    shownView === 'table' ? STREAM_CHUNK_ROWS : cardChunkRows(columns);
  const chunkCount = useMemo(
    () => streamChunkCount(total, chunkRows),
    [total, chunkRows],
  );
  // What the browser measured for the chunks it has seen; the rest of the stream is reserved at
  // the average of those measurements, or at the starting estimate before any is taken.
  const [measured, setMeasured] = useState(NO_MEASURED);
  const measuredRef = useRef(new Map<number, number>());
  const frame = useRef(0);
  const reportHeight = useCallback((index: number, height: number) => {
    if (!(height > 0) || measuredRef.current.get(index) === height) return;
    measuredRef.current.set(index, height);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setMeasured(new Map(measuredRef.current));
    });
  }, []);
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );
  // The position the list was opened at and the address it belongs to: `target` is what still has to
  // be reached, and until the first attempt has been made it - not the measurement - is what the
  // carrier holds, because until then the stream is not where the person was. `rows` is the number
  // of rows that attempt was made against, so a result set that has since lost rows releases it.
  // A later address inside the same visit is a different result set, so the position recorded here
  // is dropped rather than applied to its rows.
  const opening = useRef<{
    address: string;
    target: { top: number; left: number; page: number } | null;
    rows: number | null;
    attempted: boolean;
  }>({
    address: resultLocation,
    target:
      restored !== null &&
      (restored.scrollTop > 0 ||
        restored.scrollLeft > 0 ||
        restored.pageTop > 0)
        ? {
            top: restored.scrollTop,
            left: restored.scrollLeft,
            page: restored.pageTop,
          }
        : null,
    rows: null,
    attempted: false,
  });
  // A new column count or a new result set relabels every chunk, so old measurements describe
  // rows the chunk no longer holds and are dropped; the mounted chunks measure themselves again.
  useEffect(() => {
    measuredRef.current = new Map();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the chunk layout changed, so previous measurements describe different rows
    setMeasured(NO_MEASURED);
  }, [chunkRows, endpoint, sessionKey]);
  const heights = useMemo(
    () => streamChunkHeights(measured, chunkCount),
    [measured, chunkCount],
  );
  const offsets = useMemo(() => streamOffsets(heights), [heights]);
  const band = useMemo(
    () =>
      streamBand({
        chunkCount,
        offsets,
        scrollTop: viewport.top,
        viewportHeight: viewport.height,
      }),
    [chunkCount, offsets, viewport],
  );
  const needed = useMemo(
    () =>
      streamWindows({
        first: band.first,
        last: band.last,
        total,
        chunkRows,
      }),
    [band.first, band.last, total, chunkRows],
  );

  // Where the stream sits in the page: the band is measured from the stream's own top, so the
  // scroll position, the viewport and the container's own width come from the browser rather
  // than from any assumption about the shell above.
  useEffect(() => {
    const node = container;
    if (!ready || !node) return;
    let pending = 0;
    const measure = () => {
      pending = 0;
      syncViewport(node);
    };
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(measure);
    };
    measure();
    node.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    return () => {
      if (pending) cancelAnimationFrame(pending);
      node.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [container, ready, busy, syncViewport]);
  // The width the card grid is laid out in, so the column count is the browser's own answer.
  useEffect(() => {
    const node = container;
    if (!ready || !node || shownView !== 'cards') return;
    const read = () =>
      setWidth((current) =>
        current === node.clientWidth ? current : node.clientWidth,
      );
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [container, ready, shownView]);
  // The position the person left is applied once the results have rendered: the stream has stated
  // the total it reserves its height from, and the measured column count has settled the chunk size
  // that height is reserved in. Applied any earlier, the position would be clamped onto a height
  // that is not there yet and would land on rows the person never saw, so the target is held while
  // the stream's reserved height grows toward it - one attempt per measurement round, each one
  // publishing the position the browser actually measured rather than the one asked for - until it
  // is actually sitting on every axis. Reaching it is read on the next round rather than on the
  // value the assignment returned, because a layout change in the same commit can clamp or re-anchor
  // the position the browser had just accepted. A person who scrolls the list while it is still
  // settling keeps their own position, which is what ends the restore; the browser adjusting the
  // stream under them as a chunk measures is not. A result set that has lost rows since the visit
  // cannot hold the position any more, so the target is released rather than retried. A different
  // result-set address is not this position's list at all, so the position is dropped and the new
  // one opens at its own first rows. The scroll this sets is measured by the stream and by the
  // document it sits in, so the band follows it and the rows sit where the person left them.
  const restoreReady = positionReady({
    read: ready,
    total,
    view: shownView,
    width,
  });
  useLayoutEffect(() => {
    const open = opening.current;
    const node = streamNode.current;
    if (open.address !== resultLocation) {
      opening.current = {
        address: resultLocation,
        target: null,
        rows: null,
        attempted: false,
      };
      if (!node) return;
      node.scrollTop = 0;
      node.scrollLeft = 0;
      syncViewport(node);
      return;
    }
    const target = open.target;
    if (!target || !restoreReady || !node) return;
    if (open.rows !== null && total < open.rows) {
      opening.current = { ...open, target: null };
      return;
    }
    // The position is held once the stream has reserved the height for it and the browser is
    // sitting on it. A target past that height is clamped by the browser, and the rounds that
    // measure the chunks around it ask again; deciding this on the next round rather than on what
    // the assignment returned is what makes a narrow reservation - or one that shrinks again in the
    // same commit - a retry rather than a landing, and leaves the person's own scroll alone.
    const reserved = offsets[offsets.length - 1] ?? 0;
    if (
      node.scrollTop === target.top &&
      node.scrollLeft === target.left &&
      window.scrollY === target.page
    ) {
      if (reserved > target.top) opening.current = { ...open, target: null };
      return;
    }
    node.scrollTop = target.top;
    node.scrollLeft = target.left;
    window.scrollTo(0, target.page);
    open.attempted = true;
    open.rows = total;
    const landed = {
      top: node.scrollTop,
      left: node.scrollLeft,
      page: window.scrollY,
    };
    // The band is computed from what the stream measured, and the position just set is what it
    // measures next: stating it here keeps the stream from asking for the rows at the top of a list
    // the person is not looking at, and keeps the rows they are looking at from arriving a frame
    // after the space they sit in.
    setViewport((current) =>
      current.top === landed.top &&
      current.left === landed.left &&
      current.page === landed.page &&
      current.height === node.clientHeight
        ? current
        : {
            top: landed.top,
            left: landed.left,
            page: landed.page,
            height: node.clientHeight,
          },
    );
  }, [container, resultLocation, restoreReady, offsets, syncViewport, total]);
  // Scrolling the list is the person's own, so input inside the stream - a wheel, a touch, a scroll
  // key while it holds focus, or a press on its scrollbar - ends the restore and the position they
  // take is the one they keep. Input anywhere else, the address box or the toolbar included, is not
  // the list being taken over, and a caret key in a text field is not scrolling. The browser's own
  // adjustment as a chunk measures moves the same scroll without them.
  useEffect(() => {
    const node = container;
    if (!node) return;
    const scrollKeys = new Set([
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
    ]);
    const end = () => {
      const open = opening.current;
      if (open.target !== null) opening.current = { ...open, target: null };
    };
    const key = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key)) end();
    };
    const listening = { passive: true } as const;
    node.addEventListener('wheel', end, listening);
    node.addEventListener('touchmove', end, listening);
    node.addEventListener('pointerdown', end, listening);
    node.addEventListener('keydown', key);
    return () => {
      node.removeEventListener('wheel', end);
      node.removeEventListener('touchmove', end);
      node.removeEventListener('pointerdown', end);
      node.removeEventListener('keydown', key);
    };
  }, [container]);

  // The list is kept in the carrier as it is used, so the address the person is looking at already
  // holds it when they come back. Written on every position change so navigation while mounted
  // always leaves the latest position behind. Before the restore has been attempted, the target is
  // what is held, so a return never loses the position it is restoring; from the first attempt on,
  // what the stream measured is held, so a position the results cannot reach is never published.
  useEffect(() => {
    const open = opening.current;
    const place =
      open.target !== null && !open.attempted ? open.target : viewport;
    writeListState(carrier, resultLocation, {
      text: typed,
      edited: addressEdited,
      scrollTop: place.top,
      scrollLeft: place.left,
      pageTop: place.page,
    });
  }, [carrier, resultLocation, typed, addressEdited, viewport]);

  // The band asks the stream for the windows it would show, and tells it which row position it is
  // centred on, so a deep scroll keeps its own windows and drops the far ones. A locally filtered
  // list reads nothing: the rows it draws are already in the browser.
  useEffect(() => {
    if (!ready || !parsedView.ok || localActive) return;
    request(needed, band.top);
  }, [request, needed, band.top, ready, parsedView.ok, localActive]);

  // The rows each mounted chunk holds. A chunk whose windows are not all here renders nothing of
  // its own and reserves its space instead, which is an empty-slice result only when the stream
  // itself has run out. The stream republishes its windows only when the set it holds changes, so
  // this recomputes when a window arrives or the band moves on, not on every scrolled pixel.
  const rowsByChunk = useMemo(() => {
    const found = new Map<number, PropertySummary[]>();
    for (
      let index = band.first;
      index <= Math.min(band.last, chunkCount - 1);
      index++
    ) {
      const rows = streamChunkRows(
        shownWindows,
        index * chunkRows,
        chunkRows,
        STREAM_PAGE_SIZE,
        total,
      );
      if (rows === null) continue;
      found.set(index, rows);
    }
    return found;
  }, [shownWindows, band.first, band.last, chunkCount, chunkRows, total]);
  const mounted = useMemo(() => {
    const indexes: number[] = [];
    for (
      let index = band.first;
      index <= Math.min(band.last, chunkCount - 1);
      index++
    )
      indexes.push(index);
    return indexes;
  }, [band.first, band.last, chunkCount]);

  const showEntry = order !== null;
  const openDrawer = useCallback(
    (record: PropertySummary, opener: HTMLElement | null) =>
      setOpened({ record, opener, scope: sessionKey }),
    [sessionKey, setOpened],
  );
  const closeDrawer = useCallback(() => setOpened(null), [setOpened]);
  // The open row states the status the server just recorded, and the windows the list shows are
  // read again - not answered from the rows the page already holds - so the badge and the filter
  // membership behind the quick view follow the committed change.
  const statusChanged = useCallback(
    (status: string) => {
      setOpened((current) =>
        current ? { ...current, record: { ...current.record, status } } : null,
      );
      refresh();
    },
    [setOpened, refresh],
  );

  function search(event: FormEvent<HTMLFormElement>) {
    const query = new FormData(event.currentTarget).get('query');
    if (typeof query !== 'string' || [...query].length > 120) {
      event.preventDefault();
      setSearchError(true);
    } else {
      setSearchError(false);
    }
  }
  // The ordering is not offered beside the box any more: the chronological orderings the database
  // answers are advanced criteria, and they are submitted from the filter panel with the rest of
  // them instead of running the moment a control changes (issue #194).
  // Where an empty result area may draw its own wording from, decided by the catalogue module so
  // the honest-coverage rules are tested rather than buried in a render branch.
  // The refresh's own line, computed from the replacement generation alone: it never reads the
  // progress of the catalogue the user is still searching.
  const refreshText = refreshStatusText(text, numberFormat, catalogue.refresh);
  const emptyText = useMemo(
    () =>
      emptyResultText(
        text,
        local
          ? {
              from: 'catalogue',
              loaded: localReady,
              complete: catalogue.progress.isComplete,
              failed: catalogueFailed,
              createdByMine: filters.createdBy !== null,
            }
          : { from: 'inventory', filterCount },
      ),
    [
      text,
      local,
      localReady,
      catalogue.progress.isComplete,
      catalogueFailed,
      filterCount,
      filters.createdBy,
    ],
  );
  // What the address box's own filtering states: how much of the loaded catalogue matches, or the
  // honest state of a load with nothing indexed yet. The note beside the box states that these are
  // the loaded properties and not the whole inventory.
  const localStatus = localReady
    ? text.catalogueLocalCount
        .replace('{matches}', numberFormat.format(total))
        .replace(
          '{loaded}',
          numberFormat.format(catalogue.progress.loadedCount),
        )
    : emptyText;
  // The catalogue states no progress of its own: the rows paint from what the browser holds, so a
  // load that stopped is stated plainly with its retry and a complete one offers the Refresh
  // control, and nothing else claims to be loading.
  const offersRefresh =
    catalogue.progress.isComplete && catalogue.refresh.status === 'idle';
  const failureMessage = (code: string) =>
    code === 'query-too-long'
      ? text.queryTooLong
      : code === 'sign-out-failed'
        ? text.signOutFailed
        : code === 'invalid-input'
          ? text.invalidInput
          : code === 'access-changed'
            ? text.accessChanged
            : text.unavailable;
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <h1>{text.inventory}</h1>
          {ready ? (
            <p className="intro-copy" role="status">
              {local
                ? localStatus
                : text.inventoryMatchCount.replace(
                    '{total}',
                    numberFormat.format(total),
                  )}
            </p>
          ) : null}
        </div>
        <div className="page-actions">
          <Link
            className="btn btn-primary"
            href="/properties/new"
            prefetch={false}
          >
            <span aria-hidden="true">＋</span>
            {text.navNewProperty}
          </Link>
        </div>
      </div>

      <section className="panel page-section">
        <div className="panel-body">
          <div className="toolbar">
            <form
              className="toolbar-search"
              action="/properties"
              method="get"
              onSubmit={search}
              role="search"
            >
              <div className="search">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20.5 20.5 16.7 16.7" />
                </svg>
                <label className="sr" htmlFor="query">
                  {text.search}
                </label>
                <input
                  className="input"
                  id="query"
                  name="query"
                  type="search"
                  autoComplete="off"
                  value={typed}
                  onChange={(event) => {
                    setTyped(event.currentTarget.value);
                    setAddressEdited(true);
                  }}
                  aria-invalid={searchError}
                  placeholder={text.search}
                />
                <button
                  className="search-btn"
                  type="submit"
                  aria-label={text.search}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20.5 20.5 16.7 16.7" />
                  </svg>
                </button>
              </div>
              {sort ? <input type="hidden" name="sort" value={sort} /> : null}
              {viewParam ? (
                <input type="hidden" name="view" value={viewParam} />
              ) : null}
              {Object.entries(activeFilters).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
            </form>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              aria-controls="inventory-filters"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8L4 5z" />
              </svg>
              {text.filters}
              {filterCount ? (
                <span className="badge" data-tone="neutral">
                  {filterCount}
                </span>
              ) : null}
            </button>
            {wide ? (
              // The switch is icon-only: each link's name lives in its visually hidden label, so
              // the visible control is a grid and a table and nothing else.
              <div className="seg" role="group" aria-label={text.viewLabel}>
                <Link
                  className="seg-btn"
                  href={inventoryHref({
                    query: initialQuery,
                    sort,
                    view: 'cards',
                    filters,
                  })}
                  prefetch={false}
                  aria-current={requestedView === 'cards' ? 'page' : undefined}
                >
                  <svg
                    className="seg-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  <span className="sr">{text.viewCards}</span>
                </Link>
                <Link
                  className="seg-btn"
                  href={inventoryHref({
                    query: initialQuery,
                    sort,
                    view: 'table',
                    filters,
                  })}
                  prefetch={false}
                  aria-current={requestedView === 'table' ? 'page' : undefined}
                >
                  <svg
                    className="seg-icon"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <path d="M3 9h18M9 9v11" />
                  </svg>
                  <span className="sr">{text.viewTable}</span>
                </Link>
              </div>
            ) : null}
          </div>
          <SearchIsland
            locale={locale}
            query={initialQuery}
            sort={sort}
            view={requestedView}
            filters={filters}
            open={filtersOpen}
            onOpen={setFiltersOpen}
            onDenied={denyFiles}
          />
          <div className="inventory-search-help">
            {local ? (
              <>
                <p className="search-hint">{text.catalogueLocalNote}</p>
                {!catalogue.progress.isComplete ? (
                  <p className="search-hint">{text.catalogueMoreMatches}</p>
                ) : null}
              </>
            ) : (
              // The advanced result is the database's answer for the whole inventory: the note
              // says so, so a result the browser could not have produced is never read as a local
              // filter over the loaded rows.
              <p className="search-hint">{text.advancedSearchNote}</p>
            )}
            <p className="search-hint">{text.inventorySearchHint}</p>
            <details>
              <summary>{text.searchHelp}</summary>
              <p>{text.inventorySearchHelp}</p>
            </details>
          </div>
          {catalogueFailed || offersRefresh ? (
            <div className="catalogue-progress">
              {/* A stopped load is a failure rather than progress, so it keeps its own statement
                  beside the retry that resumes it. */}
              {catalogueFailed ? (
                <>
                  <p className="catalogue-progress-text">
                    {catalogue.progress.loadedCount > 0
                      ? text.catalogueLoadStopped
                      : text.catalogueLoadFailed}
                  </p>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={catalogue.retry}
                  >
                    {text.retry}
                  </button>
                </>
              ) : null}
              {offersRefresh ? (
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={catalogue.refreshCatalogue}
                >
                  {text.catalogueRefresh}
                </button>
              ) : null}
            </div>
          ) : null}
          {/* The replacement a refresh is building, stated separately from the catalogue above so
              the person can see that what they are searching is untouched. The progress element is
              not a live region, so a batch arriving never interrupts a screen reader; a stopped
              refresh is announced once, when it fails. */}
          {catalogue.refresh.status === 'refreshing' ? (
            <div className="catalogue-progress" data-state="refreshing">
              <progress
                id="catalogue-refresh-progress"
                className="catalogue-progress-bar"
                max={100}
                {...(catalogue.refresh.progressPercent === null
                  ? {}
                  : { value: catalogue.refresh.progressPercent })}
                aria-labelledby="catalogue-refresh-label"
              />
              <p
                id="catalogue-refresh-label"
                className="catalogue-progress-text"
              >
                {refreshText}
              </p>
            </div>
          ) : null}
          {catalogue.refresh.status === 'failed' ? (
            <div className="catalogue-progress" data-state="failed">
              <p className="catalogue-progress-text" role="alert">
                {refreshText}
              </p>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={catalogue.refreshCatalogue}
              >
                {text.retry}
              </button>
            </div>
          ) : null}
          {sort ? <p className="search-hint">{text.ageHint}</p> : null}
          {searchError ? (
            <p className="search-hint" role="alert">
              {text.queryTooLong}
            </p>
          ) : null}
        </div>
      </section>

      <section className="page-section">
        {!parsedView.ok ? (
          <div className="panel">
            <div className="state-panel" data-tone="danger">
              <h3>{text.invalidInput}</h3>
              <Link
                className="btn btn-secondary btn-sm"
                href={inventoryHref({
                  query: initialQuery,
                  sort,
                  view: DEFAULT_INVENTORY_VIEW,
                  filters,
                })}
              >
                {text.backToInventory}
              </Link>
            </div>
          </div>
        ) : null}

        {sessionError ? (
          <div className="panel">
            <div className="state-panel" data-tone="danger">
              <span className="state-mark" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4 3 20h18L12 4z" />
                  <path d="M12 10v4" />
                  <path d="M12 17h.01" />
                </svg>
              </span>
              <h3>{failureMessage(sessionError)}</h3>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={sessionError === 'sign-out-failed' ? logout : reload}
              >
                {text.retry}
              </button>
            </div>
          </div>
        ) : null}

        {busy ? <SkeletonCards label={text.loading} /> : null}

        <div ref={surface} hidden={!employee || busy}>
          {streamError && total === 0 ? (
            <div className="panel">
              <div className="state-panel" data-tone="danger">
                <h3>{failureMessage(streamError)}</h3>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={retry}
                >
                  {text.retry}
                </button>
              </div>
            </div>
          ) : null}
          {!ready && !streamError ? (
            <SkeletonCards label={text.loading} />
          ) : null}
          {ready && total === 0 ? (
            <div className="panel">
              <div className="state-panel">
                <span className="state-mark" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    width="26"
                    height="26"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20.5 20.5 16.7 16.7" />
                  </svg>
                </span>
                <h3>{emptyText}</h3>
                {local && localQuery ? (
                  <>
                    <p className="search-hint">
                      {text.catalogueSearchWholeNote}
                    </p>
                    <Link
                      className="btn btn-secondary btn-sm"
                      href={inventoryHref({
                        query: localQuery,
                        sort,
                        view: requestedView,
                        filters,
                      })}
                    >
                      {text.catalogueSearchWhole}
                    </Link>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}
          {ready && total > 0 ? (
            <>
              {streamError ? (
                <p className="search-hint" role="alert">
                  {text.streamPartialFailed}{' '}
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={retry}
                  >
                    {text.retry}
                  </button>
                </p>
              ) : null}
              <div
                className="inventory-stream"
                ref={bindStream}
                data-view={shownView}
                tabIndex={0}
                role="region"
                aria-label={text.inventory}
              >
                {shownView === 'table' ? (
                  <table
                    className="inventory-table"
                    aria-label={text.inventory}
                  >
                    <TableHead locale={locale} />
                    {band.top > 0 ? (
                      <tbody aria-hidden="true">
                        <tr
                          className="inventory-gap"
                          style={{ height: band.top }}
                        >
                          <td colSpan={SUMMARY_TABLE_COLUMNS.length} />
                        </tr>
                      </tbody>
                    ) : null}
                    {mounted.map((index) => (
                      <TableChunk
                        key={`${chunkRows}:${index}`}
                        index={index}
                        rows={rowsByChunk.get(index) ?? null}
                        count={Math.min(chunkRows, total - index * chunkRows)}
                        reserved={heights[index] ?? STREAM_ESTIMATE_PX}
                        locale={locale}
                        resultLocation={resultLocation}
                        addressFormat={addressFormat}
                        matchedFormats={matchedFormats}
                        onOpen={openDrawer}
                        onMeasured={reportHeight}
                      />
                    ))}
                    {band.bottom > 0 ? (
                      <tbody aria-hidden="true">
                        <tr
                          className="inventory-gap"
                          style={{ height: band.bottom }}
                        >
                          <td colSpan={SUMMARY_TABLE_COLUMNS.length} />
                        </tr>
                      </tbody>
                    ) : null}
                  </table>
                ) : (
                  <>
                    {band.top > 0 ? (
                      <div
                        className="inventory-gap"
                        style={{ height: band.top }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {mounted.map((index) => (
                      <CardChunk
                        key={`${chunkRows}:${index}`}
                        index={index}
                        columns={columns}
                        rows={rowsByChunk.get(index) ?? null}
                        reserved={heights[index] ?? STREAM_ESTIMATE_PX}
                        locale={locale}
                        resultLocation={resultLocation}
                        showEntry={showEntry}
                        addressFormat={addressFormat}
                        matchedFormats={matchedFormats}
                        onDenied={denyFiles}
                        onOpen={openDrawer}
                        onMeasured={reportHeight}
                      />
                    ))}
                    {band.bottom > 0 ? (
                      <div
                        className="inventory-gap"
                        style={{ height: band.bottom }}
                        aria-hidden="true"
                      />
                    ) : null}
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>
      </section>

      <PropertyDrawer
        employee={employee}
        property={currentOpened?.record ?? null}
        locale={locale}
        open={currentOpened !== null}
        resultLocation={resultLocation}
        showEntry={showEntry}
        addressFormat={openedAddressFormat}
        opener={currentOpened?.opener ?? null}
        onClose={closeDrawer}
        onDenied={denyFiles}
        onStatusChanged={statusChanged}
      />
    </>
  );
}
