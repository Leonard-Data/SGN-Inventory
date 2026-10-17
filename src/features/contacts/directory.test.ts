import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONTACT_PAGE_SIZE,
  CONTACT_QUERY_MAX_LENGTH,
  ContactDirectoryError,
  contactDirectoryQuery,
  contactName,
  contactPage,
  contactSummary,
} from './directory.ts';

const contact = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const revision = '90000000-0000-4000-8000-000000000001';

function row(index: number, patch: Record<string, unknown> = {}) {
  return {
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    display_name: `Người liên hệ ${index}`,
    contact_type: 'unknown',
    phones: [],
    raw_phone_text: null,
    revision,
    links: [],
    ...patch,
  };
}

function link(patch: Record<string, unknown> = {}) {
  return {
    property_id: contact,
    property_code: 'SGN-00000001',
    relation: 'owner',
    is_primary: false,
    archived: false,
    ...patch,
  };
}

test('a blank search browses and a trimmed fragment passes through', () => {
  assert.deepEqual(contactDirectoryQuery(new URLSearchParams()), {
    query: null,
    after: null,
    view: 'all',
  });
  assert.deepEqual(
    contactDirectoryQuery(new URLSearchParams('query=++Nguyễn+Văn++')),
    { query: 'Nguyễn Văn', after: null, view: 'all' },
  );
  assert.equal(
    contactDirectoryQuery(new URLSearchParams('query=' + '  ')).query,
    null,
  );
});

test('the Owners view is a recorded link filter, never the global type', () => {
  assert.equal(
    contactDirectoryQuery(new URLSearchParams('view=owners')).view,
    'owners',
  );
  // An empty or explicit "all" means the whole directory; nothing else is accepted.
  assert.equal(contactDirectoryQuery(new URLSearchParams('view=')).view, 'all');
  assert.equal(
    contactDirectoryQuery(new URLSearchParams('view=all')).view,
    'all',
  );
  for (const view of ['broker', 'OWNERS', 'owner', '1'])
    assert.throws(
      () => contactDirectoryQuery(new URLSearchParams('view=' + view)),
      ContactDirectoryError,
    );
});

test('only the search, id cursor and view are accepted', () => {
  assert.throws(
    () => contactDirectoryQuery(new URLSearchParams('before=2026-10-01')),
    ContactDirectoryError,
  );
  assert.throws(
    () => contactDirectoryQuery(new URLSearchParams('after=not-a-uuid')),
    ContactDirectoryError,
  );
  // A valid ascending id cursor is accepted unchanged.
  assert.deepEqual(
    contactDirectoryQuery(new URLSearchParams('after=' + contact)),
    { query: null, after: contact, view: 'all' },
  );
});

test('the query is bounded to the shared literal fragment length', () => {
  assert.equal(
    contactDirectoryQuery(
      new URLSearchParams('query=' + 'a'.repeat(CONTACT_QUERY_MAX_LENGTH)),
    ).query,
    'a'.repeat(CONTACT_QUERY_MAX_LENGTH),
  );
  assert.throws(
    () =>
      contactDirectoryQuery(
        new URLSearchParams(
          'query=' + 'a'.repeat(CONTACT_QUERY_MAX_LENGTH + 1),
        ),
      ),
    ContactDirectoryError,
  );
});

test('the page is bounded and carries the ascending id cursor', () => {
  const rows = Array.from({ length: CONTACT_PAGE_SIZE + 1 }, (_, index) =>
    row(index),
  );
  const page = contactPage(rows);
  assert.equal(page.contacts.length, CONTACT_PAGE_SIZE);
  assert.equal(page.nextCursor, rows[CONTACT_PAGE_SIZE - 1]!.id);
  assert.deepEqual(contactPage([]), { contacts: [], nextCursor: null });
  const exact = contactPage(rows.slice(0, CONTACT_PAGE_SIZE));
  assert.equal(exact.contacts.length, CONTACT_PAGE_SIZE);
  assert.equal(exact.nextCursor, null);
});

test('recorded values, unknown details and per-property relationships survive', () => {
  assert.deepEqual(contactSummary(row(1)), {
    id: row(1).id,
    displayName: 'Người liên hệ 1',
    contactType: 'unknown',
    phones: [],
    rawPhoneText: null,
    revision,
    links: [],
    propertyCount: 0,
  });
  assert.deepEqual(
    contactSummary(
      row(2, {
        display_name: 'Nguyễn Văn Ứng',
        contact_type: 'broker',
        phones: ['090 123 4567'],
        raw_phone_text: '090 123 4567 (Zalo)',
        links: [
          link({ relation: 'owner', is_primary: true }),
          link({
            property_id: other,
            property_code: 'SGN-00000002',
            relation: 'broker',
          }),
        ],
      }),
    ),
    {
      id: row(2).id,
      displayName: 'Nguyễn Văn Ứng',
      contactType: 'broker',
      phones: ['090 123 4567'],
      rawPhoneText: '090 123 4567 (Zalo)',
      revision,
      links: [
        {
          propertyId: contact,
          propertyCode: 'SGN-00000001',
          relation: 'owner',
          isPrimary: true,
          archived: false,
        },
        {
          propertyId: other,
          propertyCode: 'SGN-00000002',
          relation: 'broker',
          isPrimary: false,
          archived: false,
        },
      ],
      propertyCount: 2,
    },
  );
});

test('the property count is derived from the readable links', () => {
  // The count and the listed property codes come from the same projected links, so they cannot
  // drift; a contact with no readable link counts zero and keeps the unlinked reading in the UI.
  const one = contactSummary(row(20, { links: [link()] }));
  assert.equal(one.propertyCount, 1);
  assert.equal(one.propertyCount, one.links.length);
  const none = contactSummary(row(21));
  assert.equal(none.propertyCount, 0);
  assert.equal(none.propertyCount, none.links.length);
});

test('an archived linked property is listed but never counted', () => {
  // The same unarchived boundary the inventory contact filter applies: a contact whose only
  // linked property is archived states no count and the filter matches nothing for it.
  const archivedOnly = contactSummary(
    row(22, {
      links: [link({ property_code: 'SGN-ARCHIVED-01', archived: true })],
    }),
  );
  assert.equal(archivedOnly.links.length, 1);
  assert.equal(archivedOnly.links[0]!.archived, true);
  assert.equal(archivedOnly.propertyCount, 0);
  const mixed = contactSummary(
    row(23, {
      links: [
        link({ archived: true }),
        link({
          property_id: other,
          property_code: 'SGN-00000002',
          archived: false,
        }),
      ],
    }),
  );
  assert.equal(mixed.links.length, 2);
  assert.equal(mixed.propertyCount, 1);
});

test('the applied contact name is read from one bounded identity read', () => {
  assert.equal(
    contactName({ contact: { display_name: 'Nguyễn Văn A' }, impact: {} }),
    'Nguyễn Văn A',
  );
  // An unreadable or malformed detail response is a failed name, never a person named by id.
  for (const broken of [
    null,
    {},
    { contact: null },
    { contact: { display_name: '' } },
    { contact: { display_name: 7 } },
    { contact: [] },
  ])
    assert.throws(() => contactName(broken), ContactDirectoryError);
});

test('a malformed row or relationship is a failed read, not a partial person', () => {
  for (const broken of [
    null,
    {},
    row(3, { id: 'not-a-uuid' }),
    row(4, { revision: null }),
    row(5, { display_name: 7 }),
    row(6, { contact_type: 7 }),
    row(7, { phones: '090' }),
    row(8, { phones: ['090', 7] }),
    row(9, { raw_phone_text: 7 }),
    row(10, { links: {} }),
    row(11, { links: [link({ relation: 7 })] }),
    row(12, { links: [link({ property_id: 'not-a-uuid' })] }),
    row(13, { links: [link({ property_code: null })] }),
    row(14, { links: [link({ is_primary: 'true' })] }),
    row(15, { links: [link({ archived: null })] }),
  ])
    assert.throws(() => contactSummary(broken), ContactDirectoryError);
});
