import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listRun,
  newListStateCarrier,
  positionReady,
  readListState,
  writeListState,
  type InventoryListState,
} from './list-state.ts';

const address =
  '/properties?' +
  new URLSearchParams({ query: 'le loi', view: 'cards', status: 'available' });
const other = '/properties?query=le+loi&view=cards&status=rented';

const left: InventoryListState = {
  text: 'nguyen van thuong binh thanh',
  edited: true,
  scroll: 4200,
};

test('the carrier holds the list a person left, per result set', () => {
  const carrier = newListStateCarrier();
  assert.equal(readListState(carrier, address), null);
  writeListState(carrier, address, left);
  assert.deepEqual(readListState(carrier, address), left);
  // A different result set is a different list: the same address is what names it.
  assert.equal(readListState(carrier, other), null);
  writeListState(carrier, other, { text: '', edited: false, scroll: 0 });
  assert.deepEqual(readListState(carrier, address), left);
  assert.deepEqual(readListState(carrier, other), {
    text: '',
    edited: false,
    scroll: 0,
  });
});

test('a list is written whole, so nothing reaches it after the write', () => {
  const carrier = newListStateCarrier();
  const state = { ...left };
  writeListState(carrier, address, state);
  state.text = 'something else';
  state.scroll = 0;
  assert.deepEqual(readListState(carrier, address), left);
});

// What a restored list has to reproduce: the run it was written from. A state read back out of the
// carrier decides the same local query and the same ordering, whatever the address states.
test('a restored list runs the same query and ordering it was written from', () => {
  const carrier = newListStateCarrier();
  writeListState(carrier, address, left);
  const restored = readListState(carrier, address);
  assert.notEqual(restored, null);
  for (const sort of [null, 'oldest', 'newest']) {
    for (const filters of [0, 1, 4]) {
      const before = listRun(left, { sort, filters });
      const after = listRun(restored!, { sort, filters });
      assert.deepEqual(after, before);
      // The ordering is the one the address states, and it survives the round trip.
      assert.equal(after.order, sort);
    }
  }
  // The restored text and the restored edit state are the ones that were typed, not the address's
  // own submitted search.
  assert.deepEqual(listRun(restored!, { sort: null, filters: 0 }), {
    localQuery: 'nguyen van thuong binh thanh',
    order: null,
  });
});

// A result set the carrier holds nothing for is the list the address states: this is what a reload
// of the application starts from, and it is the same run as an untouched box on that address.
test('an address with no entry runs the address alone', () => {
  const carrier = newListStateCarrier();
  const restored = readListState(carrier, address);
  assert.equal(restored, null);
  const fresh = { text: 'le loi', edited: false };
  assert.deepEqual(listRun(fresh, { sort: null, filters: 0 }), {
    localQuery: null,
    order: null,
  });
  assert.deepEqual(listRun(fresh, { sort: 'oldest', filters: 0 }), {
    localQuery: null,
    order: 'oldest',
  });
});

// What the box holds decides the local query, and a chronological ordering or a filter set names a
// result set the loaded page cannot state, so neither filters locally (issue #194).
test('the box filters locally only for the ordinary browse', () => {
  assert.deepEqual(
    listRun({ text: ' le loi ', edited: true }, { sort: null, filters: 0 }),
    {
      localQuery: 'le loi',
      order: null,
    },
  );
  assert.equal(
    listRun({ text: 'le loi', edited: false }, { sort: null, filters: 0 })
      .localQuery,
    null,
  );
  assert.equal(
    listRun({ text: 'le loi', edited: true }, { sort: 'newest', filters: 0 })
      .localQuery,
    null,
  );
  assert.equal(
    listRun({ text: 'le loi', edited: true }, { sort: null, filters: 1 })
      .localQuery,
    null,
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
