import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INVENTORY_PAGE_SIZE,
  inventoryPageCount,
  isInventoryOrder,
  pageNumbers,
  parseInventoryPaging,
  reversedOrder,
} from './paging.ts';

const paging = (values: Record<string, string>) =>
  parseInventoryPaging(new URLSearchParams(values));

test('an absent page number is the first page', () => {
  assert.deepEqual(paging({}), { ok: true, paging: { page: 1 } });
  assert.deepEqual(paging({ page: '4' }), { ok: true, paging: { page: 4 } });
});

test('a page the address states must be usable or it is refused', () => {
  for (const value of [
    '',
    '0',
    '-1',
    '1.5',
    'two',
    ' 2',
    '2 ',
    '007',
    '1000000000',
  ])
    assert.deepEqual(paging({ page: value }), { ok: false }, `page=${value}`);
});

test('a result set always states at least one page', () => {
  assert.equal(inventoryPageCount(0), 1);
  assert.equal(inventoryPageCount(1), 1);
  assert.equal(inventoryPageCount(INVENTORY_PAGE_SIZE), 1);
  assert.equal(inventoryPageCount(INVENTORY_PAGE_SIZE + 1), 2);
  assert.equal(inventoryPageCount(INVENTORY_PAGE_SIZE * 2 + 1), 3);
});

test('the numbered pages stay inside the result set and around the current page', () => {
  assert.deepEqual(pageNumbers(1, 1), [1]);
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(pageNumbers(1, 20), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(pageNumbers(10, 20), [7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(pageNumbers(20, 20), [14, 15, 16, 17, 18, 19, 20]);
  // A page the database corrected back onto the result set still numbers from inside it.
  assert.deepEqual(pageNumbers(99, 4), [1, 2, 3, 4]);
});

test('only the two chronological orderings are accepted', () => {
  assert.equal(isInventoryOrder('oldest'), true);
  assert.equal(isInventoryOrder('newest'), true);
  for (const value of ['', 'asc', 'desc', 'OLDEST', null, undefined])
    assert.equal(isInventoryOrder(value), false);
});

test('the direction toggle reverses only an active entry-date ordering', () => {
  assert.equal(reversedOrder(null), null);
  assert.equal(reversedOrder('oldest'), 'newest');
  assert.equal(reversedOrder('newest'), 'oldest');
});
