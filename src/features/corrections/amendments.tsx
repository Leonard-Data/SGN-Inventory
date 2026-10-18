'use client';
import { useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { BusinessValues } from '@/features/property-maintenance/history';
import { maintenanceText } from '@/features/property-maintenance/messages';
import { vietnamTimestamp } from '@/features/properties/format';
import { changedValues } from './changes';
import type { AmendmentPage } from './data';
function AmendmentList({
  requestId,
  locale,
}: {
  requestId: string;
  locale: Locale;
}) {
  const [after, setAfter] = useState<number | null>(null),
    text = maintenanceText(locale),
    { data, error, busy, surface, reload } = useProtectedData<AmendmentPage>(
      '/api/corrections/' +
        requestId +
        '/amendments' +
        (after ? '?after=' + after : ''),
    );
  return (
    <div>
      {busy ? (
        <LoadingSkeleton label={text.loading} shape="rows" rows={3} />
      ) : null}
      {error ? (
        <p role="alert">
          {error === 'access-changed'
            ? messages[locale].accessChanged
            : text.unavailable}{' '}
          <button className="btn btn-sm btn-ghost" onClick={reload}>
            {text.refresh}
          </button>
        </p>
      ) : null}
      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <>
            {data.amendments.map((a) => (
              <section className="history-event" key={a.id}>
                <p>
                  {text.actor}:{' '}
                  <span translate="no">
                    {data.actors.find((actor) => actor.id === a.actor_id)
                      ?.display_name ?? a.actor_id}
                  </span>{' '}
                  ·{' '}
                  <time dateTime={a.created_at}>
                    {vietnamTimestamp(a.created_at, locale)}
                  </time>
                </p>
                <p translate="no">{a.explanation}</p>
                <h4>{text.observed}</h4>
                <BusinessValues
                  values={
                    changedValues(a.observed_values, a.proposed_values).observed
                  }
                  locale={locale}
                />
                <h4>{text.proposal}</h4>
                <BusinessValues values={a.proposed_values} locale={locale} />
              </section>
            ))}
            <nav aria-label={text.amendments}>
              {after ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setAfter(null)}
                >
                  {text.first}
                </button>
              ) : null}
              {data.nextCursor ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setAfter(data.nextCursor)}
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
export function Amendments({
  requestId,
  locale,
}: {
  requestId: string;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false),
    text = maintenanceText(locale);
  return (
    <details
      className="maintenance"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{text.amendments}</summary>
      {open ? <AmendmentList requestId={requestId} locale={locale} /> : null}
    </details>
  );
}
