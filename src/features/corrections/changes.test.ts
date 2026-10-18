import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changedValues } from './changes.ts';

test('a proposal shows only the fields it names', () => {
  const observed = {
    sale_price_vnd: '900',
    land_area_m2: '42.25',
    floors: 3,
    status: 'listed',
  };
  const proposed = { sale_price_vnd: '905664' };
  assert.deepEqual(changedValues(observed, proposed), {
    observed: { sale_price_vnd: '900' },
    proposed: { sale_price_vnd: '905664' },
  });
});

test('a field the record never held is shown as an explicit unknown, not left out', () => {
  assert.deepEqual(changedValues({ floors: 3 }, { bedrooms: 4 }), {
    observed: { bedrooms: null },
    proposed: { bedrooms: 4 },
  });
});

test('no observed values still keeps every proposed field visible', () => {
  assert.deepEqual(changedValues(null, { floors: 3 }), {
    observed: { floors: null },
    proposed: { floors: 3 },
  });
});

test('a proposal that cannot be diffed is passed through rather than hidden', () => {
  for (const proposed of [null, 'text', 3, [1, 2]]) {
    assert.deepEqual(changedValues({ a: 1 }, proposed), {
      observed: { a: 1 },
      proposed,
    });
  }
});
