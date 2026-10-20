import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  cursorWindowUrl,
  STREAM_CHUNK_ROWS,
  STREAM_OVERSCAN_PX,
  streamBand,
  streamChunkCount,
  streamChunkHeights,
  streamChunkRows,
  streamKnownRows,
  streamOffsets,
  streamWindows,
  streamWindowStart,
} from './window.ts';

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

// The page length of a read that pages by cursor: the employee and contact directories read
// thirty rows a window, which is shorter than the properties read.
const PAGE = 30;
const CHUNK = STREAM_CHUNK_ROWS;
const VIEWPORT = 900;
const ROW_PX = 72;

test('a stream that states its end ends its last chunk there, not at a read boundary', () => {
  // Four hundred rows in windows of a hundred: the last chunk starts at row 396 and runs four rows.
  const windows = new Map<number, readonly string[]>(
    [0, 100, 200, 300].map((offset) => [
      offset,
      Array.from({ length: 100 }, (_, index) => `row-${offset + index}`),
    ]),
  );
  const total = 400;
  // The chunk asks for a window past the stream's end for its last four positions: told where
  // the stream ends, it draws the four rows it has instead of reserving the whole chunk.
  assert.equal(windows.has(400), false);
  assert.deepEqual(
    streamChunkRows(windows, 396, STREAM_CHUNK_ROWS, 100, total),
    ['row-396', 'row-397', 'row-398', 'row-399'],
  );
  // Without being told, the same chunk is the reservation it would be for a window not yet read.
  assert.equal(streamChunkRows(windows, 396, STREAM_CHUNK_ROWS, 100), null);
  // A chunk that starts past the end holds nothing, and one that ends before it is unaffected.
  assert.deepEqual(
    streamChunkRows(windows, 400, STREAM_CHUNK_ROWS, 100, total),
    [],
  );
  assert.equal(
    streamChunkRows(windows, 384, STREAM_CHUNK_ROWS, 100, total)?.length,
    12,
  );
});

test('the properties list reads the shared arithmetic rather than a copy of it', () => {
  // The extraction is only an extraction if the original module keeps handing out the same
  // functions: the properties tests import them from here, unchanged.
  assert.match(
    source('../properties/stream.ts'),
    /export \* from '\.\.\/stream\/window\.ts'/,
  );
  for (const path of [
    './window.ts',
    '../stream/use-windows.ts',
    '../properties/use-inventory-stream.ts',
  ])
    assert.ok(source(path).length > 0, path);
});

test('a cursor read accounts for the rows it reached plus the window it is about to read', () => {
  assert.equal(streamKnownRows(0, false, PAGE), 0);
  // While a further window exists, the read length the caller pages with is reserved, so every
  // chunk that window will fill is counted and stands in for the rows that land on it.
  assert.equal(streamKnownRows(0, true, PAGE), PAGE);
  assert.equal(streamKnownRows(PAGE, true, PAGE), PAGE * 2);
  assert.equal(streamKnownRows(PAGE * 4, false, PAGE), PAGE * 4);
  // A caller that states no read length still reserves the one chunk its next row falls in.
  assert.equal(streamKnownRows(0, true), 1);
  // A raise never shortens the stream, and a negative reach is refused rather than reserved.
  assert.equal(streamKnownRows(-4, false, PAGE), 0);
});

test('a stream that pages by cursor counts every chunk the next window fills', () => {
  // Two full windows: rows 0..59 are here and the read has another window to give.
  const known = PAGE * 2;
  assert.equal(streamChunkCount(known), 5);
  // The window about to arrive is thirty rows: the chunks it fills are reserved, not just the one
  // the next row falls in, so the skeleton is the size of the rows that land on them.
  assert.equal(streamChunkCount(streamKnownRows(known, true, PAGE)), 8);
  assert.equal(streamKnownRows(known, true, PAGE) - known, PAGE);
  // Rows 0..47 fill four chunks exactly, so without the next window the fifth chunk would not be
  // reserved at all and the arriving rows would push the page down.
  const aligned = CHUNK * 4;
  assert.equal(streamChunkCount(aligned), 4);
  assert.equal(streamChunkCount(streamKnownRows(aligned, true, PAGE)), 7);
  assert.equal(streamChunkCount(streamKnownRows(aligned, true)), 5);
  // At the end of the stream the rows themselves are the whole account.
  assert.equal(streamChunkCount(streamKnownRows(aligned, false, PAGE)), 4);
});

test('a window in flight is a skeleton the size of the rows that land on it', () => {
  const known = PAGE * 3;
  const rows = streamKnownRows(known, true, PAGE);
  const chunkCount = streamChunkCount(rows, CHUNK);
  const windows = new Map<number, readonly string[]>(
    Array.from({ length: known / PAGE }, (_, window) => [
      window * PAGE,
      Array.from(
        { length: PAGE },
        (_, index) => `row-${window * PAGE + index}`,
      ),
    ]),
  );
  // The space reserved past the rows the read reached is the window about to arrive, not one row.
  assert.equal(rows - known, PAGE);
  const skeletons = new Map<number, number>();
  for (let index = 0; index < chunkCount; index++) {
    const start = index * CHUNK;
    if (streamChunkRows(windows, start, CHUNK, PAGE, rows) !== null) {
      assert.ok(
        start + CHUNK <= known,
        `chunk ${index} is inside the read rows`,
      );
      continue;
    }
    // The count the directories pass: the rows this chunk draws once its window arrives.
    skeletons.set(index, Math.min(CHUNK, Math.max(0, rows - start)));
  }
  // Every chunk the arriving window fills is reserved, not only the one the next row falls in.
  assert.ok(skeletons.size > 1, `${skeletons.size} reserved chunks`);
  // The window arrives: each reserved chunk draws exactly the rows its skeleton stood for, so the
  // list neither looked finished while it loaded nor moved when the rows landed.
  windows.set(
    known,
    Array.from({ length: PAGE }, (_, index) => `row-${known + index}`),
  );
  for (const [index, count] of skeletons)
    assert.equal(
      streamChunkRows(windows, index * CHUNK, CHUNK, PAGE, rows)?.length,
      count,
      `chunk ${index} lands on its reservation`,
    );
});

test('scrolling to the end of the loaded rows asks for the next window, and no further', () => {
  const known = PAGE * 3;
  const rows = streamKnownRows(known, true);
  const chunkCount = streamChunkCount(rows);
  const offsets = streamOffsets(
    streamChunkHeights(
      new Map(
        Array.from({ length: chunkCount }, (_, index) => [
          index,
          ROW_PX * CHUNK,
        ]),
      ),
      chunkCount,
    ),
  );
  // The band sits on the last loaded rows: the viewport has reached the end of window 2.
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop: (known - 4) * ROW_PX,
    viewportHeight: VIEWPORT,
  });
  const needed = streamWindows({
    first: band.first,
    last: band.last,
    total: rows,
    chunkRows: CHUNK,
    pageSize: PAGE,
  });
  // The trigger is the band itself: the last chunk of the stream is the one the next window
  // fills, so its window offset is asked for without a button press.
  assert.ok(
    needed.includes(streamWindowStart(known, PAGE)),
    `window ${streamWindowStart(known, PAGE)} in ${needed.join(',')}`,
  );
  // The stream never asks for a window past the rows it can account for.
  assert.ok(needed.every((offset) => offset < rows));
  // A band well above the end needs only the windows under it: the band here spans the read
  // boundary at row 30, so it asks for that one window and not the ones below it.
  const above = streamBand({
    chunkCount,
    offsets,
    scrollTop: (CHUNK * 2 - 1) * ROW_PX,
    viewportHeight: VIEWPORT,
  });
  assert.deepEqual(
    streamWindows({
      first: above.first,
      last: above.last,
      total: rows,
      chunkRows: CHUNK,
      pageSize: PAGE,
    }),
    [0, PAGE],
  );
});

test('a chunk whose window has not been read reserves its space instead of drawing a part', () => {
  const windows = new Map<number, readonly string[]>([
    [0, Array.from({ length: PAGE }, (_, index) => `row-${index}`)],
  ]);
  // Rows 0..23 are drawn from window 0 alone.
  assert.equal(streamChunkRows(windows, 0 * CHUNK, CHUNK, PAGE)?.length, CHUNK);
  assert.equal(streamChunkRows(windows, 1 * CHUNK, CHUNK, PAGE)?.length, CHUNK);
  // Rows 24..35 straddle the read boundary: window 30 is not here, so the chunk is a reservation
  // (the skeleton) rather than half a chunk that would make the page jump when the rest arrives.
  assert.equal(streamChunkRows(windows, 2 * CHUNK, CHUNK, PAGE), null);
  // The window arrives: the same chunk now draws its whole twelve rows.
  windows.set(
    PAGE,
    Array.from({ length: PAGE }, (_, index) => `row-${PAGE + index}`),
  );
  const crossing = streamChunkRows(windows, 2 * CHUNK, CHUNK, PAGE);
  assert.equal(crossing?.length, CHUNK);
  assert.equal(crossing?.[0], `row-${2 * CHUNK}`);
  assert.equal(crossing?.[CHUNK - 1], `row-${3 * CHUNK - 1}`);
});

test('the stream keeps one scrollbar: reserved space plus mounted chunks is the whole length', () => {
  const known = PAGE * 2;
  const rows = streamKnownRows(known, true);
  const chunkCount = streamChunkCount(rows);
  const heights = streamChunkHeights(new Map(), chunkCount);
  const offsets = streamOffsets(heights);
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop: 0,
    viewportHeight: VIEWPORT,
    overscan: STREAM_OVERSCAN_PX,
  });
  assert.equal(band.first, 0);
  assert.equal(band.top, 0);
  const mounted = offsets[band.last + 1]! - offsets[band.first]!;
  assert.equal(band.top + mounted + band.bottom, offsets[chunkCount]!);
});

test('the cursor window address carries the search and the filter into every window', () => {
  assert.equal(
    cursorWindowUrl(
      '/api/contacts?query=nguyen&view=owners',
      '10000000-0000-4000-8000-000000000001',
    ),
    '/api/contacts?query=nguyen&view=owners&after=10000000-0000-4000-8000-000000000001',
  );
  // A window is never named twice: the cursor this read asks for is the one it fetches.
  assert.equal(
    cursorWindowUrl('/api/contacts?after=stale&query=a', 'cursor'),
    '/api/contacts?after=cursor&query=a',
  );
  assert.equal(
    cursorWindowUrl('/api/employees', 'cursor'),
    '/api/employees?after=cursor',
  );
});
