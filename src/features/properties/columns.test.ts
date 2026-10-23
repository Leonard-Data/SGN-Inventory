import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIXED_COLUMNS,
  HIDEABLE_COLUMNS,
  hiddenColumns,
  hideParam,
  shownColumns,
  toggleColumn,
} from './columns.ts';
import { SUMMARY_TABLE_COLUMNS } from './table.ts';

const hidden = (...columns: string[]) => hiddenColumns(columns.join(','));

test('a property code and an actions cell are never hidden', () => {
  assert.deepEqual([...FIXED_COLUMNS], ['property', 'actions']);
  assert.ok(!HIDEABLE_COLUMNS.includes('property'));
  assert.ok(!HIDEABLE_COLUMNS.includes('actions'));
  // Every other column the table draws is offered, in the table's own order.
  assert.deepEqual(
    [...HIDEABLE_COLUMNS],
    SUMMARY_TABLE_COLUMNS.filter(
      (column) => column !== 'property' && column !== 'actions',
    ),
  );
});

test('an address hides the columns it names and nothing else', () => {
  assert.equal(hiddenColumns(null).size, 0);
  assert.equal(hiddenColumns('').size, 0);
  assert.deepEqual([...hidden('address,price')].sort(), ['address', 'price']);
  // The two columns that can never be hidden stay shown even when an address names them, and a
  // name this table does not have hides nothing: neither reshapes the table.
  assert.deepEqual([...hidden('property,actions,notes,price')], ['price']);
  // A repeated or padded name is the same column, not a second one.
  assert.deepEqual([...hidden(' price , price ')], ['price']);
});

test('hiding a column takes it out of the shown columns, and showing it puts it back', () => {
  const one = toggleColumn(hidden(), 'creator');
  assert.deepEqual([...one], ['creator']);
  assert.ok(!shownColumns(one).includes('creator'));
  assert.equal(shownColumns(one).length, SUMMARY_TABLE_COLUMNS.length - 1);
  // The toggle is its own inverse, and the shown columns keep the table's order.
  assert.equal(toggleColumn(one, 'creator').size, 0);
  assert.deepEqual(shownColumns(hidden('price,floors')), [
    'property',
    'address',
    'totalArea',
    'frontage',
    'depth',
    'creator',
    'status',
    'modifiedTime',
    'actions',
  ]);
});

test('a column that can never be hidden is not hidden by a toggle either', () => {
  for (const column of FIXED_COLUMNS) {
    assert.equal(toggleColumn(hidden(), column).size, 0);
    assert.equal(toggleColumn(hidden('price'), column).has(column), false);
  }
  assert.ok(shownColumns(hidden()).includes('property'));
  assert.ok(shownColumns(hidden()).includes('actions'));
});

test('the address states the hidden columns in one order, and nothing when none are hidden', () => {
  assert.equal(hideParam(hidden()), null);
  assert.equal(hideParam(hidden('price,address')), 'address,price');
  // The same choice has one address whatever order it was made in, and it reads back as itself.
  assert.equal(hideParam(hidden('floors,address')), 'address,floors');
  assert.equal(hiddenColumns(hideParam(hidden('status,frontage'))).size, 2);
  assert.deepEqual(
    [...hiddenColumns(hideParam(hidden('status,frontage')))].sort(),
    ['frontage', 'status'],
  );
});
