'use client';
import Link from 'next/link';
import { messages, label, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { vietnamTimestamp } from '@/features/properties/format';
import type { Vendor, VendorLinkedProperty } from './types';

// One recorded company identity, read under the same active-employee RLS boundary as the
// directory. An unknown optional detail reads as unknown (never a dash or an invented
// value); this slice has no edit surface, so the record is presented read-only.
function Fact({
  label,
  value,
  unknown,
  multiline = false,
}: {
  label: string;
  value: string | null;
  unknown: string;
  multiline?: boolean;
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd
        className={
          value === null ? 'is-unknown' : multiline ? 'vendor-note' : undefined
        }
      >
        {value ?? unknown}
      </dd>
    </div>
  );
}

export function VendorDetailView({
  id,
  initialLocale,
}: {
  id: string;
  initialLocale: Locale;
}) {
  const locale = initialLocale;
  const { data, error, busy, surface, logout, reload } = useProtectedData<{
    vendor: Vendor;
    properties: VendorLinkedProperty[];
    more: boolean;
  }>('/api/vendors/' + encodeURIComponent(id));
  const text = messages[locale];
  const vendor = data?.vendor ?? null;
  const message =
    error === 'not-found'
      ? text.vendorNotFound
      : error === 'invalid-input'
        ? text.invalidInput
        : error === 'sign-out-failed'
          ? text.signOutFailed
          : text.vendorDetailFailed;
  return (
    <>
      <p className="page-section">
        <Link className="link-quiet" href="/people/vendors" prefetch={false}>
          ← {text.vendorBackToDirectory}
        </Link>
      </p>

      <div className="detail-head">
        <div>
          <p className="example">{text.vendorDirectory}</p>
          <h1>{vendor?.displayName ?? text.vendorDetailTitle}</h1>
        </div>
      </div>

      {error ? (
        <div className="alert" data-tone="danger" role="alert">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{message}</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={error === 'sign-out-failed' ? logout : reload}
          >
            {text.retry}
          </button>
        </div>
      ) : null}

      {busy ? (
        <p className="panel-note" role="status">
          {text.loading}
        </p>
      ) : null}

      <div ref={surface} hidden={!data || busy}>
        {vendor ? (
          <section
            className="panel page-section"
            aria-labelledby="vendor-record"
          >
            <div className="panel-head">
              <h2 id="vendor-record">{text.vendorDetailTitle}</h2>
              <span className="panel-note">{text.vendorCreateNote}</span>
            </div>
            <div className="panel-body">
              <dl className="facts">
                <Fact
                  label={text.vendorCompanyName}
                  value={vendor.displayName}
                  unknown={text.unknown}
                />
                <Fact
                  label={text.vendorContactName}
                  value={vendor.contactName}
                  unknown={text.unknown}
                />
                <Fact
                  label={text.vendorPhones}
                  value={
                    vendor.phones?.length ? vendor.phones.join(' · ') : null
                  }
                  unknown={text.unknown}
                />
                <Fact
                  label={text.email}
                  value={vendor.email}
                  unknown={text.unknown}
                />
                <Fact
                  label={text.vendorSourceAddress}
                  value={vendor.sourceAddress}
                  unknown={text.unknown}
                />
                <Fact
                  label={text.notes}
                  value={vendor.notes}
                  unknown={text.unknown}
                  multiline
                />
                <Fact
                  label={text.vendorRecordedAt}
                  value={vietnamTimestamp(vendor.createdAt, locale)}
                  unknown={text.unknown}
                />
              </dl>
            </div>
          </section>
        ) : null}

        {vendor ? (
          <section
            className="panel page-section"
            aria-labelledby="vendor-properties"
          >
            <div className="panel-head">
              <h2 id="vendor-properties">{text.vendorLinkedProperties}</h2>
            </div>
            <div className="panel-body">
              {data?.properties.length ? (
                data.properties.map((property) => (
                  <div className="record" key={property.propertyId}>
                    <div className="record-head">
                      <Link
                        className="record-title"
                        href={'/properties/' + property.propertyId}
                        prefetch={false}
                      >
                        {property.propertyCode}
                      </Link>
                      <span
                        className="badge badge-plain"
                        data-tone={property.archivedAt ? 'neutral' : 'accent'}
                      >
                        {label(locale, property.status)}
                        {property.archivedAt
                          ? ' · ' + text.vendorLinkedArchived
                          : ''}
                      </span>
                    </div>
                    <p className="record-meta">
                      {text.vendorLinkedAt}{' '}
                      <time dateTime={property.linkedAt}>
                        {vietnamTimestamp(property.linkedAt, locale)}
                      </time>
                    </p>
                  </div>
                ))
              ) : (
                <p>{text.vendorLinkedPropertiesEmpty}</p>
              )}
              {data?.more ? (
                <p className="field-hint">{text.vendorLinkedPropertiesMore}</p>
              ) : null}
              <p className="field-hint">{text.vendorLinkedPropertiesNote}</p>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
