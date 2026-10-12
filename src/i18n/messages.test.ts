import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages } from './messages.ts';

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
