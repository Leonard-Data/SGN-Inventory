'use client';
import { useCallback, useState } from 'react';
import { CancelledError, useQueryClient } from '@tanstack/react-query';
import { api } from '@/features/employees/api';
import { useWindowStream } from '@/features/stream/use-windows';
import {
  ADVANCED_SEARCH_QUERY_OPTIONS,
  advancedSearchKey,
  searchCriteria,
} from './advanced-search';
import { streamWindowUrl, type InventoryOrder } from './stream';
import type { PropertyStream, PropertySummary } from './types';

// The properties list as one stream: the fetch-on-scroll hook it shares with the other streamed
// lists, with this read's own part around it - the endpoint's window address and the entry-date
// ordering each read states.
//
// This is the advanced search's reader: it is only ever handed a source for criteria the loaded
// catalogue cannot answer, and each window is a page of that search held under its own bounded
// cache key rather than in the catalogue's own cache (#194).
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

// A read the list never asks for: no source means no advanced search was submitted.
const NO_WINDOW = { rows: [] as PropertySummary[], total: null, more: false };

export function useInventoryStream({
  source,
  scope,
  onDenied,
}: {
  // The one read this stream is a window of: a submitted search's own address, which states the
  // criteria it is a window of. Nothing a render chooses - the view, the language, a rebuilt
  // filter record - is part of it, so no presentation change reopens the search. Null while the
  // result set is the loaded catalogue, a chronological ordering or an advanced filter is not
  // stated, or the session is not usable. A null source reads nothing at all.
  source: string | null;
  // The authorized scope this stream belongs to - the employee identity, their role and the
  // server-maintained access revision. It keys the ordering metadata and every cached page, so a
  // window read under the old session never fills the surface the new one is allowed to see, and
  // another account or access revision never reads these rows from the other's key.
  scope: string;
  onDenied: (status: number) => void;
}): InventoryStream {
  const queryClient = useQueryClient();
  // The ordering each read states, kept beside the read it belongs to: a read of the previous
  // address or session never leaves its own ordering on the stream that replaced it.
  const [ordered, setOrdered] = useState<{
    key: string;
    order: InventoryOrder | null;
  }>({ key: '', order: null });
  const key = `${scope}\n${source ?? ''}`;
  const readWindow = useCallback(
    async (offset: number, signal: AbortSignal) => {
      if (source === null) return NO_WINDOW;
      const readPage = () =>
        queryClient.fetchQuery({
          // The address states the criteria, so a search is keyed by what it reads rather than by
          // the object a render built for it.
          queryKey: advancedSearchKey({
            scope,
            criteria: searchCriteria(source),
            page: offset,
          }),
          // The query client owns the page in flight and cancels it when the scope is cleared; the
          // window band's signal is composed with it so a superseded read - another submission, or
          // a result the browser now answers locally - stops with the band that issued it.
          queryFn: ({ signal: querySignal }) =>
            api<PropertyStream>(
              streamWindowUrl(source, offset),
              undefined,
              AbortSignal.any([signal, querySignal]),
            ),
          ...ADVANCED_SEARCH_QUERY_OPTIONS,
        });
      let stream: PropertyStream;
      try {
        stream = await readPage();
      } catch (problem) {
        // A page the shared client drops while it is in flight - the catalogue loader clears it on
        // a first load of a scope - is a cancelled read, not a search that failed: the page is read
        // again rather than leaving the surface stating an unavailable search.
        if (!(problem instanceof CancelledError) || signal.aborted)
          throw problem;
        stream = await readPage();
      }
      // A read the band has already superseded states nothing: its ordering belongs to the search
      // that replaced it, and publishing it would hide the current search's entry chronology.
      if (!signal.aborted) setOrdered({ key, order: stream.order });
      return {
        rows: stream.properties,
        total: stream.total,
        more: stream.offset + stream.properties.length < stream.total,
      };
    },
    [source, scope, key, queryClient],
  );
  const stream = useWindowStream<PropertySummary>({
    source,
    identity: scope,
    readWindow,
    onDenied,
  });
  return {
    windows: stream.windows,
    total: stream.total,
    order: ordered.key === key ? ordered.order : null,
    error: stream.error,
    request: stream.request,
    retry: stream.retry,
  };
}
