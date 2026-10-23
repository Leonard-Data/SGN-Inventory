'use client';
import { memo, useId, type ReactNode } from 'react';
import Link from 'next/link';
import { label, messages, type Locale } from '@/i18n/messages';
import { LoadingSkeleton } from '@/features/skeleton';
import {
  SUMMARY_HEADINGS,
  SUMMARY_SORT_FIELDS,
  listedAddress,
  propertyTableRow,
  recordFacts,
  rowPrice,
  statedAddress,
  type SummaryColumn,
} from './table';
import { HIDEABLE_COLUMNS } from './columns';
import { columnOrder, type InventorySortField } from './stream';
import { compactVnd, formatVnd } from './format';
import { statusTone } from './property-card';
import { useMeasuredHeight } from '@/features/stream/use-measured';
import { useRelativeNow } from './use-relative-now';
import type { PropertySummary } from './types';

export const TableChunk = memo(function TableChunk({
  index,
  rows,
  count,
  reserved,
  locale,
  resultLocation,
  addressFormat,
  matchedFormats,
  shown,
  quickView,
  onOpen,
  onMeasured,
}: {
  index: number;
  rows: PropertySummary[] | null;
  count: number;
  reserved: number;
  locale: Locale;
  resultLocation: string;
  // The format the search reads through, which decides the address each row states.
  addressFormat: string | null;
  // The stored address format each property matched through, while a local search is filtering. It
  // decides the address the row states, and is named beside it when the search states no format.
  matchedFormats: ReadonlyMap<string, string>;
  // The columns the person chose to see, in the table's own order: a hidden column is neither a
  // heading nor a cell, so the grid stays consistent.
  shown: readonly SummaryColumn[];
  // Whether a row's quick view can open yet: it states the caller's own permissions, so it waits for
  // this surface's session to answer. Both controls that open it state the same thing.
  quickView: boolean;
  onOpen: (record: PropertySummary, opener: HTMLElement | null) => void;
  onMeasured: (index: number, height: number) => void;
}) {
  const element = useMeasuredHeight<HTMLTableSectionElement>({
    index,
    active: rows !== null,
    report: onMeasured,
  });
  const now = useRelativeNow();
  const text = messages[locale];
  if (rows === null)
    return (
      <tbody ref={element}>
        <tr className="inventory-gap" style={{ height: reserved }}>
          <td className="inventory-window" colSpan={shown.length}>
            <LoadingSkeleton
              label={messages[locale].loading}
              shape="table"
              rows={count}
              columns={shown.length}
            />
          </td>
        </tr>
      </tbody>
    );
  return (
    <tbody ref={element}>
      {rows.map((record) => {
        const matchedFormat = matchedFormats.get(record.id) ?? null;
        const address = listedAddress(record, addressFormat, matchedFormat);
        const stated = statedAddress(address, {
          locale,
          addressFormat,
          matchedFormat,
        });
        const row = propertyTableRow(record, locale, now, address);
        // The facts the row and the quick view both state come from one projection.
        const facts = recordFacts(record, locale);
        const price = rowPrice(record);
        const modified = row.cells.find(
          (cell) => cell.column === 'modifiedTime',
        )!;
        const area = row.cells.find((cell) => cell.column === 'totalArea')!;
        // Each column's cell, keyed by the column it fills: only the shown ones are drawn, so
        // hiding a column takes its heading and its cell out together and the grid stays consistent.
        const cells: Record<SummaryColumn, ReactNode> = {
          property: (
            <th
              scope="row"
              className="inventory-cell"
              data-column="property"
              key="property"
            >
              <button
                className="inventory-row-control"
                type="button"
                data-row-control
                aria-label={row.title}
                disabled={!quickView}
                onClick={(event) => onOpen(record, event.currentTarget)}
              >
                {record.propertyCode}
              </button>
              <small className="inventory-secondary">
                {label(locale, record.propertyType)}
              </small>
            </th>
          ),
          address: (
            <td
              className="inventory-cell"
              data-column="address"
              key="address"
              translate="no"
            >
              <span>{stated.text}</span>
              <small className="inventory-secondary">{stated.format}</small>
            </td>
          ),
          price: (
            <td className="inventory-cell" data-column="price" key="price">
              {price ? (
                <>
                  <b
                    className="num inventory-price"
                    title={formatVnd(price.value, locale)}
                    aria-label={formatVnd(price.value, locale)}
                  >
                    {compactVnd(price.value, locale)}
                  </b>
                  {price.unit === 'monthly' ? (
                    <small className="inventory-secondary">
                      {text.monthlyRent}
                    </small>
                  ) : null}
                </>
              ) : (
                '—'
              )}
            </td>
          ),
          totalArea: (
            <td
              className="inventory-cell num"
              data-column="totalArea"
              key="totalArea"
            >
              {area.text} {area.note}
            </td>
          ),
          frontage: (
            <td
              className="inventory-cell num"
              data-column="frontage"
              key="frontage"
            >
              {facts.frontage.text}
            </td>
          ),
          depth: (
            <td className="inventory-cell num" data-column="depth" key="depth">
              {facts.depth.text}
            </td>
          ),
          floors: (
            <td
              className="inventory-cell num"
              data-column="floors"
              key="floors"
            >
              {facts.floors.text}
            </td>
          ),
          creator: (
            <td
              className="inventory-cell"
              data-column="creator"
              key="creator"
              translate="no"
            >
              {facts.creator.text}
            </td>
          ),
          status: (
            <td className="inventory-cell" data-column="status" key="status">
              <span className="badge" data-tone={statusTone(record.status)}>
                {label(locale, record.status)}
              </span>
            </td>
          ),
          modifiedTime: (
            <td
              className="inventory-cell"
              data-column="modifiedTime"
              key="modifiedTime"
            >
              <time
                dateTime={record.updatedAt ?? undefined}
                title={modified.title}
                aria-label={modified.title}
              >
                {modified.text}
              </time>
            </td>
          ),
          actions: (
            <td className="inventory-cell" data-column="actions" key="actions">
              <div className="inventory-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  aria-label={`${text.quickView}: ${record.propertyCode}`}
                  disabled={!quickView}
                  onClick={(event) => onOpen(record, event.currentTarget)}
                >
                  {text.quickView}
                </button>
                <RecordMenu
                  record={record}
                  locale={locale}
                  resultLocation={resultLocation}
                />
              </div>
            </td>
          ),
        };
        return (
          <tr key={record.id} className="inventory-row">
            {shown.map((column) => cells[column])}
          </tr>
        );
      })}
    </tbody>
  );
});

function RecordMenu({
  record,
  locale,
  resultLocation,
}: {
  record: PropertySummary;
  locale: Locale;
  resultLocation: string;
}) {
  const id = useId();
  const text = messages[locale];
  return (
    <details
      className="inventory-menu"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary
        aria-label={`${text.recordActions}: ${record.propertyCode}`}
        aria-controls={id}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </summary>
      <div id={id}>
        <Link
          className="link"
          href={
            '/properties/' +
            record.id +
            '?' +
            new URLSearchParams({ returnTo: resultLocation })
          }
          prefetch={false}
        >
          {text.fullRecord}
        </Link>
      </div>
    </details>
  );
}

// The heading row. Every column the read can order by states so in its heading: the name is a
// button that cycles ascending, descending and back to the default order, the heading carries the
// active direction as `aria-sort` for a screen reader, and an arrow points the way.
export function TableHead({
  locale,
  shown,
  sort,
  onSort,
}: {
  locale: Locale;
  // The columns the person chose to see, in the table's own order.
  shown: readonly SummaryColumn[];
  // The ordering the address states, which decides the active arrow and the announced direction.
  sort: string | null;
  onSort: (field: InventorySortField) => void;
}) {
  const text = messages[locale];
  const active = columnOrder(sort);
  return (
    <thead>
      <tr>
        {shown.map((column) => {
          const heading = text[SUMMARY_HEADINGS[column]];
          const field = SUMMARY_SORT_FIELDS[column];
          if (!field)
            return (
              <th key={column} scope="col" data-column={column}>
                {heading}
              </th>
            );
          const direction = active?.field === field ? active.direction : null;
          return (
            <th
              key={column}
              scope="col"
              data-column={column}
              aria-sort={
                direction === 'asc'
                  ? 'ascending'
                  : direction === 'desc'
                    ? 'descending'
                    : 'none'
              }
            >
              <button
                className="inventory-sort"
                type="button"
                onClick={() => onSort(field)}
              >
                {heading}
                <svg
                  className="inventory-sort-arrow"
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 19V5M6 11l6-6 6 6" />
                </svg>
              </button>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

// The control above the table that hides and shows one column at a time: the two columns a row
// cannot be read or operated without are not offered, and every other column is a checkbox that
// states whether it is shown. The menu is the pattern the row menu already uses, and the checkbox
// its own label, so it is operated from the keyboard and announced in both languages.
export function ColumnMenu({
  locale,
  hidden,
  onToggle,
}: {
  locale: Locale;
  hidden: ReadonlySet<SummaryColumn>;
  onToggle: (column: SummaryColumn) => void;
}) {
  const text = messages[locale];
  return (
    <details
      className="inventory-columns"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.open = false;
          event.currentTarget.querySelector('summary')?.focus();
        }
      }}
    >
      <summary className="btn btn-secondary btn-sm">
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M15 4v16" />
        </svg>
        {text.columnsLabel}
        {hidden.size ? (
          <span className="badge" data-tone="neutral">
            {hidden.size}
          </span>
        ) : null}
      </summary>
      <div className="inventory-columns-panel">
        {HIDEABLE_COLUMNS.map((column) => (
          <label key={column} className="check">
            <input
              type="checkbox"
              checked={!hidden.has(column)}
              onChange={() => onToggle(column)}
            />
            {text[SUMMARY_HEADINGS[column]]}
          </label>
        ))}
      </div>
    </details>
  );
}
