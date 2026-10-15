import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VENDOR_PROPERTY_PAGE_SIZE,
  VendorLinkError,
  vendorLinkBody,
  vendorLinkRecord,
  vendorLinkRows,
  vendorPropertyPage,
  vendorUnlinkBody,
} from './links.ts';

const propertyId = '20000000-0000-4000-8000-000000000001';
const vendorId = '30000000-0000-4000-8000-000000000001';
const revision = '40000000-0000-4000-8000-000000000001';

test('a link body needs exactly the chosen vendor and the read property revision', () => {
  assert.deepEqual(vendorLinkBody({ vendorId, propertyRevision: revision }), {
    vendorId,
    propertyRevision: revision,
  });
  for (const body of [
    {},
    { vendorId },
    { propertyRevision: revision },
    { vendorId, propertyRevision: revision, changes: {} },
  ])
    assert.throws(() => vendorLinkBody(body), VendorLinkError);
  for (const broken of [
    { vendorId: 'not-a-uuid', propertyRevision: revision },
    { vendorId, propertyRevision: 'not-a-uuid' },
    { vendorId: null, propertyRevision: revision },
  ])
    assert.throws(() => vendorLinkBody(broken as never), VendorLinkError);
});

test('an unlink body carries the link revision the caller read', () => {
  assert.deepEqual(vendorUnlinkBody({ revision }), { revision });
  for (const broken of [
    {},
    { revision: 'nope' },
    { revision, remove: true },
    { revision: 7 },
  ])
    assert.throws(() => vendorUnlinkBody(broken as never), VendorLinkError);
});

test('a recorded link row is mapped with its unknown details kept unknown', () => {
  assert.deepEqual(
    vendorLinkRecord({
      vendor_id: vendorId,
      revision,
      display_name: 'Công ty Vật tư',
      contact_name: null,
      phones: null,
      email: null,
      created_at: '2026-10-15T00:00:00+00:00',
    }),
    {
      vendorId,
      revision,
      displayName: 'Công ty Vật tư',
      contactName: null,
      phones: null,
      email: null,
      linkedAt: '2026-10-15T00:00:00+00:00',
    },
  );
  assert.deepEqual(
    vendorLinkRows([
      {
        vendor_id: vendorId,
        revision,
        display_name: 'Công ty Vật tư',
        contact_name: 'Trần Văn Liên',
        phones: ['090 111 2222'],
        email: 'lien@example.test',
        created_at: '2026-10-15T00:00:00+00:00',
      },
    ]),
    [
      {
        vendorId,
        revision,
        displayName: 'Công ty Vật tư',
        contactName: 'Trần Văn Liên',
        phones: ['090 111 2222'],
        email: 'lien@example.test',
        linkedAt: '2026-10-15T00:00:00+00:00',
      },
    ],
  );
  for (const broken of [
    null,
    {},
    { vendor_id: 'nope', revision, display_name: 'x', created_at: 'now' },
    { vendor_id: vendorId, revision, display_name: 7, created_at: 'now' },
    {
      vendor_id: vendorId,
      revision,
      display_name: 'x',
      phones: '090',
      created_at: 'now',
    },
  ])
    assert.throws(() => vendorLinkRecord(broken), VendorLinkError);
});

test('the linked-property projection is bounded and reports the cut', () => {
  const row = (index: number) => ({
    property_id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    property_code: `SGN-${index}`,
    status: 'available',
    listing_mode: 'sale',
    archived_at: null,
    linked_at: '2026-10-15T00:00:00+00:00',
  });
  const rows = Array.from(
    { length: VENDOR_PROPERTY_PAGE_SIZE + 1 },
    (_, index) => row(index + 1),
  );
  const page = vendorPropertyPage(rows);
  assert.equal(page.properties.length, VENDOR_PROPERTY_PAGE_SIZE);
  assert.equal(page.more, true);
  assert.deepEqual(page.properties[0], {
    propertyId: row(1).property_id,
    propertyCode: 'SGN-1',
    status: 'available',
    archivedAt: null,
    linkedAt: '2026-10-15T00:00:00+00:00',
  });
  const exact = vendorPropertyPage(rows.slice(0, VENDOR_PROPERTY_PAGE_SIZE));
  assert.equal(exact.properties.length, VENDOR_PROPERTY_PAGE_SIZE);
  assert.equal(exact.more, false);
  assert.deepEqual(vendorPropertyPage([]), { properties: [], more: false });
  assert.throws(
    () => vendorPropertyPage([{ property_id: propertyId }]),
    VendorLinkError,
  );
});
