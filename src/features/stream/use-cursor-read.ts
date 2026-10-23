'use client';
import { useCallback, useRef } from 'react';
import { api, RequestError } from '@/features/employees/api';
import { cursorWindowUrl, type CursorPage } from './window';
import type { StreamWindowRead } from './use-windows';

// A read that pages by cursor, read as a stream: the first window has no cursor, and every later
// window is reached by the cursor the window before it stated. The cursor chain is kept for every
// window the stream has read, so a window dropped from the page and scrolled back to is read
// again from its own cursor rather than by walking the read forward from the first row.
export function useCursorWindow<T>({
  source,
  pageSize,
  page,
}: {
  // The one filtered read, without a cursor: the search and the filters every window carries.
  source: string | null;
  // Rows per read: the offset step between one window and the next.
  pageSize: number;
  // Reads one window's rows and the cursor after it out of the response.
  page: (payload: unknown) => CursorPage<T>;
}): (offset: number, signal: AbortSignal) => Promise<StreamWindowRead<T>> {
  const cursors = useRef(new Map<number, string | null>());
  const chain = useRef<string | null>(null);
  return useCallback(
    async (offset: number, signal: AbortSignal) => {
      if (!source) return { rows: [], total: null, more: false };
      // A read of another address starts its own chain: the cursors of the read it replaced name
      // rows that need not exist in this one.
      if (chain.current !== source) {
        cursors.current = new Map();
        chain.current = source;
      }
      const cursor =
        offset === 0 ? null : (cursors.current.get(offset) ?? null);
      // The stream only ever asks for a window the chain has reached, so this is the read failing
      // rather than the stream ending.
      if (offset > 0 && cursor === null)
        throw new RequestError(503, 'unavailable');
      const response = await api<unknown>(
        cursor === null ? source : cursorWindowUrl(source, cursor),
        undefined,
        signal,
      );
      if (signal.aborted) return { rows: [], total: null, more: false };
      const { rows, next } = page(response);
      // The following window is reached through this one, however deep in the stream it sits.
      cursors.current.set(offset + pageSize, next);
      return { rows, total: null, more: next !== null };
    },
    [source, pageSize, page],
  );
}
