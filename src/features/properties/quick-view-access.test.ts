import assert from 'node:assert/strict';
import test from 'node:test';
import { quickViewAvailable } from './quick-view-access.ts';

// A list painted from the held catalogue shows its rows before this surface's own session read
// answers, and the quick view states the caller's permissions from that read. A click in that window
// cannot be kept and replayed, so every row control reports itself unavailable instead of taking a
// click that opens nothing, and becomes available with the answer (issue #265).
test('the quick view is unavailable until the session answers', () => {
  assert.equal(quickViewAvailable(null), false);
  assert.equal(quickViewAvailable('emp:staff:7'), true);
});
