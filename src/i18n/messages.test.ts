import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, label } from './messages.ts';

test('VI and EN dictionaries expose the same keys', () => {
  assert.deepEqual(
    Object.keys(messages.en).sort(),
    Object.keys(messages.vi).sort(),
  );
});

test('every message is a non-empty string', () => {
  for (const locale of ['vi', 'en'] as const) {
    for (const [key, value] of Object.entries(messages[locale])) {
      assert.equal(typeof value, 'string', `${locale}.${key} must be a string`);
      assert.ok(value.trim().length > 0, `${locale}.${key} must not be blank`);
    }
  }
});

test('the canonical authentication strings are present', () => {
  assert.equal(messages.vi.recoveryTitle, 'Khôi phục mật khẩu');
  assert.equal(messages.en.recoveryTitle, 'Recover password');
  assert.equal(messages.vi.stepVerify, 'Xác minh');
  assert.equal(messages.en.stepDone, 'Done');
  assert.equal(messages.vi.remember, 'Ghi nhớ đăng nhập');
  assert.equal(messages.en.remember, 'Keep me signed in');
});

// The negotiating status is stated as the captain asked for it: Vietnamese exactly as written,
// and English unchanged. The badge, the status control and the filter all read the status through
// `label`, so they cannot state a different wording than this one.
test('the Vietnamese negotiating label is exactly Thương Lượng', () => {
  assert.equal(messages.vi.negotiating, 'Thương Lượng');
  assert.equal(messages.en.negotiating, 'Negotiating');
  assert.equal(label('vi', 'negotiating'), 'Thương Lượng');
  assert.equal(label('en', 'negotiating'), 'Negotiating');
});
