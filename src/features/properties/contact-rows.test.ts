import assert from 'node:assert/strict';
import test from 'node:test';
import { contactRows, type ContactLink } from './contact-rows.ts';

type ContactDetails = ContactLink['contacts'];

function link(
  contactId: string,
  relation: string,
  details: Partial<ContactDetails> = {},
  isPrimary = false,
): ContactLink {
  return {
    contact_id: contactId,
    revision: '1',
    relation,
    is_primary: isPrimary,
    contacts: {
      id: contactId,
      revision: '1',
      display_name: 'Synthetic person',
      phones: ['0900000001'],
      raw_phone_text: '0900 000 001',
      contact_type: 'broker',
      notes: null,
      ...details,
    },
  };
}

test('a recorded owner phone is absent from every automatic contact row', () => {
  const rows = contactRows([
    link('a1', 'owner', { display_name: 'Synthetic owner' }, true),
    link('a2', 'broker', {
      display_name: 'Synthetic broker',
      raw_phone_text: '0900 000 002',
    }),
  ]);
  assert.deepEqual(rows, [
    {
      id: 'a1',
      name: 'Synthetic owner',
      relation: 'owner',
      isPrimary: true,
      phone: { show: false },
    },
    {
      id: 'a2',
      name: 'Synthetic broker',
      relation: 'broker',
      isPrimary: false,
      phone: { show: true, text: '0900 000 002' },
    },
  ]);
  // The owner's recorded source text and normalized number never reach a row payload.
  assert.equal(JSON.stringify(rows).includes('0900 000 001'), false);
  assert.equal(JSON.stringify(rows).includes('0900000001'), false);
});

test('a shared contact linked as an owner keeps its phone withheld on its other rows', () => {
  const rows = contactRows([
    link('a1', 'owner', { display_name: 'Shared person' }, true),
    link('a1', 'broker', { display_name: 'Shared person' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.phone),
    [{ show: false }, { show: false }],
  );
  assert.deepEqual(
    rows.map((row) => [row.relation, row.isPrimary]),
    [
      ['owner', true],
      ['broker', false],
    ],
  );
});

test('owner eligibility is the property relation, not the contact type or another property', () => {
  const shared = link('a1', 'broker', { display_name: 'Shared person' });
  // The same contact is an owner elsewhere; this property records only a broker relationship.
  assert.deepEqual(contactRows([shared])[0]?.phone, {
    show: true,
    text: '0900 000 001',
  });
  // The contact's global classification is never what decides the row.
  assert.equal(shared.contacts.contact_type, 'broker');
});

test('non-owner relationships stay as recorded and missing values stay explicit', () => {
  const rows = contactRows([
    link('a1', 'representative', { raw_phone_text: '0900 000 003' }),
    link('a2', 'tenant', { raw_phone_text: null }),
    link('a3', 'unknown', { display_name: '', raw_phone_text: null }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.phone),
    [
      { show: true, text: '0900 000 003' },
      { show: true, text: null },
      { show: true, text: null },
    ],
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ['Synthetic person', 'Synthetic person', ''],
  );
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a1', 'a2', 'a3'],
  );
});

test('a link without embedded contact details still withholds an owner phone', () => {
  const rows = contactRows([
    {
      contact_id: 'a9',
      revision: '1',
      relation: 'owner',
      is_primary: false,
      contacts: null,
    } as unknown as ContactLink,
  ]);
  assert.deepEqual(rows, [
    {
      id: 'a9',
      name: null,
      relation: 'owner',
      isPrimary: false,
      phone: { show: false },
    },
  ]);
});

test('the projection takes no disclosure input: the phone arrives only from the reveal payload', () => {
  // A deliberate disclosure is a separate payload (OwnerContactDisclosure.contact.phone) that
  // this projection never reads, so no render of these rows can present an undisclosed phone.
  assert.equal(contactRows.length, 1);
});
