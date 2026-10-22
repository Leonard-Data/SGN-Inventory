'use client';
import { memo, useId } from 'react';
import Link from 'next/link';
import { label, messages, type Locale } from '@/i18n/messages';
import { LoadingSkeleton } from '@/features/skeleton';
import {
  SUMMARY_TABLE_COLUMNS,
  listedAddress,
  propertyTableRow,
  recordFacts,
  rowPrice,
} from './table';
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
          <td
            className="inventory-window"
            colSpan={SUMMARY_TABLE_COLUMNS.length}
          >
            <LoadingSkeleton
              label={messages[locale].loading}
              shape="table"
              rows={count}
              columns={SUMMARY_TABLE_COLUMNS.length}
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
        const row = propertyTableRow(record, locale, now, address);
        // The facts the row and the quick view both state come from one projection.
        const facts = recordFacts(record, locale);
        const price = rowPrice(record);
        const modified = row.cells.find(
          (cell) => cell.column === 'modifiedTime',
        )!;
        const area = row.cells.find((cell) => cell.column === 'totalArea')!;
        return (
          <tr key={record.id} className="inventory-row">
            <th scope="row" className="inventory-cell" data-column="property">
              <button
                className="inventory-row-control"
                type="button"
                data-row-control
                aria-label={row.title}
                onClick={(event) => onOpen(record, event.currentTarget)}
              >
                {record.propertyCode}
              </button>
              <small className="inventory-secondary">
                {label(locale, record.propertyType)}
              </small>
            </th>
            <td className="inventory-cell" data-column="address" translate="no">
              <span>
                {[address?.houseNumber, address?.street]
                  .filter(Boolean)
                  .join(' ') ||
                  address?.addressText ||
                  text.unknown}
              </span>
              <small className="inventory-secondary">
                {[
                  [address?.commune, address?.district]
                    .filter(Boolean)
                    .join(' · '),
                  matchedFormat && matchedFormat !== addressFormat
                    ? label(locale, matchedFormat)
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </td>
            <td className="inventory-cell" data-column="price">
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
            <td className="inventory-cell num" data-column="totalArea">
              {area.text} {area.note}
            </td>
            <td className="inventory-cell num" data-column="frontage">
              {facts.frontage.text}
            </td>
            <td className="inventory-cell num" data-column="depth">
              {facts.depth.text}
            </td>
            <td className="inventory-cell num" data-column="floors">
              {facts.floors.text}
            </td>
            <td className="inventory-cell" data-column="creator" translate="no">
              {facts.creator.text}
            </td>
            <td className="inventory-cell" data-column="status">
              <span className="badge" data-tone={statusTone(record.status)}>
                {label(locale, record.status)}
              </span>
            </td>
            <td className="inventory-cell" data-column="modifiedTime">
              <time
                dateTime={record.updatedAt ?? undefined}
                title={modified.title}
                aria-label={modified.title}
              >
                {modified.text}
              </time>
            </td>
            <td className="inventory-cell" data-column="actions">
              <div className="inventory-actions">
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  aria-label={`${text.quickView}: ${record.propertyCode}`}
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

export function TableHead({ locale }: { locale: Locale }) {
  const text = messages[locale];
  // Keyed by column so a new column cannot shift every heading beside it.
  const headings: Record<(typeof SUMMARY_TABLE_COLUMNS)[number], string> = {
    property: text.columnPropertyId,
    address: text.address,
    price: text.columnPrice,
    totalArea: text.columnTotalArea,
    frontage: text.frontage,
    depth: text.depth,
    floors: text.floors,
    creator: text.createdBy,
    status: text.columnStatus,
    modifiedTime: text.columnModifiedTime,
    actions: text.recordActions,
  };
  return (
    <thead>
      <tr>
        {SUMMARY_TABLE_COLUMNS.map((column) => (
          <th key={column} scope="col" data-column={column}>
            {headings[column]}
          </th>
        ))}
      </tr>
    </thead>
  );
}
