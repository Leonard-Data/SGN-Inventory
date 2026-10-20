import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTACT_PAGE_SIZE } from './directory.ts';
import { ContactWindowError, contactWindow } from './window.ts';
import {
  cursorWindowUrl,
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

const contact = '10000000-0000-4000-8000-000000000001';
const revision = '90000000-0000-4000-8000-000000000001';

// The projected shape the route states: the row the stream parses, not the database row.
function row(index: number) {
  const links = Array.from({ length: index % 3 }, (_, position) => ({
    propertyId: `${String(position + 1).padStart(8, '0')}-0000-4000-8000-000000000000`,
    propertyCode: `SGN-${1000 + position}`,
    relation: position === 0 ? 'owner' : 'broker',
    isPrimary: position === 0,
    archived: position === 1,
  }));
  return {
    id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000000`,
    displayName: `Người liên hệ ${index}`,
    contactType: 'owner',
    phones: ['0900 000 000'],
    rawPhoneText: null,
    revision,
    links,
  };
}

const page = (count: number, nextCursor: string | null) => ({
  contacts: Array.from({ length: count }, (_, index) => row(index)),
  nextCursor,
});

test('a window of the contact read states its contacts, the phone and the cursor after them', () => {
  const second = contactWindow(page(CONTACT_PAGE_SIZE, contact));
  assert.equal(second.rows.length, CONTACT_PAGE_SIZE);
  assert.equal(second.next, contact);
  // The recorded phone stays exactly as the read stated it: the row shows what was recorded.
  assert.deepEqual(second.rows[0]?.phones, ['0900 000 000']);
  // The linked-property count is the unarchived links of this very row, never a separate tally.
  assert.equal(second.rows[5]?.links.length, 2);
  assert.equal(second.rows[5]?.propertyCount, 1);
  // A row with no link at all counts nothing.
  assert.equal(second.rows[0]?.propertyCount, 0);
  assert.equal(contactWindow(page(0, null)).next, null);
  assert.equal(contactWindow(page(4, null)).rows.length, 4);
});

test('a payload this page cannot place, or a malformed contact, is a failed read', () => {
  for (const payload of [
    null,
    {},
    { contacts: false, nextCursor: null },
    { contacts: [], nextCursor: 1 },
    { contacts: [{ ...row(1), id: 'not-a-uuid' }], nextCursor: null },
    { contacts: [{ ...row(1), phones: 'all of them' }], nextCursor: null },
    { contacts: [{ ...row(1), displayName: 7 }], nextCursor: null },
    {
      contacts: [{ ...row(1), links: [{ relation: 'owner' }] }],
      nextCursor: null,
    },
  ])
    assert.throws(
      () => contactWindow(payload),
      ContactWindowError,
      JSON.stringify(payload),
    );
});

test('the search and the owners filter name every window of the stream', () => {
  const endpoint = '/api/contacts?query=nguyen&view=owners';
  // The first window is the read itself; every later one carries the same search and filter with
  // the cursor the previous window handed out, so a filter never applies to only one window.
  assert.equal(
    cursorWindowUrl(endpoint, contact),
    '/api/contacts?query=nguyen&view=owners&after=' + contact,
  );
});

// The contact directory's own geometry, at the read length its endpoint pages with.
const VIEWPORT = 900;
const ROW_PX = 88;
const ROW_TEXT = 'Người liên hệ';
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

test('scrolling near the end of the loaded contacts asks for the next window', () => {
  const known = CONTACT_PAGE_SIZE * 4;
  const rows = streamKnownRows(known, true, CONTACT_PAGE_SIZE);
  const { chunkCount, offsets } = offsetsFor(rows);
  const band = streamBand({
    chunkCount,
    offsets,
    scrollTop: (known - 2) * ROW_PX,
    viewportHeight: VIEWPORT,
  });
  const needed = streamWindows({
    first: band.first,
    last: band.last,
    total: rows,
    chunkRows: STREAM_CHUNK_ROWS,
    pageSize: CONTACT_PAGE_SIZE,
  });
  assert.deepEqual(needed, [
    streamWindowStart(known - 2, CONTACT_PAGE_SIZE),
    known,
  ]);
  assert.ok(needed.every((offset) => offset < rows));
});

test('only the rows near the viewport are in the page, however deep the stream goes', () => {
  const known = CONTACT_PAGE_SIZE * 40;
  const rows = streamKnownRows(known, true, CONTACT_PAGE_SIZE);
  const { chunkCount, offsets } = offsetsFor(rows);
  const windows = new Map<number, string[]>();
  for (let offset = 0; offset < known; offset += CONTACT_PAGE_SIZE)
    windows.set(
      offset,
      Array.from(
        { length: CONTACT_PAGE_SIZE },
        (_, index) => `${ROW_TEXT} ${offset + index}`,
      ),
    );
  for (const row of [0, 12 * 7, known - 4]) {
    const band = streamBand({
      chunkCount,
      offsets,
      scrollTop: row * ROW_PX,
      viewportHeight: VIEWPORT,
    });
    const mounted: string[] = [];
    let reserved = 0;
    for (let index = band.first; index <= band.last; index++) {
      const start = index * STREAM_CHUNK_ROWS;
      const chunk = streamChunkRows(
        windows,
        start,
        STREAM_CHUNK_ROWS,
        CONTACT_PAGE_SIZE,
      );
      // The chunks the window in flight fills stand for it as reservations instead of drawing a
      // part of themselves: they are the skeletons, and there is more than the one straddling the
      // last loaded row, because the whole arriving window is reserved.
      if (chunk === null) {
        assert.ok(
          start + STREAM_CHUNK_ROWS > known,
          `chunk ${index} touches the window in flight`,
        );
        reserved++;
        continue;
      }
      assert.ok(
        start + STREAM_CHUNK_ROWS <= known + CONTACT_PAGE_SIZE,
        `chunk ${index} is inside the read rows`,
      );
      mounted.push(...chunk);
    }
    // The band holds the viewport and its overscan, never the rows above or below it.
    assert.ok(mounted.length > 0);
    assert.ok(
      mounted.length <=
        Math.ceil((VIEWPORT + 2 * 800) / ROW_PX) + 2 * STREAM_CHUNK_ROWS,
      `${mounted.length} rows mounted at row ${row}`,
    );
    // The reserved space is the rest of the stream: the band's own rows plus the chunks it leaves
    // reserved over one scroll length that also counts the window in flight.
    assert.equal(
      band.top +
        mounted.length * ROW_PX +
        reserved * ROW_PX * STREAM_CHUNK_ROWS +
        band.bottom,
      offsets[chunkCount],
    );
  }
});

// The window in flight as the contact directory reads it: the rows its reads reached plus the
// window it pages next, so the skeleton the page draws is the rows that land on it.
test('the window the directory is about to read is reserved whole, as its skeleton', () => {
  const known = CONTACT_PAGE_SIZE * 2;
  const rows = streamKnownRows(known, true, CONTACT_PAGE_SIZE);
  // The space reserved past the read rows is the arriving window itself, not one row.
  assert.equal(rows - known, CONTACT_PAGE_SIZE);
  const chunkCount = streamChunkCount(rows, STREAM_CHUNK_ROWS);
  const windows = new Map<number, readonly string[]>();
  for (let offset = 0; offset < known; offset += CONTACT_PAGE_SIZE)
    windows.set(
      offset,
      Array.from(
        { length: CONTACT_PAGE_SIZE },
        (_, index) => `${ROW_TEXT} ${offset + index}`,
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
        CONTACT_PAGE_SIZE,
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
    Array.from(
      { length: CONTACT_PAGE_SIZE },
      (_, index) => `${ROW_TEXT} ${known + index}`,
    ),
  );
  for (const [index, count] of skeletons)
    assert.equal(
      streamChunkRows(
        windows,
        index * STREAM_CHUNK_ROWS,
        STREAM_CHUNK_ROWS,
        CONTACT_PAGE_SIZE,
        rows,
      )?.length,
      count,
      `chunk ${index} lands on its reservation`,
    );
});
