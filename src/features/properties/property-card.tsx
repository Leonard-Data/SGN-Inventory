import type { Locale } from '@/i18n/messages';
import { label } from '@/i18n/messages';
import { memo } from 'react';
import type { PropertySummary } from './types';
import { CoverImage } from '@/features/property-files/cover-image';
import { Plate } from './plate';
import { formatInteger, vietnamDate } from './format';

/* Tone helper: maps an inventory status to a badge tone. Shared with the quick view, so a status
   reads the same everywhere it appears. */
export function statusTone(status: string): string {
  if (status === 'available' || status === 'verified') return 'success';
  if (
    status === 'sold' ||
    status === 'rented' ||
    status === 'withdrawn' ||
    status === 'archived'
  )
    return 'muted';
  if (status === 'negotiating' || status === 'candidate') return 'warn';
  return 'neutral';
}

// One card draws a site plate, so the grid is the one place where a parent re-render for an
// unrelated reason (opening the filter island, changing sort) would redraw every plate.
// The props are the record, two strings, a boolean and the caller's stable callback, so the
// shallow comparison skips exactly those re-renders and nothing else.
export const PropertyCard = memo(function PropertyCard({
  record,
  locale,
  resultLocation,
  onDenied,
  onQuickView,
  showEntry = false,
}: {
  record: PropertySummary;
  locale: Locale;
  resultLocation: string;
  onDenied: (status: number) => void;
  // Opening the record's quick view in place. The control that was pressed travels with the
  // call, so closing the quick view returns focus to that same control.
  onQuickView?: (record: PropertySummary, opener: HTMLElement | null) => void;
  showEntry?: boolean;
}) {
  // The chronological views carry the recorded original entry date and the database's Vietnam
  // age. A property the database reports with no date is an explicit unknown, not a missing row.
  const entryDate = record.entryOn ? vietnamDate(record.entryOn) : null;
  return (
    <article className="property-card" key={record.id}>
      {record.coverFileId ? (
        <CoverImage
          propertyId={record.id}
          fileId={record.coverFileId}
          locale={locale}
          onDenied={onDenied}
        />
      ) : (
        // A stored cover photograph wins over the drawing; with none, the record's
        // identity is the site plate, drawn only from the fields it actually has.
        <div className="cover">
          <Plate
            variant="card"
            locale={locale}
            record={{
              property_code: record.propertyCode,
              frontage_m: record.frontageM,
              depth_m: record.depthM,
              land_area_m2: record.landAreaM2,
              floor_area_m2: record.floorAreaM2,
              floors: record.floors,
              direction: record.direction,
              access_type: record.accessType,
            }}
          />
        </div>
      )}
      <div className="card-body">
        <p className="card-meta">
          {record.propertyCode} · {label(locale, record.listingMode)}
        </p>
        <h2 className="card-address">
          <a
            translate="no"
            href={
              '/properties/' +
              record.id +
              '?' +
              new URLSearchParams({ returnTo: resultLocation })
            }
          >
            {record.addresses.length && record.addresses[0]?.addressText
              ? record.addresses[0].addressText
              : label(locale, null)}
          </a>
        </h2>
        {showEntry ? (
          <p className="card-entry">
            {label(locale, 'entryDate')}:{' '}
            {entryDate ? (
              <>
                <time dateTime={record.entryOn ?? undefined}>{entryDate}</time>
                {record.entrySource === 'legacy'
                  ? ` (${label(locale, 'entryDateLegacy')})`
                  : ''}
                {typeof record.ageDays === 'number'
                  ? ` · ${formatInteger(record.ageDays, locale)} ${label(
                      locale,
                      record.ageDays === 1 ? 'entryAgeOne' : 'entryAge',
                    )}`
                  : ''}
              </>
            ) : (
              <>
                <span className="badge" data-tone="muted">
                  {label(locale, 'entryDateUnknown')}
                </span>
                {' · '}
                {label(locale, 'entryAgeUnknown')}
              </>
            )}
          </p>
        ) : null}
        {record.createdBy ? (
          <p className="card-entry">
            {label(locale, 'createdBy')}:{' '}
            <span translate="no">{record.createdBy}</span>
          </p>
        ) : null}
        <div className="card-foot">
          <span className="badge" data-tone={statusTone(record.status)}>
            {label(locale, record.status)}
          </span>
          <div className="card-actions">
            {onQuickView ? (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={(event) => onQuickView(record, event.currentTarget)}
              >
                {label(locale, 'quickView')}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
});
