'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, RequestError } from '@/features/employees/api';
import {
  retainedWindows,
  STREAM_WINDOWS_KEPT,
  streamWindowUrl,
  type InventoryOrder,
} from './stream';
import type { PropertyStream, PropertySummary } from './types';

// The windows of the stream the page currently holds, by the row offset each one starts at. The
// page asks for the windows its band needs; this hook reads what is missing, keeps the nearest
// windows and drops the rest, so scrolling the whole stream never holds the whole result set.
export type InventoryStream = {
  windows: ReadonlyMap<number, PropertySummary[]>;
  // The matching total the last read stated, or null before the first read answers. Every read
  // states it, so a window that has run out still corrects the count.
  total: number | null;
  order: InventoryOrder | null;
  // The code of the most recent failed read, cleared by the next read that succeeds.
  error: string | null;
  // What the band wants: the windows holding the rows it would show, and the row position it is
  // centred on, which decides which stored windows survive.
  request: (windows: readonly number[], position: number) => void;
  retry: () => void;
};

const NO_WINDOWS: ReadonlyMap<number, PropertySummary[]> = new Map();

export function useInventoryStream({
  source,
  identity,
  onDenied,
}: {
  // The one read this stream is a window of; null while the address or the session is not
  // usable, which reads nothing at all.
  source: string | null;
  // Changes when the session's own authority changes, so a window read under the old session
  // never fills the surface the new one is allowed to see.
  identity: string;
  onDenied: (status: number) => void;
}): InventoryStream {
  const [windows, setWindows] = useState(NO_WINDOWS);
  const [total, setTotal] = useState<number | null>(null);
  const [order, setOrder] = useState<InventoryOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<number, PropertySummary[]>());
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
    if (
      kept.length === published.current.length &&
      kept.every((offset, index) => offset === published.current[index])
    )
      return;
    const next = new Map<number, PropertySummary[]>();
    for (const offset of kept) {
      const rows = cache.current.get(offset);
      if (rows) next.set(offset, rows);
    }
    cache.current = next;
    published.current = kept;
    setWindows(next);
  }, []);

  // One window of the one filtered read: the rows it holds and the matching total the same read
  // states. A read that has been superseded by a new address or session publishes nothing.
  const read = useCallback(
    async (offset: number, signal: AbortSignal, version: number) => {
      if (!source) return;
      pending.current.add(offset);
      try {
        const stream = await api<PropertyStream>(
          streamWindowUrl(source, offset),
          undefined,
          signal,
        );
        if (version !== generation.current || signal.aborted) return;
        pending.current.delete(offset);
        cache.current.set(stream.offset, stream.properties);
        setTotal(stream.total);
        setOrder(stream.order);
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
    [source, store],
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
  // count arrives even while the band is still at the top.
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
    setOrder(null);
    setError(null);
    if (!source) return;
    const controller = new AbortController();
    abort.current = controller;
    void read(0, controller.signal, generation.current);
    return () => controller.abort();
  }, [source, identity, read]);

  // The band the page shows again: the windows under it are read if they were dropped, and the
  // windows it no longer needs make room for them.
  const retry = useCallback(() => {
    setError(null);
    request(needed.current.length ? needed.current : [0], position.current);
  }, [request]);

  return { windows, total, order, error, request, retry };
}
