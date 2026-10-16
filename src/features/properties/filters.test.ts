import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeFilterCount,
  filterParams,
  filterRpcArgs,
  noInventoryFilters,
  parseInventoryFilters,
} from './filters.ts';

function parse(values: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, value);
  return parseInventoryFilters(params);
}

test('a complete filter set is applied exactly as the address stated it', () => {
  const result = parse({
    status: 'available',
    mode: 'rent',
    type: 'house',
    priceMin: '5000000',
    priceMax: '25000000',
    areaMin: '45.5',
    areaMax: '120',
  });
  assert.ok(result.ok);
  assert.deepEqual(result.filters, {
    status: 'available',
    mode: 'rent',
    type: 'house',
    priceMin: '5000000',
    priceMax: '25000000',
    areaMin: '45.5',
    areaMax: '120',
  });
});

test('an unset or blank address value is no bound, not an invalid one', () => {
  for (const values of [{}, { status: '', priceMin: '  ' }]) {
    const result = parse(values);
    assert.ok(result.ok);
    assert.deepEqual(result.filters, noInventoryFilters);
  }
  // A padded value is the same value, so an address copied with stray spaces still filters.
  const padded = parse({ mode: ' both ', areaMax: ' 80.5 ' });
  assert.ok(padded.ok);
  assert.equal(padded.filters.mode, 'both');
  assert.equal(padded.filters.areaMax, '80.5');
});

test('unknown status, mode or type values are refused', () => {
  for (const values of [
    { status: 'archived' },
    { status: 'Available' },
    { mode: 'lease' },
    { mode: 'BOTH' },
    { type: 'shophouse' },
  ])
    assert.equal(parse(values).ok, false, JSON.stringify(values));
});

test('a price bound is whole VND across the database range', () => {
  for (const value of ['0', '123456789012345', '999999999999999999'])
    assert.equal(parse({ priceMin: value }).ok, true, value);
  for (const value of ['1.5', '-1', '1e9', '5 000', '1000000000000000000', ''])
    assert.equal(
      parse({ priceMin: value }).ok,
      value === '',
      `${value} price bound`,
    );
});

test('an area bound is positive square metres with at most two decimals', () => {
  for (const value of ['1', '45.5', '120.25', '9999999999.99'])
    assert.equal(parse({ areaMin: value }).ok, true, value);
  for (const value of ['0', '0.00', '-3', '12.345', '10000000000', 'abc'])
    assert.equal(parse({ areaMin: value }).ok, false, `${value} area bound`);
});

test('a reversed range and an equal bound', () => {
  assert.equal(
    parse({ priceMin: '9000', priceMax: '8000' }).ok,
    false,
    'reversed price range',
  );
  assert.equal(
    parse({ areaMin: '100.5', areaMax: '100.4' }).ok,
    false,
    'reversed area range',
  );
  for (const values of [
    { priceMin: '9000', priceMax: '9000' },
    { areaMin: '45.50', areaMax: '45.5' },
  ])
    assert.equal(parse(values).ok, true, JSON.stringify(values));
});

test('a bound size is compared exactly, never as a rounded number', () => {
  // Both bounds are far beyond exact float integers; only the larger one is a reversed range.
  assert.equal(
    parse({ priceMin: '999999999999999', priceMax: '999999999999998' }).ok,
    false,
  );
  assert.equal(
    parse({ areaMin: '9999999999.99', areaMax: '9999999999.98' }).ok,
    false,
  );
});

test('only set filters become link and RPC parameters', () => {
  assert.deepEqual(filterParams(noInventoryFilters), {});
  assert.deepEqual(
    filterParams({ ...noInventoryFilters, mode: 'sale', areaMax: '80' }),
    { mode: 'sale', areaMax: '80' },
  );
  assert.equal(activeFilterCount(noInventoryFilters), 0);
  assert.equal(
    activeFilterCount({
      ...noInventoryFilters,
      status: 'available',
      mode: 'sale',
    }),
    2,
  );
  assert.deepEqual(filterRpcArgs(noInventoryFilters), {});
  assert.deepEqual(
    filterRpcArgs({
      ...noInventoryFilters,
      status: 'available',
      priceMin: '1000',
      priceMax: '2000',
      areaMin: '45.5',
    }),
    {
      p_status: 'available',
      p_price_min: '1000',
      p_price_max: '2000',
      p_area_min: 45.5,
    },
  );
  assert.deepEqual(
    filterRpcArgs({
      ...noInventoryFilters,
      priceMin: '100000000000000000',
      priceMax: '999999999999999999',
    }),
    {
      p_price_min: '100000000000000000',
      p_price_max: '999999999999999999',
    },
  );
});
