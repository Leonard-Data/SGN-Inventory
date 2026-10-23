'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  STREAM_ESTIMATE_PX,
  streamBand,
  streamChunkCount,
  streamChunkHeights,
  streamOffsets,
} from './window';

const NO_MEASURED: ReadonlyMap<number, number> = new Map();

export type StreamGeometry = {
  band: ReturnType<typeof streamBand>;
  // The height every chunk is reserved at: what the browser measured, the average of those, or
  // the starting estimate.
  heights: readonly number[];
  // The chunk indexes whose rows stay in the page, in order.
  mounted: number[];
  reportHeight: (index: number, height: number) => void;
};

// The geometry of a streamed list, shared by the lists that read it. The part it cannot know is
// how many rows the stream accounts for: `rows` is the total a read stated, or the rows a cursor
// read has reached plus the one standing for the window it is about to fetch.
//
// The container is returned beside the geometry rather than inside it: the geometry is read while
// the page renders, and a ref must not be.
export function useStreamLayout({
  active,
  rows,
  chunkRows,
  resultSet,
}: {
  // Whether the stream is on screen at all: nothing is measured until it is.
  active: boolean;
  rows: number;
  chunkRows: number;
  // Changes when the result set does, which relabels every chunk: measurements taken for the
  // rows of the previous set describe rows a chunk no longer holds.
  resultSet: string | null;
}): [React.RefObject<HTMLDivElement | null>, StreamGeometry] {
  const container = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 0 });
  const chunkCount = useMemo(
    () => streamChunkCount(rows, chunkRows),
    [rows, chunkRows],
  );
  const [measured, setMeasured] = useState(NO_MEASURED);
  const measuredRef = useRef(new Map<number, number>());
  const frame = useRef(0);
  const reportHeight = useCallback((index: number, height: number) => {
    if (!(height > 0) || measuredRef.current.get(index) === height) return;
    measuredRef.current.set(index, height);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setMeasured(new Map(measuredRef.current));
    });
  }, []);
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );
  // A new chunk size or a new result set relabels every chunk, so old measurements describe rows
  // the chunk no longer holds and are dropped; the mounted chunks measure themselves again.
  useEffect(() => {
    measuredRef.current = new Map();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the chunk layout changed, so previous measurements describe different rows
    setMeasured(NO_MEASURED);
  }, [chunkRows, resultSet]);
  const heights = useMemo(
    () => streamChunkHeights(measured, chunkCount),
    [measured, chunkCount],
  );
  const offsets = useMemo(() => streamOffsets(heights), [heights]);
  const band = useMemo(
    () =>
      streamBand({
        chunkCount,
        offsets,
        scrollTop: viewport.top,
        viewportHeight: viewport.height,
      }),
    [chunkCount, offsets, viewport],
  );
  const mounted = useMemo(() => {
    const indexes: number[] = [];
    for (
      let index = band.first;
      index <= Math.min(band.last, chunkCount - 1);
      index++
    )
      indexes.push(index);
    return indexes;
  }, [band.first, band.last, chunkCount]);

  useEffect(() => {
    const node = container.current;
    if (!active || !node) return;
    let pending = 0;
    const measure = () => {
      pending = 0;
      const rect = node.getBoundingClientRect();
      const top = Math.max(0, -rect.top);
      const height = window.innerHeight;
      setViewport((current) =>
        current.top === top && current.height === height
          ? current
          : { top, height },
      );
    };
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    return () => {
      if (pending) cancelAnimationFrame(pending);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [active]);

  return [container, { band, heights, mounted, reportHeight }];
}

// The height a chunk is reserved at before it has been measured: its measured height, or the
// stream's average, or the starting estimate.
export function chunkReservation(
  heights: readonly number[],
  index: number,
): number {
  return heights[index] ?? STREAM_ESTIMATE_PX;
}
