import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VENDOR_PAGE_SIZE,
  VENDOR_QUERY_MAX_LENGTH,
  VendorDirectoryError,
  mayMaintainVendors,
  vendorDirectoryQuery,
  vendorPage,
  vendorRecord,
} from './directory.ts';

function row(index: number, patch: Record<string, unknown> = {}) {
  return {
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    display_name: `Công ty ${index}`,
    contact_name: null,
    phones: null,
    email: null,
    source_address: null,
    notes: null,
    created_by: '10000000-0000-4000-8000-000000000001',
    created_at: `2026-10-01T00:00:00+00:00`,
    ...patch,
  };
}

test('a blank search browses and a trimmed fragment passes through', () => {
  assert.deepEqual(vendorDirectoryQuery(new URLSearchParams()), {
    query: null,
    before: null,
    beforeId: null,
  });
  assert.deepEqual(
    vendorDirectoryQuery(new URLSearchParams('query=++Vật+tư++')),
    { query: 'Vật tư', before: null, beforeId: null },
  );
  assert.equal(
    vendorDirectoryQuery(new URLSearchParams('query=' + '  ')).query,
    null,
  );
});

test('only the search and cursor pair are accepted', () => {
  assert.throws(
    () => vendorDirectoryQuery(new URLSearchParams('after=1')),
    (failure: unknown) =>
      failure instanceof VendorDirectoryError &&
      failure.code === 'invalid-input',
  );
  assert.throws(
    () =>
      vendorDirectoryQuery(
        new URLSearchParams('query=a&before=2026-10-01T00:00:00Z'),
      ),
    VendorDirectoryError,
  );
  assert.throws(
    () =>
      vendorDirectoryQuery(
        new URLSearchParams('before=2026-10-01T00:00:00Z&beforeId=not-a-uuid'),
      ),
    VendorDirectoryError,
  );
  assert.throws(
    () =>
      vendorDirectoryQuery(
        new URLSearchParams(
          'before=not-a-time&beforeId=10000000-0000-4000-8000-000000000001',
        ),
      ),
    VendorDirectoryError,
  );
  // A valid newest-first cursor pair is accepted unchanged.
  const cursor = new URLSearchParams();
  cursor.set('before', '2026-10-01T00:00:00.123456+00:00');
  cursor.set('beforeId', '10000000-0000-4000-8000-000000000001');
  assert.deepEqual(vendorDirectoryQuery(cursor), {
    query: null,
    before: '2026-10-01T00:00:00.123456+00:00',
    beforeId: '10000000-0000-4000-8000-000000000001',
  });
});

test('the query is bounded to the shared literal fragment length', () => {
  assert.equal(
    vendorDirectoryQuery(
      new URLSearchParams('query=' + 'a'.repeat(VENDOR_QUERY_MAX_LENGTH)),
    ).query,
    'a'.repeat(VENDOR_QUERY_MAX_LENGTH),
  );
  assert.throws(
    () =>
      vendorDirectoryQuery(
        new URLSearchParams('query=' + 'a'.repeat(VENDOR_QUERY_MAX_LENGTH + 1)),
      ),
    VendorDirectoryError,
  );
});

test('C5: every active role reads and only staff/manager/admin maintain', () => {
  assert.equal(mayMaintainVendors('staff'), true);
  assert.equal(mayMaintainVendors('manager'), true);
  assert.equal(mayMaintainVendors('admin'), true);
  assert.equal(mayMaintainVendors('sales'), false);
  assert.equal(mayMaintainVendors(''), false);
});

test('the page is bounded and carries the newest-first cursor pair', () => {
  const rows = Array.from({ length: VENDOR_PAGE_SIZE + 1 }, (_, index) =>
    row(index),
  );
  const page = vendorPage(rows);
  assert.equal(page.vendors.length, VENDOR_PAGE_SIZE);
  assert.deepEqual(page.nextCursor, {
    before: rows[VENDOR_PAGE_SIZE - 1]!.created_at,
    beforeId: rows[VENDOR_PAGE_SIZE - 1]!.id,
  });
  assert.deepEqual(vendorPage([]), { vendors: [], nextCursor: null });
  const exact = vendorPage(rows.slice(0, VENDOR_PAGE_SIZE));
  assert.equal(exact.vendors.length, VENDOR_PAGE_SIZE);
  assert.equal(exact.nextCursor, null);
});

test('unknown optional details stay null and malformed rows are refused', () => {
  const mapped = vendorRecord(row(1));
  assert.equal(mapped.displayName, 'Công ty 1');
  assert.equal(mapped.contactName, null);
  assert.equal(mapped.phones, null);
  assert.equal(mapped.email, null);
  assert.equal(mapped.sourceAddress, null);
  assert.equal(mapped.notes, null);
  assert.deepEqual(
    vendorRecord(
      row(2, {
        contact_name: 'Nguyễn Văn Ứng',
        phones: ['090 123 4567'],
        email: 'ung@example.test',
        source_address: '12 Lý Thường Kiệt, Quận 10',
        notes: 'Giao buổi sáng',
      }),
    ),
    {
      id: row(2).id,
      displayName: 'Công ty 2',
      contactName: 'Nguyễn Văn Ứng',
      phones: ['090 123 4567'],
      email: 'ung@example.test',
      sourceAddress: '12 Lý Thường Kiệt, Quận 10',
      notes: 'Giao buổi sáng',
      createdAt: '2026-10-01T00:00:00+00:00',
    },
  );
  for (const broken of [
    null,
    {},
    row(3, { id: 'not-a-uuid' }),
    row(4, { display_name: 7 }),
    row(5, { phones: '090' }),
    row(6, { phones: ['090', 7] }),
    row(7, { created_at: 7 }),
  ])
    assert.throws(() => vendorRecord(broken), VendorDirectoryError);
});
