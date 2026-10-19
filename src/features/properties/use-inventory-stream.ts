'use client';
import { useCallback, useState } from 'react';
import { api } from '@/features/employees/api';
import { useWindowStream } from '@/features/stream/use-windows';
import { streamWindowUrl, type InventoryOrder } from './stream';
import type { PropertyStream, PropertySummary } from './types';

// The properties list as one stream: the fetch-on-scroll hook it shares with the other streamed
// lists, with this read's own part around it - the endpoint's window address and the entry-date
// ordering each read states.
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
  // The ordering each read states, kept beside the read it belongs to: a read of the previous
  // address or session never leaves its own ordering on the stream that replaced it.
  const [ordered, setOrdered] = useState<{
    key: string;
    order: InventoryOrder | null;
  }>({ key: '', order: null });
  const key = `${identity}\n${source ?? ''}`;
  const readWindow = useCallback(
    async (offset: number, signal: AbortSignal) => {
      if (!source) return { rows: [], total: null, more: false };
      const stream = await api<PropertyStream>(
        streamWindowUrl(source, offset),
        undefined,
        signal,
      );
      setOrdered({ key, order: stream.order });
      return {
        rows: stream.properties,
        total: stream.total,
        more: stream.offset + stream.properties.length < stream.total,
      };
    },
    [source, key],
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
