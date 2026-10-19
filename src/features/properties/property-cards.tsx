'use client';
import { memo } from 'react';
import type { Locale } from '@/i18n/messages';
import { PropertyCard } from './property-card';
import { useMeasuredHeight } from './use-measured';
import type { PropertySummary } from './types';

// One mounted chunk of the card view: whole rows of the measured grid, or the space reserved for
// the rows until their window arrives. Chunking in whole rows keeps every row of cards full, so
// the boundaries the virtualisation creates are invisible in the layout.
export const CardChunk = memo(function CardChunk({
  index,
  columns,
  rows,
  reserved,
  locale,
  resultLocation,
  showEntry,
  onDenied,
  onOpen,
  onMeasured,
}: {
  index: number;
  columns: number;
  rows: PropertySummary[] | null;
  reserved: number;
  locale: Locale;
  resultLocation: string;
  showEntry: boolean;
  onDenied: (status: number) => void;
  onOpen: (record: PropertySummary, opener: HTMLElement | null) => void;
  onMeasured: (index: number, height: number) => void;
}) {
  const element = useMeasuredHeight<HTMLDivElement>({
    index,
    active: rows !== null,
    report: onMeasured,
  });
  return (
    <div
      ref={element}
      className="inventory-chunk"
      // The reservation is the chunk's whole box, the same box a measured chunk reports: the
      // trailing space under its last row is part of the height, so the stream's arithmetic and
      // the page's layout describe the same rows.
      style={{ height: rows === null ? reserved : undefined }}
    >
      {rows === null ? null : (
        <div
          className="property-list"
          data-view="cards"
          // The measured column count, drawn as the same auto-fill grid the plain card list draws.
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, columns)}, minmax(0, 1fr))`,
          }}
        >
          {rows.map((record) => (
            <PropertyCard
              key={record.id}
              record={record}
              locale={locale}
              resultLocation={resultLocation}
              onDenied={onDenied}
              onQuickView={onOpen}
              showEntry={showEntry}
            />
          ))}
        </div>
      )}
    </div>
  );
});
