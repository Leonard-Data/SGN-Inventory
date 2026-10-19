// A list read as one stream of everything its filters match, rather than pages of it. The page
// address carries the search, the ordering and the filters - never a page number and never a
// window offset. The browser reads the stream as consecutive windows of a stated length, reserves
// the whole stream's estimated height from the total the read states (or from the rows it has
// reached when the read pages by cursor and states none), and keeps only the rows near the
// viewport in the page.
//
// Everything here is arithmetic over numbers the browser measured, so the band a page mounts and
// the windows it needs are testable without a browser. It is shared by every streamed list: the
// row shape and the read behind each window belong to the feature, the geometry does not.
// Rows per read. The database clamps a window to at most 200 and defaults to the same hundred.
// A list whose read pages in shorter windows states its own length instead.
export const STREAM_PAGE_SIZE = 100;

// Rows per mounted chunk. A chunk is the unit the page renders or replaces with reserved space:
// small enough that the mounted band stays near the viewport, large enough that one measurement
// covers many rows.
export const STREAM_CHUNK_ROWS = 12;

// Space above and below the viewport whose rows are still mounted, so a fast scroll meets
// rendered rows instead of a gap.
export const STREAM_OVERSCAN_PX = 800;

// Windows kept in memory around the band. Scrolling the whole stream never holds all of it.
export const STREAM_WINDOWS_KEPT = 16;

// A chunk's height before the browser has measured one. Only the starting point: the first
// measurement replaces it, and the average of the measurements stands in for the rest.
export const STREAM_ESTIMATE_PX = 640;

// A window offset is a row position in the stream: a plain non-negative integer. A mangled,
// negative or decimal value is refused rather than read as a different window than the caller
// asked for, and an absent or empty value is the first window.
const STREAM_OFFSET = /^(?:0|[1-9]\d{0,8})$/;

export type StreamOffsetParse = { ok: true; offset: number } | { ok: false };

export function parseStreamOffset(params: URLSearchParams): StreamOffsetParse {
  const raw = params.get('offset');
  if (raw === null || raw === '') return { ok: true, offset: 0 };
  return STREAM_OFFSET.test(raw)
    ? { ok: true, offset: Number(raw) }
    : { ok: false };
}

// The address of one window of that read: the caller's own search, ordering and filters with the
// row offset of the window it wants. The offset is the stream's own parameter and replaces any
// value the caller's address carried, so a window is always named once, by this read.
export function streamWindowUrl(endpoint: string, offset: number): string {
  const separator = endpoint.indexOf('?');
  const path = separator === -1 ? endpoint : endpoint.slice(0, separator);
  const params = new URLSearchParams(
    separator === -1 ? '' : endpoint.slice(separator + 1),
  );
  params.set('offset', String(offset));
  return `${path}?${params}`;
}

// The address of one window of a read that pages by cursor: the caller's own search and filters
// with the cursor of the window it wants. The first window states no cursor.
export function cursorWindowUrl(endpoint: string, cursor: string): string {
  const separator = endpoint.indexOf('?');
  const path = separator === -1 ? endpoint : endpoint.slice(0, separator);
  const params = new URLSearchParams(
    separator === -1 ? '' : endpoint.slice(separator + 1),
  );
  params.set('after', cursor);
  return `${path}?${params}`;
}

// Every window is a slice of the same total order, so the window a row position belongs to is
// that position rounded down to the read length.
export function streamWindowStart(
  offset: number,
  pageSize = STREAM_PAGE_SIZE,
): number {
  return Math.floor(Math.max(0, offset) / pageSize) * pageSize;
}

// The stream holds one chunk per chunk-full of matching rows; the last one may be partial.
export function streamChunkCount(
  total: number,
  chunkRows = STREAM_CHUNK_ROWS,
): number {
  return total > 0 ? Math.ceil(total / chunkRows) : 0;
}

// The rows a stream can account for when its read pages by cursor and states no total: the rows
// it has reached, plus one row standing for the next window while a further one exists. The
// arithmetic then counts the chunk that window will fill, so the stream reserves the space the
// rows about to arrive land on instead of growing a jump later.
export function streamKnownRows(known: number, more: boolean): number {
  return Math.max(0, known) + (more ? 1 : 0);
}

// The height of every chunk: what the browser measured, the average of what it measured for the
// chunks it has not reached, and the estimate before any measurement. A chunk is never reserved
// at zero height, which would collapse the stream's scroll height onto one point.
export function streamChunkHeights(
  measured: ReadonlyMap<number, number>,
  chunkCount: number,
  estimate = STREAM_ESTIMATE_PX,
): number[] {
  const known = [...measured.entries()]
    .filter(([index, height]) => index < chunkCount && height > 0)
    .map(([, height]) => height);
  const fallback = known.length
    ? known.reduce((sum, height) => sum + height, 0) / known.length
    : estimate;
  return Array.from({ length: chunkCount }, (_, index) => {
    const height = measured.get(index);
    return height !== undefined && height > 0 ? height : fallback;
  });
}

// Where each chunk starts and where the stream ends: offsets[i] is the top of chunk i, and
// offsets[chunkCount] is the reserved end of the stream.
export function streamOffsets(heights: readonly number[]): number[] {
  const offsets = [0];
  for (const height of heights)
    offsets.push(offsets[offsets.length - 1]! + height);
  return offsets;
}

export type StreamBand = {
  // The chunks whose rows stay mounted, inclusive. `last` is -1 for an empty stream.
  first: number;
  last: number;
  // Space reserved above the first mounted chunk and below the last one, so the stream keeps its
  // whole scroll height while only this band exists in the page.
  top: number;
  bottom: number;
};

// The band of chunks to mount for a scroll position: every chunk the viewport and its overscan
// touch, plus the space that stands in for the rest of the stream.
export function streamBand({
  chunkCount,
  offsets,
  scrollTop,
  viewportHeight,
  overscan = STREAM_OVERSCAN_PX,
}: {
  chunkCount: number;
  offsets: readonly number[];
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
}): StreamBand {
  if (chunkCount <= 0) return { first: 0, last: -1, top: 0, bottom: 0 };
  const end = offsets[chunkCount]!;
  const from = Math.max(0, Math.min(scrollTop - overscan, end));
  const to = Math.max(0, Math.min(scrollTop + viewportHeight + overscan, end));
  const first = chunkAt(offsets, chunkCount, from);
  const last = Math.max(first, chunkAt(offsets, chunkCount, to));
  return {
    first,
    last,
    top: offsets[first]!,
    bottom: end - offsets[last + 1]!,
  };
}

// The windows the band needs: every window that holds a row the band would show, clamped to the
// rows the stream actually has. A band deep in the stream needs the window that holds it, not
// every window the person scrolled past.
export function streamWindows({
  first,
  last,
  total,
  chunkRows = STREAM_CHUNK_ROWS,
  pageSize = STREAM_PAGE_SIZE,
}: {
  first: number;
  last: number;
  total: number;
  chunkRows?: number;
  pageSize?: number;
}): number[] {
  if (last < first || total <= 0) return [];
  const from = Math.min(Math.max(0, first) * chunkRows, total);
  const to = Math.min((last + 1) * chunkRows, total);
  const windows: number[] = [];
  for (
    let offset = streamWindowStart(from, pageSize);
    offset < to;
    offset += pageSize
  )
    windows.push(offset);
  return windows;
}

// Which stored windows to keep: every window the band needs, then the nearest others, so a
// stream scrolled end to end never holds more than `keep` of them in the page.
export function retainedWindows({
  stored,
  needed,
  position,
  keep = STREAM_WINDOWS_KEPT,
}: {
  stored: readonly number[];
  needed: readonly number[];
  position: number;
  keep?: number;
}): number[] {
  const keepSet = new Set(needed);
  const others = stored
    .filter((window) => !keepSet.has(window))
    .sort(
      (left, right) =>
        Math.abs(left - position) - Math.abs(right - position) || left - right,
    );
  for (const window of others) {
    if (keepSet.size >= keep) break;
    keepSet.add(window);
  }
  return [...keepSet].sort((left, right) => left - right);
}

// The kept windows a publication can draw: only the offsets whose rows have actually been read.
// A window the band needs but whose read is still in flight stays out of the page, so the set
// published before a read settles differs from the set published after it, and the arriving rows
// are drawn. Naming an unread window as published instead would make the stream skip it.
export function loadedWindows<T>(
  kept: readonly number[],
  stored: ReadonlyMap<number, readonly T[]>,
): number[] {
  return kept.filter((offset) => stored.has(offset));
}

// The rows of one chunk as the windows on hand hold them. null means a window this chunk needs
// has not been read yet, so the chunk reserves its space instead of drawing a partial set; a
// window that has run out ends the chunk early, which is the stream's own end.
export function streamChunkRows<T>(
  windows: ReadonlyMap<number, readonly T[]>,
  start: number,
  chunkRows = STREAM_CHUNK_ROWS,
  pageSize = STREAM_PAGE_SIZE,
): T[] | null {
  const rows: T[] = [];
  for (
    let position = Math.max(0, start);
    position < start + chunkRows;
    position++
  ) {
    const windowOffset = streamWindowStart(position, pageSize);
    const window = windows.get(windowOffset);
    if (!window) return null;
    const row = window[position - windowOffset];
    if (row === undefined) break;
    rows.push(row);
  }
  return rows;
}

// The last chunk whose top is at or above a position: the chunk a position falls in.
function chunkAt(
  offsets: readonly number[],
  chunkCount: number,
  position: number,
): number {
  let low = 0;
  let high = chunkCount - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (offsets[middle]! <= position) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}
