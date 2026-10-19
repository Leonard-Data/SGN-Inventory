import assert from 'node:assert/strict';
import test from 'node:test';
import { readLinkedProperties } from './linked-properties.ts';

test('linked-property previews bound reads and never publish an aborted batch', async () => {
  let active = 0,
    peak = 0;
  const seen: string[] = [];
  const abort = new AbortController();
  await readLinkedProperties(
    Array.from({ length: 13 }, (_, i) => String(i)),
    async (id) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return id;
    },
    (batch) => seen.push(...batch),
    abort.signal,
  );
  assert.equal(peak, 4);
  assert.equal(seen.length, 13);
  const stopped: string[] = [];
  await readLinkedProperties(
    ['a', 'b', 'c', 'd', 'e'],
    async (id) => {
      abort.abort();
      return id;
    },
    (batch) => stopped.push(...batch),
    abort.signal,
  );
  assert.deepEqual(stopped, []);
});
