// The list's own state that the address cannot carry: what the address box holds - including text
// a person typed but never submitted - and where the stream was scrolled. The address already
// carries the result set (the search, the ordering, the filters and the view), and the stream's own
// rule keeps a window offset out of it, so this is the rest. It is held in browser memory above the
// route for the session: a visit to a property and back finds it, and a reload of the application
// starts it over.
//
// Restoring a position is all this module does. Which read a result set is - the loaded catalogue or
// an advanced search - is decided once, from the address, by `resultMode` in `catalogue-results.ts`,
// and this state only supplies the box the person left: a restored list is the list they left
// because the address is the same, not because a second classifier agreed.
import type { InventoryView } from './view.ts';

export type InventoryListState = {
  // What the address box holds, and whether it was edited at all: typed text is not a submitted
  // search until it is submitted, and whether the box was touched at all is what decides whether
  // the loaded catalogue is filtered locally.
  text: string;
  edited: boolean;
  // Where the stream was scrolled, on both axes, measured from the stream's own top and left rather
  // than the page's, so the position names the same rows whatever the shell above the stream shows
  // and a table wider than the stream comes back at the column the person was reading.
  scrollTop: number;
  scrollLeft: number;
  // The document's own offset above the stream: the stream is a bounded scrollport, so the page it
  // sits in is the other half of what frames the rows the person was looking at.
  pageTop: number;
};

// The list a person left, held as one slot: the address it belongs to and the state itself. Only the
// result set the person is at is held - the one they are looking at is the one they come back to -
// so leaving one list for another replaces it rather than keeping a history of every result set
// visited, and a state read under any other address reads as never left.
export type ListStateCarrier = {
  address: string | null;
  state: InventoryListState | null;
};

export function newListStateCarrier(): ListStateCarrier {
  return { address: null, state: null };
}

// What the carrier holds for one result set, or null when the list was never left there.
export function readListState(
  carrier: ListStateCarrier,
  address: string,
): InventoryListState | null {
  return carrier.address === address ? carrier.state : null;
}

// The state is written whole and copied, so a list read back is the list that was written and a
// later change to the writer's own object never reaches the carrier.
export function writeListState(
  carrier: ListStateCarrier,
  address: string,
  state: InventoryListState,
): void {
  carrier.address = address;
  carrier.state = { ...state };
}

// Whether the list paints the rows the browser already holds while this surface's own session read
// is still answering. A return to the list finds the catalogue in the provider above the route, so
// the rows are there to show on the first render; waiting for the session read that confirms them
// would put a skeleton over rows that are already in memory, which is the wait the person reports.
// The catalogue's own loader owns the authority check - a changed scope empties what it holds and
// this reads false again - and a read that failed states its own error instead of a list nothing
// confirmed.
export function paintsHeldRows({
  held,
  failed,
}: {
  // The catalogue's authorized scope is present: `useCatalogue` answered with it rather than the
  // empty state it falls back to for another scope.
  held: boolean;
  // This surface's own session read stopped with an error.
  failed: boolean;
}): boolean {
  return held && !failed;
}

// Whether the stream has rendered enough to put a position on: the read has stated the total the
// stream reserves its whole height from, and - in the grid, whose chunk size is the measured column
// count - that count has settled. Applied any earlier, the position would be clamped onto a height
// that is not there yet and would land on rows the person never saw. The table reserves its height
// from the total alone, so it needs no width.
export function positionReady({
  read,
  total,
  view,
  width,
}: {
  read: boolean;
  total: number;
  view: InventoryView;
  width: number;
}): boolean {
  return read && total > 0 && (view === 'table' || width > 0);
}
