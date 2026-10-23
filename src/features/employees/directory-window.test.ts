import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIRECTORY_PAGE_SIZE } from './directory.ts';
import { DIRECTORY_ENDPOINT, directoryWindow } from './directory-window.ts';
import {
  STREAM_CHUNK_ROWS,
  streamBand,
  streamChunkCount,
  streamChunkHeights,
  streamChunkRows,
  streamKnownRows,
  streamOffsets,
  streamWindows,
  streamWindowStart,
} from '../stream/window.ts';

const entry = (index: number) => ({
  id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
  displayName: `Nhân viên ${index}`,
  email: `employee${index}@example.test`,
  phone: null,
  bio: null,
  role: 'staff',
  access: 'active',
  deactivation: null,
  deletion: null,
  invitation: null,
});

const page = (count: number, nextCursor: string | null) => ({
  employees: Array.from({ length: count }, (_, index) => entry(index)),
  nextCursor,
});

test('the directory read is one stream addressed without a page or a cursor', () => {
  assert.equal(DIRECTORY_ENDPOINT, '/api/employees');
  assert.equal(DIRECTORY_PAGE_SIZE, 30);
});

test('a window of the directory read states its employees and the cursor after them', () => {
  const cursor = '00000031-0000-4000-8000-000000000000';
  const first = directoryWindow(page(DIRECTORY_PAGE_SIZE, cursor));
  assert.equal(first.rows.length, DIRECTORY_PAGE_SIZE);
  assert.equal(first.rows[0]?.displayName, 'Nhân viên 0');
  // The cursor is the last row of the window: it is where the next window starts.
  assert.equal(first.next, cursor);
  // A window with no following page ends the stream.
  assert.equal(directoryWindow(page(7, null)).next, null);
  assert.equal(directoryWindow(page(0, null)).rows.length, 0);
});

test('a payload this page cannot place is a failed read, not a short window', () => {
  // A short window would end the stream early and hide recorded employees.
  for (const payload of [
    null,
    {},
    { employees: 'none', nextCursor: null },
    { employees: [], nextCursor: 4 },
    { employees: [{ displayName: 'no id' }], nextCursor: null },
    { employees: [{ id: 7 }], nextCursor: null },
  ])
    assert.throws(
      () => directoryWindow(payload),
      Error,
      JSON.stringify(payload),
    );
});

// The directory's own geometry, at the read length its endpoint pages with.
const VIEWPORT = 900;
const ROW_PX = 72;
const offsetsFor = (rows: number) => {
  const chunkCount = streamChunkCount(rows, STREAM_CHUNK_ROWS);
  return {
    chunkCount,
    offsets: streamOffsets(
      streamChunkHeights(
        new Map(
          Array.from({ length: chunkCount }, (_, index) => [
            index,
            ROW_PX * STREAM_CHUNK_ROWS,
          ]),
        ),
        chunkCount,
        ROW_PX * STREAM_CHUNK_ROWS,
      ),
    ),
  };
};

test('scrolling near the end of the loaded employees asks for the next window', () => {
  const known = DIRECTORY_PAGE_SIZE * 3;
  const rows = streamKnownRows(known, true, DIRECTORY_PAGE_SIZE);
  const { chunkCount, offsets } = offsetsFor(rows);
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop: (known - 3) * ROW_PX,
    viewportHeight: VIEWPORT,
  });
  const needed = streamWindows({
    first: band.first,
    last: band.last,
    total: rows,
    chunkRows: STREAM_CHUNK_ROWS,
    pageSize: DIRECTORY_PAGE_SIZE,
  });
  // The window the next read fills is asked for by scrolling alone, and it is the one right after
  // the last loaded row.
  assert.deepEqual(needed, [
    streamWindowStart(known - 3, DIRECTORY_PAGE_SIZE),
    known,
  ]);
  assert.ok(needed.includes(known));
  // Nothing past the rows the stream can account for is ever read.
  assert.ok(needed.every((offset) => offset < rows));
  // At the start of the stream only the first window is needed: no window is read ahead.
  const top = streamBand({
    chunkCount,
    offsets,
    scrollTop: 0,
    viewportHeight: VIEWPORT,
  });
  assert.deepEqual(
    streamWindows({
      first: top.first,
      last: top.last,
      total: rows,
      chunkRows: STREAM_CHUNK_ROWS,
      pageSize: DIRECTORY_PAGE_SIZE,
    }),
    [0],
  );
});

// The window in flight as the employee directory reads it: the rows its reads reached plus the
// window it pages next, so the skeleton the page draws is the rows that land on it.
test('the window the directory is about to read is reserved whole, as its skeleton', () => {
  const known = DIRECTORY_PAGE_SIZE * 2;
  const rows = streamKnownRows(known, true, DIRECTORY_PAGE_SIZE);
  // The space reserved past the read rows is the arriving window itself, not one row.
  assert.equal(rows - known, DIRECTORY_PAGE_SIZE);
  const chunkCount = streamChunkCount(rows, STREAM_CHUNK_ROWS);
  const windows = new Map<number, readonly ReturnType<typeof entry>[]>();
  for (let offset = 0; offset < known; offset += DIRECTORY_PAGE_SIZE)
    windows.set(
      offset,
      Array.from({ length: DIRECTORY_PAGE_SIZE }, (_, index) =>
        entry(offset + index),
      ),
    );
  const skeletons = new Map<number, number>();
  for (let index = 0; index < chunkCount; index++) {
    const start = index * STREAM_CHUNK_ROWS;
    if (
      streamChunkRows(
        windows,
        start,
        STREAM_CHUNK_ROWS,
        DIRECTORY_PAGE_SIZE,
        rows,
      ) !== null
    )
      continue;
    // The count the page passes: the rows this chunk draws once its window arrives.
    skeletons.set(
      index,
      Math.min(STREAM_CHUNK_ROWS, Math.max(0, rows - start)),
    );
  }
  // A window in flight is a skeleton per chunk it fills, not one row of it.
  assert.ok(skeletons.size > 1, `${skeletons.size} reserved chunks`);
  // The window arrives: every skeleton is replaced by exactly the rows it stood for.
  windows.set(
    known,
    Array.from({ length: DIRECTORY_PAGE_SIZE }, (_, index) =>
      entry(known + index),
    ),
  );
  for (const [index, count] of skeletons)
    assert.equal(
      streamChunkRows(
        windows,
        index * STREAM_CHUNK_ROWS,
        STREAM_CHUNK_ROWS,
        DIRECTORY_PAGE_SIZE,
        rows,
      )?.length,
      count,
      `chunk ${index} lands on its reservation`,
    );
});
