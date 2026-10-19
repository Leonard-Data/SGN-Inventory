import assert from 'node:assert/strict';
import test from 'node:test';
import { HIDDEN_PHONE, ownerPhoneView } from './owner-phone.ts';
import type { OwnerContactDisclosure } from './types.ts';

function disclosure(phone: string, displayName = 'Synthetic owner') {
  return {
    eventId: 'event',
    businessDay: '2026-10-19',
    credited: true,
    contact: {
      id: 'contact',
      displayName,
      relation: 'owner',
      isPrimary: true,
      phone,
    },
  } satisfies OwnerContactDisclosure;
}

test('a hidden owner phone is no value at all, not a masked one', () => {
  const hidden = ownerPhoneView(null);
  assert.deepEqual(hidden, { shown: false });
  // Nothing about the hidden state carries a digit a copy-paste could pick up.
  assert.equal(/\d/.test(JSON.stringify(hidden)), false);
  assert.equal(HIDDEN_PHONE.includes('•'), true);
  assert.equal(/\d/.test(HIDDEN_PHONE), false);
});

test('a disclosure with no contact, and one with no recorded phone, stay hidden', () => {
  assert.deepEqual(
    ownerPhoneView({ ...disclosure('0900 000 001'), contact: null }),
    { shown: false },
  );
  assert.deepEqual(ownerPhoneView(disclosure('   ')), { shown: false });
});

test('a deliberate disclosure presents the recorded name and the phone verbatim', () => {
  assert.deepEqual(ownerPhoneView(disclosure('0900 000 001', 'Nguyễn Văn A')), {
    shown: true,
    name: 'Nguyễn Văn A',
    phone: '0900 000 001',
  });
});
