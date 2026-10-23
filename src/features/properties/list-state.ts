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

// The authorized scope a list reads and paints under: this surface's own answered session, or - until
// that read has answered once - the scope key the catalogue above the route was authorized under,
// which is the same identity, role and access revision the shell already holds. A return to the list
// finds the rows the browser holds under that key, so the catalogue paints on the first render and a
// search paints as soon as its cached window is answered, instead of a skeleton over rows that are
// already there. The held scope is only ever the one in force: a surface whose own read has answered
// or failed, one whose authority was discarded, and a catalogue that holds nothing read null or that
// surface's own key, so a concealment the read detected cannot be undone by painting held rows again,
// and a session that answers as another scope drops the windows read under the former one with it.
export function readScope({
  own,
  held,
  answered,
}: {
  // This surface's own session scope key, or null while its read is in flight.
  own: string | null;
  // The scope key the catalogue above the route was read under, or null when it holds nothing.
  held: string | null;
  // This surface's own read has already answered or failed, or its authority was discarded.
  answered: boolean;
}): string | null {
  if (own !== null) return own;
  return answered ? null : held;
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
