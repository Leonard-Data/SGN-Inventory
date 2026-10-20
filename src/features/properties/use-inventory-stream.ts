'use client';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/features/employees/api';
import { useWindowStream } from '@/features/stream/use-windows';
import {
  ADVANCED_SEARCH_QUERY_OPTIONS,
  advancedSearchKey,
  type AdvancedCriteria,
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
  identity,
  scope,
  criteria,
  onDenied,
}: {
  // The one read this stream is a window of; null while the result set is the loaded catalogue,
  // a chronological ordering or an advanced filter is not stated, or the session is not usable.
  // A null source reads nothing at all.
  source: string | null;
  // Changes when the session's own authority changes, so a window read under the old session
  // never fills the surface the new one is allowed to see.
  identity: string;
  // The authorized scope the advanced pages are cached under, with the criteria, ordering and
  // page: another account or another access revision never reads these rows from the other's key.
  scope: string;
  criteria: AdvancedCriteria | null;
  onDenied: (status: number) => void;
}): InventoryStream {
  const queryClient = useQueryClient();
  // The ordering each read states, kept beside the read it belongs to: a read of the previous
  // address or session never leaves its own ordering on the stream that replaced it.
  const [ordered, setOrdered] = useState<{
    key: string;
    order: InventoryOrder | null;
  }>({ key: '', order: null });
  const key = `${identity}\n${source ?? ''}`;
  const readWindow = useCallback(
    async (offset: number) => {
      if (!source || !criteria) return NO_WINDOW;
      const stream = await queryClient.fetchQuery({
        queryKey: advancedSearchKey({ scope, criteria, page: offset }),
        // The query client owns this read's lifecycle: it deduplicates a page already in flight
        // and cancels it when the scope is cleared, so this read carries its own signal rather
        // than the window band's.
        queryFn: ({ signal }) =>
          api<PropertyStream>(
            streamWindowUrl(source, offset),
            undefined,
            signal,
          ),
        ...ADVANCED_SEARCH_QUERY_OPTIONS,
      });
      setOrdered({ key, order: stream.order });
      return {
        rows: stream.properties,
        total: stream.total,
        more: stream.offset + stream.properties.length < stream.total,
      };
    },
    [source, criteria, scope, key, queryClient],
  );
  const stream = useWindowStream<PropertySummary>({
    source,
    identity,
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
