import type { Locale } from '@/i18n/messages';
import { label } from '@/i18n/messages';
import type { PropertySummary } from './types';
import { CoverImage } from '@/features/property-files/cover-image';
import { Plate } from './plate';

/* Tone helper: maps an inventory status to a badge tone. */
function statusTone(status: string): string {
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

export function PropertyCard({
  record,
  locale,
  resultLocation,
  onDenied,
}: {
  record: PropertySummary;
  locale: Locale;
  resultLocation: string;
  onDenied: (status: number) => void;
}) {
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
        <div className="card-foot">
          <span className="badge" data-tone={statusTone(record.status)}>
            {label(locale, record.status)}
          </span>
          <div className="card-actions" />
        </div>
      </div>
    </article>
  );
}
