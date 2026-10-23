'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RequestError } from '@/features/employees/api';
import { loadedWindows, retainedWindows, STREAM_WINDOWS_KEPT } from './window';

// One window of a streamed read as the read stated it: the rows it holds, the matching total when
// the read states one, and whether a further window exists at all.
export type StreamWindowRead<T> = {
  // The rows of the window. A window the read pages by cursor may hold fewer rows than the read
  // length; that is the window the stream ends in, not a failure.
  rows: T[];
  // The matching total the read states, or null when the read pages by cursor and states none.
  total: number | null;
  // Whether a read of a further window exists. False ends the stream.
  more: boolean;
};

// The windows of the stream the page currently holds, by the row offset each one starts at. The
// page asks for the windows its band needs; this hook reads what is missing, keeps the nearest
// windows and drops the rest, so scrolling the whole stream never holds the whole result set.
export type WindowStream<T> = {
  windows: ReadonlyMap<number, T[]>;
  // The matching total the last read stated, or null before the first read answers and for every
  // read that pages by cursor instead of stating one.
  total: number | null;
  // The furthest row the reads have reached: what a cursor read knows of the stream's length.
  loaded: number;
  // Whether a further window exists, or null before the first read answers. A cursor read has no
  // other way to know where the stream ends.
  more: boolean | null;
  // The code of the most recent failed read, cleared by the next read that succeeds.
  error: string | null;
  // What the band wants: the windows holding the rows it would show, and the row position it is
  // centred on, which decides which stored windows survive.
  request: (windows: readonly number[], position: number) => void;
  // Read the band again after its reads failed, keeping the windows already read.
  retry: () => void;
  // Read the band again after something behind it changed: the rows it holds are dropped so the
  // windows it shows are read afresh, and the windows it needs later are read when it reaches
  // them.
  refresh: () => void;
};

const NO_WINDOWS: ReadonlyMap<number, never[]> = new Map();

export function useWindowStream<T>({
  source,
  identity,
  readWindow,
  onDenied,
}: {
  // The one read this stream is a window of; null while the address or the session is not
  // usable, which reads nothing at all.
  source: string | null;
  // Changes when the session's own authority changes, so a window read under the old session
  // never fills the surface the new one is allowed to see.
  identity: string;
  // One window of the one read, at the row offset the stream asks for. The feature owns how an
  // offset becomes a request: an offset-addressed read states it, a read that pages by cursor
  // resolves it from the cursor that window was reached with.
  readWindow: (
    offset: number,
    signal: AbortSignal,
  ) => Promise<StreamWindowRead<T>>;
  onDenied: (status: number) => void;
}): WindowStream<T> {
  const [windows, setWindows] = useState<ReadonlyMap<number, T[]>>(NO_WINDOWS);
  const [total, setTotal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [more, setMore] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<number, T[]>());
  const pending = useRef(new Set<number>());
  const needed = useRef<readonly number[]>([]);
  const position = useRef(0);
  // The window offsets the page currently holds, in order. Kept beside the cache so a read that
  // changes nothing republishes nothing.
  const published = useRef<readonly number[]>([]);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const denial = useRef(onDenied);
  useEffect(() => {
    denial.current = onDenied;
  }, [onDenied]);

  // Which stored windows survive: the band's own, then its nearest neighbours. The page renders
  // exactly what this returns, so a deep scroll holds a bounded set of rows. A set the page
  // already holds is not republished: scrolling inside the stored windows must not churn the
  // page, and the rows behind each offset never change while it is stored.
  const store = useCallback(() => {
    const kept = retainedWindows({
      stored: [...cache.current.keys()],
      needed: needed.current,
      position: position.current,
      keep: STREAM_WINDOWS_KEPT,
    });
    // Only the windows whose rows are here can be drawn now. A window still being read is kept in
    // the plan but not published: when its rows arrive the published set changes and the page
    // redraws, instead of matching a set that named rows the page never had.
    const offsets = loadedWindows(kept, cache.current);
    if (
      offsets.length === published.current.length &&
      offsets.every((offset, index) => offset === published.current[index])
    )
      return;
    const next = new Map<number, T[]>();
    for (const offset of offsets) {
      const rows = cache.current.get(offset);
      if (rows) next.set(offset, rows);
    }
    cache.current = next;
    published.current = offsets;
    setWindows(next);
  }, []);

  // One window of the one read. A read that has been superseded by a new address or session
  // publishes nothing.
  const read = useCallback(
    async (offset: number, signal: AbortSignal, version: number) => {
      if (!source) return;
      pending.current.add(offset);
      try {
        const window = await readWindow(offset, signal);
        if (version !== generation.current || signal.aborted) return;
        pending.current.delete(offset);
        cache.current.set(offset, window.rows);
        setTotal(window.total);
        setMore(window.more);
        setLoaded((current) => Math.max(current, offset + window.rows.length));
        setError(null);
        store();
      } catch (problem) {
        if (version !== generation.current || signal.aborted) return;
        pending.current.delete(offset);
        if (
          problem instanceof RequestError &&
          (problem.status === 401 || problem.status === 403)
        ) {
          denial.current(problem.status);
          return;
        }
        setError(
          problem instanceof RequestError ? problem.code : 'unavailable',
        );
      }
    },
    [source, readWindow, store],
  );

  const request = useCallback(
    (targets: readonly number[], at: number) => {
      needed.current = targets;
      position.current = at;
      const signal = abort.current?.signal;
      if (!signal || signal.aborted) return;
      const version = generation.current;
      for (const offset of targets) {
        if (
          offset < 0 ||
          cache.current.has(offset) ||
          pending.current.has(offset)
        )
          continue;
        void read(offset, signal, version);
      }
      // Whatever the band asks for, what stays in the page is this band and its nearest windows.
      store();
    },
    [read, store],
  );

  // The address or the session moved, so every window belongs to a result set that is gone. The
  // first window of the new read is requested here, before the page has measured anything, so the
  // stream's length arrives even while the band is still at the top.
  useEffect(() => {
    generation.current++;
    abort.current?.abort();
    cache.current = new Map();
    pending.current = new Set();
    needed.current = [];
    position.current = 0;
    published.current = [];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new read replaces what the old one published
    setWindows(NO_WINDOWS);
    setTotal(null);
    setLoaded(0);
    setMore(null);
    setError(null);
    if (!source) return;
    const controller = new AbortController();
    abort.current = controller;
    void read(0, controller.signal, generation.current);
    return () => abort.current?.abort();
  }, [source, identity, read]);

  // The band the page shows again: the windows under it are read if they were dropped, and the
  // windows it no longer needs make room for them.
  const retry = useCallback(() => {
    setError(null);
    request(needed.current.length ? needed.current : [0], position.current);
  }, [request]);

  // The band the page shows again after something behind it moved: the rows it holds are dropped
  // and the reads still in flight are superseded, so a window read that started before the change
  // can never publish the rows it carried.
  const refresh = useCallback(() => {
    setError(null);
    if (!source) return;
    generation.current++;
    abort.current?.abort();
    cache.current = new Map();
    pending.current = new Set();
    published.current = [];
    setWindows(NO_WINDOWS);
    abort.current = new AbortController();
    request(needed.current.length ? needed.current : [0], position.current);
  }, [request, source]);

  return {
    windows,
    total,
    loaded,
    more,
    error,
    request,
    retry,
    refresh,
  };
}
