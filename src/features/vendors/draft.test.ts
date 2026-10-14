import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  VENDOR_BODY_MAX_BYTES,
  VENDOR_CONTACT_NAME_MAX_LENGTH,
  VENDOR_EMAIL_MAX_LENGTH,
  VENDOR_NAME_MAX_LENGTH,
  VENDOR_NOTES_MAX_LENGTH,
  VENDOR_PHONE_MAX_COUNT,
  VENDOR_PHONE_MAX_LENGTH,
  VENDOR_SOURCE_ADDRESS_MAX_LENGTH,
  VendorDraftError,
  vendorDraft,
} from './draft.ts';

const key = '10000000-0000-4000-8000-0000000000ff';

test('a bounded draft is trimmed and blank optional details become unknown', () => {
  assert.deepEqual(
    vendorDraft({
      key,
      displayName: '  Công ty TNHH Vật tư Ứng Dụng  ',
      contactName: ' Nguyễn Văn Ứng ',
      phones: ['090 123 4567', '  ', '+84 (0)28 3822 1234'],
      email: ' ung.dung@example.test ',
      sourceAddress: ' 12 Lý Thường Kiệt, Quận 10 ',
      notes: '\nGiao hàng buổi sáng\n',
    }),
    {
      key,
      displayName: 'Công ty TNHH Vật tư Ứng Dụng',
      contactName: 'Nguyễn Văn Ứng',
      // A blank line in the phone control is not a recorded phone.
      phones: ['090 123 4567', '+84 (0)28 3822 1234'],
      email: 'ung.dung@example.test',
      sourceAddress: '12 Lý Thường Kiệt, Quận 10',
      notes: 'Giao hàng buổi sáng',
    },
  );
  assert.deepEqual(vendorDraft({ key, displayName: 'Chỉ có tên công ty' }), {
    key,
    displayName: 'Chỉ có tên công ty',
    contactName: null,
    phones: null,
    email: null,
    sourceAddress: null,
    notes: null,
  });
  assert.equal(
    vendorDraft({ key, displayName: 'Tên', phones: '090 123 4567' }).phones
      ?.length,
    1,
  );
  // A one-per-line string is the same entry list the create form's textarea sends.
  assert.deepEqual(
    vendorDraft({
      key,
      displayName: 'Tên',
      phones: '090 123 4567\n+84 (0)28 3822 1234\n\n',
    }).phones,
    ['090 123 4567', '+84 (0)28 3822 1234'],
  );
});

test('the create body cap admits every bounded draft', () => {
  const bounded = vendorDraft({
    key,
    displayName: 'ệ'.repeat(VENDOR_NAME_MAX_LENGTH),
    contactName: 'ệ'.repeat(VENDOR_CONTACT_NAME_MAX_LENGTH),
    phones: Array.from({ length: VENDOR_PHONE_MAX_COUNT }, () =>
      'ệ'.repeat(VENDOR_PHONE_MAX_LENGTH),
    ),
    email: `${'ệ'.repeat(VENDOR_EMAIL_MAX_LENGTH - '@example.test'.length)}@example.test`,
    sourceAddress: 'ệ'.repeat(VENDOR_SOURCE_ADDRESS_MAX_LENGTH),
    notes: 'ệ'.repeat(VENDOR_NOTES_MAX_LENGTH),
  });
  const bytes = Buffer.byteLength(JSON.stringify(bounded), 'utf8');
  assert.ok(bytes > 8192, 'the bounded shape exceeds the old default cap');
  assert.ok(
    bytes <= VENDOR_BODY_MAX_BYTES,
    'the transport cap admits every bounded draft',
  );
});

test('a malformed draft is refused at the application boundary', () => {
  const good = { key, displayName: 'Công ty' };
  const refused: Record<string, unknown>[] = [
    { ...good, displayName: '' },
    { ...good, displayName: '   ' },
    { ...good, displayName: 'a'.repeat(VENDOR_NAME_MAX_LENGTH + 1) },
    { ...good, displayName: null },
    { ...good, displayName: 7 },
    { ...good, contactName: 'a'.repeat(201) },
    { ...good, email: 'not-an-email' },
    { ...good, email: 'a@b' },
    { ...good, email: 7 },
    { ...good, phones: [7] },
    { ...good, phones: ['a'.repeat(VENDOR_PHONE_MAX_LENGTH + 1)] },
    {
      ...good,
      phones: Array.from({ length: VENDOR_PHONE_MAX_COUNT + 1 }, (_, index) =>
        String(index),
      ),
    },
    { ...good, sourceAddress: 'a'.repeat(501) },
    { ...good, notes: 'a'.repeat(2001) },
    { ...good, extra: true },
    { displayName: 'Công ty' },
    { key: 'not-a-uuid', displayName: 'Công ty' },
  ];
  for (const draft of refused)
    assert.throws(
      () => vendorDraft(draft),
      (failure: unknown) =>
        failure instanceof VendorDraftError && failure.code === 'invalid-input',
    );
  assert.equal(
    vendorDraft({
      ...good,
      displayName: 'a'.repeat(VENDOR_NAME_MAX_LENGTH),
    }).displayName.length,
    VENDOR_NAME_MAX_LENGTH,
  );
});
