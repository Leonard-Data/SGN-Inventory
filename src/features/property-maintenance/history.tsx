'use client';
import { useState } from 'react';
import type { Json } from '@/types/database';
import type { Locale } from '@/i18n/messages';
import { label } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import {
  formatVnd,
  formatDecimal,
  vietnamDate,
  vietnamTimestamp,
} from '@/features/properties/format';
import type { HistoryPage } from './data';
import { fields } from './fields';
import { priceChanges, priceFieldChanged } from './history-model';
import { maintenanceText, optionLabel } from './messages';
type HistoryEvent = HistoryPage['events'][number];
type Cursor = { before: string; beforeId: string };
const extraLabels: Record<string, readonly [string, string]> = {
  property_code: ['Mã bất động sản', 'Property code'],
  entry_on: ['Ngày nhập kho gốc', 'Original inventory entry date'],
  entry_source: ['Nguồn ngày nhập kho gốc', 'Original entry provenance'],
  verified_by: ['Người chỉ định ánh xạ', 'Mapping designator'],
  verified_at: ['Thời điểm xác minh', 'Verification time'],
  supersedes_address_id: [
    'Địa chỉ được giữ lại trước đó',
    'Retained preceding address',
  ],
};
// A price-only change names the price it moved; every other change is named by its target,
// so the timeline never claims a document, deposit or sale event the database does not record.
function timelineTitle(event: HistoryEvent, locale: Locale): string {
  const text = maintenanceText(locale),
    field = priceFieldChanged(event.changed_fields);
  if (field === 'sale_price_vnd') return text.priceSaleUpdated;
  if (field === 'monthly_rent_vnd') return text.priceRentUpdated;
  return optionLabel(locale, event.target);
}
export function BusinessValues({
  values,
  locale,
}: {
  values: Json;
  locale: Locale;
}) {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    return null;
  const text = maintenanceText(locale);
  return (
    <dl>
      {Object.entries(values).map(([name, value]) => {
        const field = fields[name];
        const content =
          value == null
            ? text.unknown
            : typeof value === 'boolean'
              ? value
                ? text.yes
                : text.no
              : typeof value === 'string' && field?.kind === 'money'
                ? formatVnd(value, locale)
                : typeof value === 'string' && field?.kind === 'decimal'
                  ? formatDecimal(value, locale)
                  : typeof value === 'string' && field?.options
                    ? optionLabel(locale, value)
                    : name === 'entry_source' && typeof value === 'string'
                      ? label(
                          locale,
                          value === 'legacy'
                            ? 'entryDateLegacy'
                            : value === 'recorded'
                              ? 'entrySourceRecorded'
                              : 'entryDateUnknown',
                        )
                      : name === 'entry_on' && typeof value === 'string'
                        ? vietnamDate(value)
                        : name === 'verified_at' && typeof value === 'string'
                          ? vietnamTimestamp(value, locale)
                          : Array.isArray(value)
                            ? value.join(' / ')
                            : String(value);
        return (
          <div className="history-field" key={name}>
            <dt>
              {field?.[locale] ??
                extraLabels[name]?.[locale === 'vi' ? 0 : 1] ??
                name}
            </dt>
            {/* One clipped line; the full value stays in the DOM and on the title. */}
            <dd translate="no" title={content ?? undefined}>
              {content}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
export function History({
  propertyId,
  locale,
}: {
  propertyId: string;
  locale: Locale;
}) {
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const endpoint =
    '/api/properties/' +
    propertyId +
    '/history' +
    (cursor ? '?' + new URLSearchParams(cursor) : '');
  const { data, error, busy, surface, reload } =
      useProtectedData<HistoryPage>(endpoint),
    text = maintenanceText(locale);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{text.timeline}</h2>
        <span className="panel-note">{text.timelineNote}</span>
      </div>
      <div className="panel-body">
        {busy ? <p role="status">{text.loading}</p> : null}
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>{text.unavailable}</span>
            <button className="btn btn-sm btn-ghost" onClick={reload}>
              {text.refresh}
            </button>
          </div>
        ) : null}
        <div ref={surface} hidden={!data || busy}>
          {data ? (
            <>
              {data.events.length ? (
                <ol className="timeline">
                  {data.events.map((event, index) => (
                    <li
                      className="tl-item"
                      key={event.id}
                      data-first={index === 0 ? 'true' : undefined}
                    >
                      <p className="tl-time">
                        <time dateTime={event.occurred_at}>
                          {vietnamTimestamp(event.occurred_at, locale)}
                        </time>{' '}
                        <span className="field-hint">({text.time})</span>
                      </p>
                      <h3 className="tl-title">
                        {timelineTitle(event, locale)}
                      </h3>
                      <div className="tl-body">
                        <div className="history-comparison">
                          <section>
                            <h4>{text.before}</h4>
                            <BusinessValues
                              values={event.before_values}
                              locale={locale}
                            />
                          </section>
                          <section>
                            <h4>{text.after}</h4>
                            <BusinessValues
                              values={event.after_values}
                              locale={locale}
                            />
                          </section>
                        </div>
                        {event.explanation ? (
                          <p className="hist-change" translate="no">
                            {event.explanation}
                          </p>
                        ) : null}
                      </div>
                      <p className="tl-actor">
                        {text.actor}:{' '}
                        <span translate="no">{event.actor_name}</span>
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>{text.emptyHistory}</p>
              )}
              <nav aria-label={text.history}>
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
        <p className="field-hint">{text.historyNote}</p>
      </div>
    </section>
  );
}
export function PriceHistory({
  propertyId,
  locale,
}: {
  propertyId: string;
  locale: Locale;
}) {
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const endpoint =
    '/api/properties/' +
    propertyId +
    '/history?' +
    new URLSearchParams({ prices: '1', ...cursor });
  const { data, error, busy, surface, reload } =
      useProtectedData<HistoryPage>(endpoint),
    text = maintenanceText(locale);
  const rows = (data?.events ?? []).flatMap((event) =>
    priceChanges(event).map((row) => ({
      ...row,
      title:
        row.field === 'sale_price_vnd'
          ? text.priceSaleUpdated
          : text.priceRentUpdated,
    })),
  );
  return (
    <section className="panel" data-od-id="panel-price-history">
      <div className="panel-head">
        <h2>{text.priceHistory}</h2>
        <span className="panel-note">{text.priceHistoryNote}</span>
      </div>
      <div className="panel-body">
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>{text.priceHistoryFailed}</span>
            <button className="btn btn-sm btn-ghost" onClick={reload}>
              {text.refresh}
            </button>
          </div>
        ) : null}
        {busy ? <p role="status">{text.loading}</p> : null}
        <div ref={surface} hidden={!data || busy}>
          {data ? (
            <>
              {rows.length ? (
                <ul className="price-list">
                  {rows.map((row) => (
                    <li className="price-row" key={row.key}>
                      <time className="price-when" dateTime={row.occurredAt}>
                        {vietnamDate(row.occurredAt)}
                      </time>
                      <span className="price-change">
                        <span className="sr">{row.title}</span>
                        {row.before ? (
                          <>
                            <del>{formatVnd(row.before, locale)}</del>{' '}
                            <span aria-hidden="true">→</span>{' '}
                          </>
                        ) : null}
                        <b>
                          {row.after
                            ? formatVnd(row.after, locale)
                            : text.unknown}
                        </b>
                      </span>
                      <span className="price-who" translate="no">
                        {row.actorName}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{text.priceHistoryEmpty}</p>
              )}
              <nav aria-label={text.priceHistory}>
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
    </section>
  );
}
export function PriceHistory({
  propertyId,
  locale,
}: {
  propertyId: string;
  locale: Locale;
}) {
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const endpoint =
    '/api/properties/' +
    propertyId +
    '/history?' +
    new URLSearchParams({ prices: '1', ...cursor });
  const { data, error, busy, surface, reload } =
      useProtectedData<HistoryPage>(endpoint),
    text = maintenanceText(locale);
  const rows = (data?.events ?? []).flatMap((event) =>
    priceChanges(event).map((row) => ({
      ...row,
      title:
        row.field === 'sale_price_vnd'
          ? text.priceSaleUpdated
          : text.priceRentUpdated,
    })),
  );
  return (
    <section className="panel" data-od-id="panel-price-history">
      <div className="panel-head">
        <h2>{text.priceHistory}</h2>
        <span className="panel-note">{text.priceHistoryNote}</span>
      </div>
      <div className="panel-body">
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>{text.priceHistoryFailed}</span>
            <button className="btn btn-sm btn-ghost" onClick={reload}>
              {text.refresh}
            </button>
          </div>
        ) : null}
        {busy ? <p role="status">{text.loading}</p> : null}
        <div ref={surface} hidden={!data || busy}>
          {data ? (
            <>
              {rows.length ? (
                <ul className="price-list">
                  {rows.map((row) => (
                    <li className="price-row" key={row.key}>
                      <time className="price-when" dateTime={row.occurredAt}>
                        {vietnamDate(row.occurredAt)}
                      </time>
                      <span className="price-change">
                        <span className="sr">{row.title}</span>
                        {row.before ? (
                          <>
                            <del>{formatVnd(row.before, locale)}</del>{' '}
                            <span aria-hidden="true">→</span>{' '}
                          </>
                        ) : null}
                        <b>
                          {row.after
                            ? formatVnd(row.after, locale)
                            : text.unknown}
                        </b>
                      </span>
                      <span className="price-who" translate="no">
                        {row.actorName}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{text.priceHistoryEmpty}</p>
              )}
              <nav aria-label={text.priceHistory}>
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
    </section>
  );
}
