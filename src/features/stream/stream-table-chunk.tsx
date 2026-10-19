'use client';
import { type ReactNode } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { LoadingSkeleton } from '@/features/skeleton';
import { useMeasuredHeight } from './use-measured';
import type { StreamGeometry } from './use-stream-layout';
import { chunkReservation } from './use-stream-layout';

// One mounted chunk of a streamed table: the rows the windows have answered with, or the space
// reserved for the chunk until they arrive, drawn as a skeleton of the rows. The chunk is one
// <tbody> of the single table, so the columns keep their alignment across chunk boundaries, and
// it measures its own rows so the stream reserves what rows actually take.
export function StreamTableChunk<T>({
  geometry,
  index,
  rows,
  count,
  columns,
  locale,
  children,
}: {
  geometry: StreamGeometry;
  index: number;
  // The chunk's rows, or null while a window it needs has not been read.
  rows: readonly T[] | null;
  // How many rows the chunk holds: the skeleton stands in for exactly those rows.
  count: number;
  columns: number;
  locale: Locale;
  children: ReactNode;
}) {
  const element = useMeasuredHeight<HTMLTableSectionElement>({
    index,
    active: rows !== null,
    report: geometry.reportHeight,
  });
  if (rows === null) {
    // The row keeps the whole reserved height, so the skeleton fills the space the rows
    // themselves will take rather than moving the rest of the list when they arrive.
    return (
      <tbody ref={element}>
        <tr
          className="inventory-gap"
          style={{ height: chunkReservation(geometry.heights, index) }}
        >
          <td className="inventory-window" colSpan={columns}>
            <LoadingSkeleton
              label={messages[locale].loading}
              shape="table"
              rows={count}
              columns={columns}
            />
          </td>
        </tr>
      </tbody>
    );
  }
  return <tbody ref={element}>{children}</tbody>;
}

// The space reserved for the rows between the viewport and the mounted band: one row carrying
// only its height, so the stream keeps its whole scroll length while those rows are not in the
// page.
export function StreamGap({
  height,
  columns,
}: {
  height: number;
  columns: number;
}) {
  if (height <= 0) return null;
  return (
    <tbody aria-hidden="true">
      <tr className="inventory-gap" style={{ height }}>
        <td colSpan={columns} />
      </tr>
    </tbody>
  );
}
