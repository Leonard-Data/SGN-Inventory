import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitCatalogUnavailable, unitOptionLabels } from './units.ts';

test('an official unit option shows the name alone', () => {
  assert.deepEqual(
    unitOptionLabels([
      {
        name_vi: 'Tỉnh Đồng Nai',
        valid_from: '2025-07-01',
        valid_to: '2026-04-30',
      },
      {
        name_vi: 'Thành phố Đồng Nai',
        valid_from: '2026-04-30',
        valid_to: null,
      },
    ]),
    ['Tỉnh Đồng Nai', 'Thành phố Đồng Nai'],
  );
});

test('an unavailable catalog preserves the stored selection path', () => {
  assert.equal(
    unitCatalogUnavailable('province', undefined, true, false),
    true,
  );
  assert.equal(
    unitCatalogUnavailable('commune', 'province-id', false, true),
    true,
  );
  assert.equal(
    unitCatalogUnavailable('commune', undefined, false, false),
    true,
  );
  assert.equal(
    unitCatalogUnavailable('commune', 'province-id', false, false),
    false,
  );
});

test('a name repeated in one list keeps the dated window that distinguishes it', () => {
  assert.deepEqual(
    unitOptionLabels([
      { name_vi: 'Xã Bình Minh', valid_from: '2025-07-01', valid_to: null },
      { name_vi: 'Xã Bình Minh', valid_from: '2026-09-20', valid_to: null },
      { name_vi: 'Phường Bến Thành', valid_from: '2025-07-01', valid_to: null },
    ]),
    [
      'Xã Bình Minh (2025-07-01 – )',
      'Xã Bình Minh (2026-09-20 – )',
      'Phường Bến Thành',
    ],
  );
});
