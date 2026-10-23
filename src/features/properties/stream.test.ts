import assert from 'node:assert/strict';
import test from 'node:test';
import {
  columnOrder,
  INVENTORY_SORT_FIELDS,
  isInventoryOrder,
  loadedWindows,
  nextColumnOrder,
  parseStreamOffset,
  retainedWindows,
  reversedOrder,
  STREAM_CHUNK_ROWS,
  STREAM_ESTIMATE_PX,
  STREAM_OVERSCAN_PX,
  STREAM_PAGE_SIZE,
  streamBand,
  streamChunkCount,
  streamChunkHeights,
  streamChunkRows,
  streamOffsets,
  streamWindowStart,
  streamWindowUrl,
  streamWindows,
} from './stream.ts';

// The imported inventory the captain's brief names, so the arithmetic is exercised over a set
// far larger than anything the page ever holds at once.
const LARGE_SET = 18_801;
const VIEWPORT = 900;
// A uniform measured height is the table's steady state: one row is about this tall, so a chunk
// of twelve is about twelve times it.
const ROW_PX = 52;
const measuredTable = (chunks: number) =>
  new Map(
    Array.from({ length: chunks }, (_, index) => [
      index,
      ROW_PX * STREAM_CHUNK_ROWS,
    ]),
  );
const largeSetOffsets = () =>
  streamOffsets(
    streamChunkHeights(
      measuredTable(streamChunkCount(LARGE_SET)),
      streamChunkCount(LARGE_SET),
    ),
  );

const offset = (values: Record<string, string>) =>
  parseStreamOffset(new URLSearchParams(values));

test('an absent window offset is the first window and a mangled one is refused', () => {
  assert.deepEqual(offset({}), { ok: true, offset: 0 });
  assert.deepEqual(offset({ offset: '0' }), { ok: true, offset: 0 });
  assert.deepEqual(offset({ offset: '1400' }), { ok: true, offset: 1400 });
  // An empty value is no value, exactly as an empty filter is no filter.
  assert.deepEqual(offset({ offset: '' }), { ok: true, offset: 0 });
  for (const value of [
    '-100',
    '1.5',
    'two',
    '+100',
    ' 100',
    '100 ',
    '0100',
    '1e3',
    '9999999999',
  ])
    assert.deepEqual(
      offset({ offset: value }),
      { ok: false },
      `offset=${value}`,
    );
});

test('one window of the read is the caller’s address plus that window’s own offset', () => {
  assert.equal(
    streamWindowUrl('/api/properties?query=le+loi&sort=newest&offset=0', 1400),
    '/api/properties?query=le+loi&sort=newest&offset=1400',
  );
  assert.equal(
    streamWindowUrl('/api/properties', 100),
    '/api/properties?offset=100',
  );
  // A window is never named twice: the offset this read asks for is the one it fetches.
  assert.equal(
    streamWindowUrl('/api/properties?query=&offset=99&status=available', 200),
    '/api/properties?query=&offset=200&status=available',
  );
});

test('every window starts on a page boundary of the same total order', () => {
  assert.equal(streamWindowStart(0), 0);
  assert.equal(streamWindowStart(99), 0);
  assert.equal(streamWindowStart(100), 100);
  assert.equal(streamWindowStart(1410), 1400);
  assert.equal(streamWindowStart(0, 5), 0);
  assert.equal(streamWindowStart(7, 5), 5);
});

test('the stream holds one chunk per chunk-full of matching rows', () => {
  assert.equal(streamChunkCount(0), 0);
  assert.equal(streamChunkCount(1), 1);
  assert.equal(streamChunkCount(STREAM_CHUNK_ROWS), 1);
  assert.equal(streamChunkCount(STREAM_CHUNK_ROWS + 1), 2);
  assert.equal(
    streamChunkCount(LARGE_SET),
    Math.ceil(LARGE_SET / STREAM_CHUNK_ROWS),
  );
});

test('an unmeasured chunk is reserved at the estimate and then at the measured average', () => {
  const empty = streamChunkHeights(new Map(), 3);
  assert.deepEqual(empty, [
    STREAM_ESTIMATE_PX,
    STREAM_ESTIMATE_PX,
    STREAM_ESTIMATE_PX,
  ]);
  // A zero-height measurement cannot collapse the stream: it is not a measurement.
  const partial = streamChunkHeights(
    new Map([
      [1, 600],
      [2, 0],
    ]),
    3,
  );
  assert.deepEqual(partial, [600, 600, 600]);
  const measured = streamChunkHeights(
    new Map([
      [0, 500],
      [2, 700],
    ]),
    4,
  );
  assert.deepEqual(measured, [500, 600, 700, 600]);
});

test('the stream offsets stack the chunk heights and end at the reserved height', () => {
  assert.deepEqual(streamOffsets([10, 20, 30]), [0, 10, 30, 60]);
  assert.deepEqual(streamOffsets([]), [0]);
});

test('the band at the start of a large set mounts the first chunks and reserves above nothing', () => {
  const chunkCount = streamChunkCount(LARGE_SET);
  const offsets = largeSetOffsets();
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop: 0,
    viewportHeight: VIEWPORT,
  });
  assert.equal(band.first, 0);
  assert.equal(band.top, 0);
  // The mounted band is the viewport plus its overscan, never the whole stream.
  const mounted = offsets[band.last + 1]! - offsets[band.first]!;
  assert.ok(
    mounted >= VIEWPORT &&
      mounted <= VIEWPORT + 2 * STREAM_OVERSCAN_PX + ROW_PX * STREAM_CHUNK_ROWS,
  );
  assert.equal(band.bottom, offsets[chunkCount]! - offsets[band.last + 1]!);
  // The reserved space plus the mounted chunks is the whole stream, so the scrollbar never
  // changes height as rows arrive.
  assert.equal(band.top + mounted + band.bottom, offsets[chunkCount]);
});

test('the band in the middle of a large set follows the scroll position exactly', () => {
  const chunkCount = streamChunkCount(LARGE_SET);
  const offsets = largeSetOffsets();
  const row = 9_400;
  const scrollTop = row * ROW_PX;
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop,
    viewportHeight: VIEWPORT,
  });
  const firstRow = band.first * STREAM_CHUNK_ROWS;
  const lastRow = (band.last + 1) * STREAM_CHUNK_ROWS;
  assert.ok(
    firstRow * ROW_PX >=
      scrollTop - STREAM_OVERSCAN_PX - ROW_PX * STREAM_CHUNK_ROWS,
  );
  assert.ok(firstRow * ROW_PX <= scrollTop);
  assert.ok(lastRow * ROW_PX >= scrollTop + VIEWPORT);
  assert.ok(
    lastRow - firstRow <=
      (VIEWPORT + 2 * STREAM_OVERSCAN_PX) / ROW_PX + 2 * STREAM_CHUNK_ROWS,
  );
  // Deep in the stream the needed windows are the ones under the band, not every window the
  // person scrolled past: the band's rows span at most two reads.
  assert.deepEqual(
    streamWindows({ first: band.first, last: band.last, total: LARGE_SET }),
    [streamWindowStart(firstRow), streamWindowStart(lastRow - 1)],
  );
});

test('the band at the end of a large set stops on the last chunk and reserves below nothing', () => {
  const chunkCount = streamChunkCount(LARGE_SET);
  const offsets = largeSetOffsets();
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop: offsets[chunkCount]!,
    viewportHeight: VIEWPORT,
  });
  assert.equal(band.last, chunkCount - 1);
  assert.equal(band.bottom, 0);
  assert.ok(band.first < chunkCount);
  const windows = streamWindows({
    first: band.first,
    last: band.last,
    total: LARGE_SET,
  });
  // The band straddles the read boundary and never asks for a window that holds no mounted row.
  assert.deepEqual(windows, [18_700, 18_800]);
  // The stream's last row is in a window the band needs.
  assert.ok(windows.includes(streamWindowStart(LARGE_SET - 1)));
  // A band that fits inside one read asks for exactly that read, however deep it sits.
  assert.deepEqual(
    streamWindows({ first: 1566, last: 1566, total: 18_800 }),
    [18_700],
  );
});

test('an empty stream has no band and needs no window', () => {
  const band = streamBand({
    chunkCount: 0,
    offsets: [0],
    scrollTop: 0,
    viewportHeight: VIEWPORT,
  });
  assert.deepEqual(band, { first: 0, last: -1, top: 0, bottom: 0 });
  assert.deepEqual(streamWindows({ first: 0, last: -1, total: 0 }), []);
});

test('a small set still needs exactly the windows that hold the mounted rows', () => {
  // Two hundred and fifty rows: three windows, and a band that spans a window boundary needs
  // both of them rather than one read per row group.
  const total = 250;
  const chunkCount = streamChunkCount(total);
  const offsets = streamOffsets(
    streamChunkHeights(measuredTable(chunkCount), chunkCount),
  );
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop: 96 * ROW_PX,
    viewportHeight: VIEWPORT,
  });
  assert.deepEqual(
    streamWindows({ first: band.first, last: band.last, total }),
    [0, 100],
  );
  const end = streamBand({
    chunkCount,
    offsets,
    scrollTop: offsets[chunkCount]!,
    viewportHeight: VIEWPORT,
  });
  const lastWindow = streamWindows({ first: end.first, last: end.last, total });
  assert.equal(lastWindow.at(-1), 200);
  // A window never runs past the last row of the set.
  assert.ok(lastWindow.every((window) => window < total));
});

test('the kept windows are the band’s own and the nearest others', () => {
  const stored = [0, 100, 200, 300, 400, 500, 600, 700];
  const needed = [600, 700];
  assert.deepEqual(
    retainedWindows({ stored, needed, position: 650, keep: 4 }),
    [400, 500, 600, 700],
  );
  // A window the band needs is never dropped, however many the band needs.
  assert.deepEqual(
    retainedWindows({ stored, needed: [0, 100], position: 700, keep: 1 }),
    [0, 100],
  );
  // Windows that are already stored and still wanted are not re-read: the result names what to
  // keep, and the caller keeps exactly that.
  assert.deepEqual(
    retainedWindows({ stored: [100], needed: [], position: 0, keep: 16 }),
    [100],
  );
});

test('the two entry orderings and every sortable column are accepted, and nothing else', () => {
  assert.equal(isInventoryOrder('oldest'), true);
  assert.equal(isInventoryOrder('newest'), true);
  for (const field of INVENTORY_SORT_FIELDS)
    for (const direction of ['asc', 'desc'])
      assert.equal(isInventoryOrder(`${field}-${direction}`), true);
  // A column ordering this table does not offer, a direction that is not one of the two, and a
  // value in another case are refused rather than read as a different order.
  for (const value of [
    '',
    'asc',
    'desc',
    'OLDEST',
    'floors-asc',
    'creator-desc',
    'price',
    'price-ascending',
    'price-ASC',
    'price-asc ',
    ' price-asc',
    '-asc',
    null,
    undefined,
  ])
    assert.equal(isInventoryOrder(value), false, `order=${String(value)}`);
});

test('a stated order names its column and direction, or no column at all', () => {
  assert.deepEqual(columnOrder('price-asc'), {
    field: 'price',
    direction: 'asc',
  });
  assert.deepEqual(columnOrder('changed-desc'), {
    field: 'changed',
    direction: 'desc',
  });
  // The entry chronology and an absent order are the default-order states, not a column sort.
  for (const value of ['oldest', 'newest', null, '', 'floors-asc'])
    assert.equal(columnOrder(value), null);
});

test('a header click cycles ascending, descending and back to the default order', () => {
  assert.equal(nextColumnOrder(null, 'price'), 'price-asc');
  assert.equal(nextColumnOrder('price-asc', 'price'), 'price-desc');
  assert.equal(nextColumnOrder('price-desc', 'price'), null);
  // Another column starts over at ascending, and the entry chronology does too.
  assert.equal(nextColumnOrder('area-desc', 'price'), 'price-asc');
  assert.equal(nextColumnOrder('oldest', 'status'), 'status-asc');
});

test('the direction toggle reverses only an active entry-date ordering', () => {
  assert.equal(reversedOrder(null), null);
  assert.equal(reversedOrder('oldest'), 'newest');
  assert.equal(reversedOrder('newest'), 'oldest');
  // A column sorts in the direction its own order states, so there is nothing to reverse.
  assert.equal(reversedOrder('price-asc'), null);
  assert.equal(reversedOrder('changed-desc'), null);
});

test('the read length is the hundred rows the captain settled on', () => {
  assert.equal(STREAM_PAGE_SIZE, 100);
});

test('a chunk that crosses a read boundary takes its rows from both windows', () => {
  const windows = new Map<number, readonly string[]>([
    [0, Array.from({ length: STREAM_PAGE_SIZE }, (_, index) => `row-${index}`)],
    [
      STREAM_PAGE_SIZE,
      Array.from(
        { length: STREAM_PAGE_SIZE },
        (_, index) => `row-${STREAM_PAGE_SIZE + index}`,
      ),
    ],
  ]);
  const crossing = streamChunkRows(windows, 96);
  assert.equal(crossing?.length, STREAM_CHUNK_ROWS);
  assert.equal(crossing?.[0], 'row-96');
  assert.equal(crossing?.[3], 'row-99');
  assert.equal(crossing?.[4], 'row-100');
  assert.equal(crossing?.[11], 'row-107');
  // A window this chunk needs that has not been read yet reserves its space — null, never a
  // partial chunk that would draw a shorter list than the stream really has.
  assert.equal(streamChunkRows(windows, 200), null);
});

test('only loaded windows are drawn, so a window arriving later still republishes', () => {
  const cache = new Map<number, readonly string[]>([
    [0, ['a', 'b']],
    [100, ['c', 'd']],
  ]);
  // The band has scrolled to window 300 and window 100 is still stored, but 300 has not been read
  // yet: only 0 and 100 can be drawn, so 300 is not published ahead of its rows.
  const kept = retainedWindows({
    stored: [...cache.keys()],
    needed: [300],
    position: 300,
    keep: 4,
  });
  assert.deepEqual(kept, [0, 100, 300]);
  assert.deepEqual(loadedWindows(kept, cache), [0, 100]);
  // The read settles: the same plan now draws 300, so the published set changes and the page
  // redraws. A plan published as though it were drawn would compare equal and never republish.
  cache.set(300, ['e', 'f']);
  assert.deepEqual(loadedWindows(kept, cache), [0, 100, 300]);
});

test('a window that runs out ends the chunk at the stream’s own end', () => {
  const tail = new Map<number, readonly string[]>([
    [100, ['row-100', 'row-101', 'row-102']],
  ]);
  // Positions before the stored window need a window that was never read.
  assert.equal(streamChunkRows(tail, 96), null);
  // A chunk that starts inside the stored window ends after its last row.
  assert.deepEqual(streamChunkRows(tail, 100), [
    'row-100',
    'row-101',
    'row-102',
  ]);
  // A chunk past the last row is an empty chunk, not a missing one.
  assert.deepEqual(streamChunkRows(tail, 103), []);
});

test('a card chunk asks for its own count of rows from the same windows', () => {
  const windows = new Map<number, readonly string[]>([
    [0, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']],
  ]);
  // Nine cards is three grid rows of three columns: exactly one chunk, one read.
  assert.deepEqual(streamChunkRows(windows, 0, 9), [
    'a',
    'b',
    'c',
    'd',
    'e',
    'f',
    'g',
    'h',
    'i',
  ]);
  // The second chunk starts after those nine; the window has run out, so it is empty.
  assert.deepEqual(streamChunkRows(windows, 9, 9), []);
});
