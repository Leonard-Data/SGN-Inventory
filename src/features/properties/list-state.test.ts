import assert from 'node:assert/strict';
import test from 'node:test';
import {
  newListStateCarrier,
  positionReady,
  readListState,
  readScope,
  writeListState,
  type InventoryListState,
} from './list-state.ts';
import { resultMode } from './catalogue-results.ts';
import { noInventoryFilters } from './filters.ts';

const PROVINCE = '11111111-1111-4111-8111-111111111111';

const address =
  '/properties?' +
  new URLSearchParams({ query: 'le loi', view: 'cards', status: 'available' });
const other = '/properties?query=le+loi&view=cards&status=rented';

const left: InventoryListState = {
  text: 'nguyen van thuong binh thanh',
  edited: true,
  scrollTop: 4200,
  scrollLeft: 320,
  pageTop: 96,
};

// The carrier is bounded to the result set the person is at, which is the one the ticket needs: the
// list they left is the list they come back to. Writing another result set replaces it rather than
// keeping a history of every result set ever visited.
test('the carrier holds the list a person left, and only that one', () => {
  const carrier = newListStateCarrier();
  assert.equal(readListState(carrier, address), null);
  writeListState(carrier, address, left);
  assert.deepEqual(readListState(carrier, address), left);
  // The bound: one result set at a time, so the list the person is looking at is the one held.
  writeListState(carrier, other, {
    text: '',
    edited: false,
    scrollTop: 0,
    scrollLeft: 0,
    pageTop: 0,
  });
  assert.deepEqual(readListState(carrier, other), {
    text: '',
    edited: false,
    scrollTop: 0,
    scrollLeft: 0,
    pageTop: 0,
  });
  assert.equal(readListState(carrier, address), null);
});

test('a list is written whole, so nothing reaches it after the write', () => {
  const carrier = newListStateCarrier();
  const state = { ...left };
  writeListState(carrier, address, state);
  state.text = 'something else';
  state.scrollTop = 0;
  state.scrollLeft = 0;
  state.pageTop = 0;
  assert.deepEqual(readListState(carrier, address), left);
});

// This test asserted this ticket's own classifier (`listRun`, which decided a local query from an
// `edited` flag and a filter count) until issue #194 single-sourced that decision in `resultMode`,
// because two classifiers let the panel promise one kind of read and the list perform the other.
// The assertion moved with the decision: what a restored list owes is the box the person left, and
// the read is the address's, so the rule is asked of `resultMode` rather than re-stated here.
test('a restored list carries the box, and the address alone decides the read', () => {
  const carrier = newListStateCarrier();
  writeListState(carrier, address, left);
  const restored = readListState(carrier, address);
  assert.notEqual(restored, null);
  assert.equal(restored?.text, left.text);
  assert.equal(restored?.edited, left.edited);
  // The one rule, asked of the address: the restored box cannot change which read it is.
  assert.equal(
    resultMode({ query: '', filters: noInventoryFilters, sort: null }),
    'catalogue',
  );
  assert.equal(
    resultMode({
      query: restored!.text,
      filters: noInventoryFilters,
      sort: null,
    }),
    'advanced',
  );
  assert.equal(
    resultMode({ query: '', filters: noInventoryFilters, sort: 'oldest' }),
    'advanced',
  );
  assert.equal(
    resultMode({
      query: '',
      filters: { ...noInventoryFilters, province: PROVINCE },
      sort: null,
    }),
    'advanced',
  );
});

// The position is only put on once the results have rendered: the read has stated the total the
// stream reserves its whole height from, and the grid's chunk size - the measured column count -
// has settled. Before that there is no height to land on, and the position would be clamped onto
// whatever is there and name rows the person never saw.
test('a position is only restored onto a stream that has rendered', () => {
  const grid = { read: true, total: 400, view: 'cards' as const, width: 1200 };
  assert.equal(positionReady(grid), true);
  // Nothing is on screen before the read answers, and an empty result set has no rows to restore
  // onto whatever the browser has measured.
  assert.equal(positionReady({ ...grid, read: false }), false);
  assert.equal(positionReady({ ...grid, total: 0 }), false);
  // The grid's chunk size is the measured column count: until the browser has measured the stream,
  // the height reserved for it describes a different chunk size than the one it will be drawn in.
  assert.equal(positionReady({ ...grid, width: 0 }), false);
  // The table reserves its height from the total alone, so it is ready without a measured width.
  assert.equal(
    positionReady({ read: true, total: 400, view: 'table', width: 0 }),
    true,
  );
  assert.equal(
    positionReady({ read: false, total: 400, view: 'table', width: 0 }),
    false,
  );
});

// A return to the list finds the rows the browser holds under the scope the shell last authorized,
// so both result sets paint while the surface's own session read answers (issue #265): the catalogue
// from its index, a submitted search as soon as its cached window is answered. That held scope is
// only ever the one in force: a session read that stopped with an error, a catalogue holding nothing
// under a scope, and a surface whose own read has already answered all read that other scope or
// nothing, so a change the surface's own read detected stays concealed and the rows cached under the
// former scope are dropped when the key moves.
test('the list reads under the scope in force, held or its own', () => {
  const pending = { own: null, answered: false, failed: false };
  // The own session has not answered: the catalogue's authorized scope is the one in force.
  assert.equal(readScope({ ...pending, held: 'emp:staff:7' }), 'emp:staff:7');
  // Nothing held under any scope, or a read that failed, paints nothing.
  assert.equal(readScope({ ...pending, held: null }), null);
  assert.equal(
    readScope({ ...pending, held: 'emp:staff:7', failed: true }),
    null,
  );
  // The surface's own read has answered, so a scope it did not read outranks nothing: a change that
  // read concealed stays concealed, whatever the catalogue above the route still holds.
  assert.equal(
    readScope({
      own: null,
      answered: true,
      held: 'emp:staff:7',
      failed: false,
    }),
    null,
  );
  // The session answers as the same scope the rows were cached under: the same key, so nothing is
  // read again.
  assert.equal(
    readScope({
      own: 'emp:staff:7',
      answered: true,
      held: 'emp:staff:7',
      failed: false,
    }),
    'emp:staff:7',
  );
  // The session answers as another scope - another user, role or access revision - so the key is
  // that scope and the windows cached under the held one are discarded with it.
  assert.equal(
    readScope({
      own: 'emp:staff:8',
      answered: true,
      held: 'emp:staff:7',
      failed: false,
    }),
    'emp:staff:8',
  );
});
