'use client';
import { useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { formatVnd, vietnamTimestamp } from '@/features/properties/format';
import type { PriceHistoryPage, PriceSeries } from './data';
import { maintenanceText } from './messages';
// One recorded series at a time: sale asking prices (whole VND) and monthly asking rents
// (whole VND per month) never share a row, a unit or a cursor. A null side is an unknown
// gap that the record never contained, rendered as unknown rather than as zero.
function Series({
  propertyId,
  series,
  locale,
}: {
  propertyId: string;
  series: PriceSeries;
  locale: Locale;
}) {
  const [cursor, setCursor] = useState<{
    before: string;
    beforeId: string;
  } | null>(null);
  const endpoint =
    '/api/properties/' +
    propertyId +
    '/price-history?' +
    new URLSearchParams({ series, ...cursor });
  const { data, error, busy, surface, reload } =
      useProtectedData<PriceHistoryPage>(endpoint),
    text = maintenanceText(locale),
    heading = series === 'sale' ? text.salePriceSeries : text.rentPriceSeries,
    empty = series === 'sale' ? text.emptySalePrices : text.emptyRentPrices,
    money = (value: string) =>
      formatVnd(value, locale) +
      (series === 'rent' ? ' / ' + text.perMonth : '');
  return (
    <div className="price-series">
      <h3 className="price-series-title">{heading}</h3>
      {busy ? (
        <LoadingSkeleton
          label={text.loading}
          shape="table"
          rows={4}
          columns={3}
        />
      ) : null}
      {error ? (
        <div className="alert" data-tone="danger" role="alert">
          <span>
            {error === 'access-changed'
              ? messages[locale].accessChanged
              : text.seriesFailed}
          </span>
          <button className="btn btn-sm btn-ghost" onClick={reload}>
            {text.refresh}
          </button>
        </div>
      ) : null}
      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <>
            {data.events.length ? (
              data.events.map((event) => (
                <div className="price-row" key={event.id}>
                  <span className="price-when">
                    <time dateTime={event.occurred_at}>
                      {vietnamTimestamp(event.occurred_at, locale)}
                    </time>
                  </span>
                  <span className="price-change">
                    {event.before === null ? (
                      <span className="is-unknown">{text.unknown}</span>
                    ) : (
                      <del>{money(event.before)}</del>
                    )}{' '}
                    →{' '}
                    {event.after === null ? (
                      <span className="is-unknown">{text.unknown}</span>
                    ) : (
                      <b>{money(event.after)}</b>
                    )}
                    {/* The retained correction explanation stays with its own revision. */}
                    {event.explanation ? (
                      <span className="price-note" translate="no">
                        {event.explanation}
                      </span>
                    ) : null}
                  </span>
                  <span className="price-who" translate="no">
                    {event.actor_name}
                  </span>
                </div>
              ))
            ) : (
              <p>{empty}</p>
            )}
            <nav aria-label={heading}>
              {cursor ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setCursor(null)}
                >
                  {text.first}
                </button>
              ) : null}
              {data.nextCursor ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setCursor(data.nextCursor)}
                >
                  {text.more}
                </button>
              ) : null}
            </nav>
          </>
        ) : null}
      </div>
    </div>
  );
}
export function PriceHistory({
  propertyId,
  locale,
}: {
  propertyId: string;
  locale: Locale;
}) {
  const text = maintenanceText(locale);
  return (
    <section className="panel" data-od-id="panel-price-history">
      <div className="panel-head">
        <h2>{text.priceHistory}</h2>
      </div>
      <div className="panel-body">
        <Series propertyId={propertyId} series="sale" locale={locale} />
        <Series propertyId={propertyId} series="rent" locale={locale} />
        <p className="field-hint">{text.priceHistoryNote}</p>
      </div>
    </section>
  );
}
