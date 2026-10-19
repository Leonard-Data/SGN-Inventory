'use client';
import { memo } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { COLUMN_HEADINGS, propertyTableRow, TABLE_COLUMNS } from './table';
import { useMeasuredHeight } from './use-measured';
import type { PropertySummary } from './types';

// One mounted chunk of the table: the rows a window has answered with, or the space reserved for
// the chunk until that window arrives. The chunk is one <tbody> of the single table, so the ten
// columns keep their alignment across chunk boundaries, and it measures its own rows so the
// stream reserves what rows actually take.
export const TableChunk = memo(function TableChunk({
  index,
  rows,
  reserved,
  locale,
  onOpen,
  onMeasured,
}: {
  index: number;
  rows: PropertySummary[] | null;
  reserved: number;
  locale: Locale;
  onOpen: (record: PropertySummary, opener: HTMLElement | null) => void;
  onMeasured: (index: number, height: number) => void;
}) {
  const element = useMeasuredHeight<HTMLTableSectionElement>({
    index,
    active: rows !== null,
    report: onMeasured,
  });
  if (rows === null) {
    return (
      <tbody ref={element}>
        <tr className="inventory-gap" style={{ height: reserved }}>
          <td colSpan={TABLE_COLUMNS.length} />
        </tr>
      </tbody>
    );
  }
  return (
    <tbody ref={element}>
      {rows.map((record) => {
        const row = propertyTableRow(record, locale);
        return (
          <tr
            key={record.id}
            className="inventory-row"
            // The row is a convenience target for a pointer; the control the keyboard reaches is
            // the row's own button in the first cell, and it names the row it opens.
            onClick={(event) =>
              onOpen(
                record,
                event.currentTarget.querySelector<HTMLElement>(
                  '[data-row-control]',
                ),
              )
            }
          >
            {row.cells.map((cell, position) =>
              position === 0 ? (
                <th
                  key={cell.column}
                  scope="row"
                  className="inventory-cell"
                  data-column={cell.column}
                >
                  <button
                    className="inventory-row-control"
                    type="button"
                    data-row-control
                    aria-label={row.title}
                    title={row.title}
                    onClick={(event) => {
                      // The row's own handler must not fire this open a second time.
                      event.stopPropagation();
                      onOpen(record, event.currentTarget);
                    }}
                  >
                    {cell.text}
                  </button>
                </th>
              ) : (
                <td
                  key={cell.column}
                  className="inventory-cell"
                  data-column={cell.column}
                >
                  {cell.emphasis ? (
                    <b className="num inventory-price">{cell.text}</b>
                  ) : (
                    cell.text
                  )}
                  {cell.note ? (
                    <small className="inventory-note">{cell.note}</small>
                  ) : null}
                </td>
              ),
            )}
          </tr>
        );
      })}
    </tbody>
  );
});

// The table's one column header row, drawn once above every chunk.
export function TableHead({ locale }: { locale: Locale }) {
  const text = messages[locale];
  return (
    <thead>
      <tr>
        {TABLE_COLUMNS.map((column) => (
          <th key={column} scope="col">
            {text[COLUMN_HEADINGS[column]]}
          </th>
        ))}
      </tr>
    </thead>
  );
}
