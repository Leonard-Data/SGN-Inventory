import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dismissToast,
  expireToasts,
  MAX_TOASTS,
  pushToast,
  TOAST_DURATION_MS,
  toastFor,
  type Toast,
} from './toast-state.ts';

const now = 1_700_000_000_000;

test('a saved change raises one success toast carrying its own message', () => {
  const toast = toastFor({ saved: true, message: 'Property saved.' }, 'a', now);
  assert.deepEqual(toast, {
    id: 'a',
    tone: 'success',
    message: 'Property saved.',
    expiresAt: now + TOAST_DURATION_MS,
  });
  assert.equal(pushToast([], toast).length, 1);
});

test('a failure raises no toast, whatever message it carries', () => {
  assert.equal(toastFor({ saved: false }, 'a', now), null);
  assert.deepEqual(pushToast([], null), []);
});

test('a non-success tone is kept as given', () => {
  assert.equal(
    toastFor({ saved: true, message: 'Gone.', tone: 'neutral' }, 'a', now)
      ?.tone,
    'neutral',
  );
});

test('dismissal removes only the dismissed toast', () => {
  const first = toastFor({ saved: true, message: 'One.' }, 'a', now)!;
  const second = toastFor({ saved: true, message: 'Two.' }, 'b', now)!;
  assert.deepEqual(dismissToast([first, second], 'a'), [second]);
  assert.deepEqual(dismissToast([first, second], 'missing'), [first, second]);
});

test('an expired toast goes on its own and a live one stays', () => {
  const toast = toastFor({ saved: true, message: 'One.' }, 'a', now)!;
  assert.deepEqual(expireToasts([toast], toast.expiresAt), []);
  assert.deepEqual(expireToasts([toast], toast.expiresAt - 1), [toast]);
});

test('the queue keeps the newest confirmations and drops the oldest', () => {
  let list: Toast[] = [];
  for (let index = 0; index < MAX_TOASTS + 2; index += 1)
    list = pushToast(
      list,
      toastFor({ saved: true, message: String(index) }, String(index), now),
    );
  assert.deepEqual(
    list.map((toast) => toast.message),
    ['2', '3', '4'],
  );
});
