import assert from 'node:assert/strict';
import test from 'node:test';
import {
  priceChanges,
  priceFieldChanged,
  recordedVnd,
} from './history-model.ts';

const event = (over: Record<string, unknown> = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  occurred_at: '2026-10-10T07:20:00Z',
  actor_name: 'Nguyễn Thu Hà',
  changed_fields: [] as string[],
  before_values: {},
  after_values: {},
  ...over,
});

test('a recorded sale-price change keeps the exact whole-VND figures', () => {
  assert.deepEqual(
    priceChanges(
      event({
        changed_fields: ['sale_price_vnd'],
        before_values: { sale_price_vnd: '30000000000' },
        after_values: { sale_price_vnd: '42000000000' },
      }),
    ),
    [
      {
        key: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:sale_price_vnd',
        occurredAt: '2026-10-10T07:20:00Z',
        actorName: 'Nguyễn Thu Hà',
        field: 'sale_price_vnd',
        before: '30000000000',
        after: '42000000000',
      },
    ],
  );
});

test('sale and monthly rent are reported as separate price changes', () => {
  const rows = priceChanges(
    event({
      changed_fields: ['sale_price_vnd', 'monthly_rent_vnd', 'status'],
      before_values: { sale_price_vnd: '1000000000' },
      after_values: {
        sale_price_vnd: '2000000000',
        monthly_rent_vnd: '120000000',
      },
    }),
  );
  assert.deepEqual(
    rows.map((row) => [row.field, row.before, row.after]),
    [
      ['sale_price_vnd', '1000000000', '2000000000'],
      ['monthly_rent_vnd', null, '120000000'],
    ],
  );
});

test('a change that moved no price field produces no price row', () => {
  assert.deepEqual(
    priceChanges(
      event({
        changed_fields: ['status', 'notes'],
        after_values: { status: 'negotiating' },
      }),
    ),
    [],
  );
});

test('only an exact whole-VND string becomes a figure', () => {
  assert.equal(recordedVnd('999999999999999999999'), '999999999999999999999');
  assert.equal(recordedVnd(42000000000), null);
  assert.equal(recordedVnd('42000000000.00'), null);
  assert.equal(recordedVnd('-1'), null);
  assert.equal(recordedVnd('42 tỷ'), null);
  assert.equal(recordedVnd(null), null);
  assert.equal(recordedVnd({}), null);
});

test('a cleared price keeps what was recorded and reports no new figure', () => {
  assert.deepEqual(
    priceChanges(
      event({
        changed_fields: ['monthly_rent_vnd'],
        before_values: { monthly_rent_vnd: '120000000' },
        after_values: { monthly_rent_vnd: null },
      }),
    ).map((row) => [row.before, row.after]),
    [['120000000', null]],
  );
});

test('a price-only change names that price; a mixed change does not', () => {
  assert.equal(priceFieldChanged(['sale_price_vnd']), 'sale_price_vnd');
  assert.equal(
    priceFieldChanged(['status', 'monthly_rent_vnd']),
    'monthly_rent_vnd',
  );
  assert.equal(priceFieldChanged(['sale_price_vnd', 'monthly_rent_vnd']), null);
  assert.equal(priceFieldChanged(['status']), null);
});
