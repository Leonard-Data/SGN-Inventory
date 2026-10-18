'use client';
import { useState } from 'react';
import type { Json } from '@/types/database';
import type { Locale } from '@/i18n/messages';
import { label, messages } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import {
  formatVnd,
  formatDecimal,
  vietnamDate,
  vietnamTimestamp,
} from '@/features/properties/format';
import type { HistoryPage } from './data';
import { fields } from './fields';
import { maintenanceText, optionLabel } from './messages';
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
  const [cursor, setCursor] = useState<{
    before: string;
    beforeId: string;
  } | null>(null);
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
        <h2>{text.history}</h2>
      </div>
      <div className="panel-body">
        {busy ? (
          <LoadingSkeleton label={text.loading} shape="rows" rows={4} />
        ) : null}
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>
              {error === 'access-changed'
                ? messages[locale].accessChanged
                : text.unavailable}
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
                  <article className="hist-row" key={event.id}>
                    <h3 className="hist-field">
                      {optionLabel(locale, event.target)}
                    </h3>
                    <p className="hist-when">
                      {text.actor}:{' '}
                      <span translate="no">{event.actor_name}</span> ·{' '}
                      <time dateTime={event.occurred_at}>
                        {vietnamTimestamp(event.occurred_at, locale)}
                      </time>{' '}
                      ({text.time})
                    </p>
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
                  </article>
                ))
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
