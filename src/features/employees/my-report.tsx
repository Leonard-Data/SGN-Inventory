'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { vietnamDate } from '@/features/properties/format';
import type { MyActivityReport } from './my-report-data';

// Personal activity report (#30). One authenticated screen: the filter posts back to this
// route so the range stays in the URL, and the report itself is read through /api/activity/me.
// The read takes no employee input, so the scope is only ever the caller's own events.
export function MyReport({
  initialLocale,
  initialFrom,
  initialTo,
}: {
  initialLocale: Locale;
  initialFrom: string;
  initialTo: string;
}) {
  const endpoint = (() => {
    const params = new URLSearchParams();
    if (initialFrom) params.set('from', initialFrom);
    if (initialTo) params.set('to', initialTo);
    const query = params.toString();
    return '/api/activity/me' + (query ? '?' + query : '');
  })();
  const { data, error, busy, surface, logout, reload } =
    useProtectedData<MyActivityReport>(endpoint);
  // The sgn-locale cookie is the rendered locale; the shell keeps it equal to the saved
  // preference (see detail.tsx).
  const locale = initialLocale;
  const text = messages[locale];
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );
  // A period with no recorded events is a real zero report, distinguishable from loading and
  // from a query failure while every requested day still appears below.
  const noActivity =
    data !== null &&
    data.rows.every(
      (row) =>
        row.pageViewEvents === 0 &&
        row.distinctPropertiesViewed === 0 &&
        row.ownerContactProperties === 0,
    );
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.myActivity}</h1>
          <p className="intro-copy">{text.myActivityNote}</p>
        </div>
        <div className="page-actions">
          <Link
            className="btn btn-secondary"
            href="/properties"
            prefetch={false}
          >
            {text.backToInventory}
          </Link>
        </div>
      </div>

      <section className="panel page-section">
        <div className="panel-body">
          <form
            className="toolbar toolbar-labelled"
            action="/activity/me"
            method="get"
          >
            <div className="field">
              <label className="field-label" htmlFor="my-report-from">
                {text.filterFrom}
              </label>
              <input
                className="input"
                id="my-report-from"
                name="from"
                type="date"
                defaultValue={initialFrom}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="my-report-to">
                {text.filterTo}
              </label>
              <input
                className="input"
                id="my-report-to"
                name="to"
                type="date"
                defaultValue={initialTo}
              />
            </div>
            <button className="btn btn-primary" type="submit">
              {text.applyFilter}
            </button>
          </form>
        </div>
      </section>

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
          <span>
            {error === 'invalid-range'
              ? text.invalidRange
              : error === 'invalid-input'
                ? text.invalidInput
                : error === 'sign-out-failed'
                  ? text.signOutFailed
                  : error === 'access-changed'
                    ? text.accessChanged
                    : text.unavailable}
          </span>
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
        {data ? (
          <>
            <section
              className="panel page-section"
              aria-labelledby="my-today-summary"
            >
              <div className="panel-head">
                <h2 id="my-today-summary">{text.todaySummary}</h2>
                <span className="panel-note num">
                  {vietnamDate(data.today)}
                </span>
              </div>
              <div className="panel-body">
                <dl className="facts">
                  <div className="fact">
                    <dt>{text.todayPageViews}</dt>
                    <dd className="num">
                      {numberFormat.format(data.todayTotals.pageViewEvents)}
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>{text.todayProperties}</dt>
                    <dd className="num">
                      {numberFormat.format(
                        data.todayTotals.distinctPropertiesViewed,
                      )}
                    </dd>
                  </div>
                  <div className="fact">
                    <dt>{text.todayOwnerContacts}</dt>
                    <dd className="num">
                      {numberFormat.format(
                        data.todayTotals.ownerContactProperties,
                      )}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="panel-foot">
                <span>{text.myActivityNote}</span>
              </div>
            </section>

            <section
              className="panel page-section"
              aria-labelledby="my-history"
            >
              <div className="panel-head">
                <h2 id="my-history">{text.companyHistory}</h2>
                <span className="panel-note num">
                  {vietnamDate(data.from)} – {vietnamDate(data.to)}
                </span>
              </div>
              <div className="panel-body">
                {noActivity ? (
                  <div className="state-panel">
                    <h3>{text.myActivityEmpty}</h3>
                  </div>
                ) : null}
                <div className="table-wrap">
                  <table className="data-table stackable">
                    <thead>
                      <tr>
                        <th scope="col">{text.todayDay}</th>
                        <th scope="col">{text.todayPageViews}</th>
                        <th scope="col">{text.todayProperties}</th>
                        <th scope="col">{text.todayOwnerContacts}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.businessDay}>
                          <th scope="row" data-label={text.todayDay}>
                            {vietnamDate(row.businessDay)}
                          </th>
                          <td className="num" data-label={text.todayPageViews}>
                            {numberFormat.format(row.pageViewEvents)}
                          </td>
                          <td className="num" data-label={text.todayProperties}>
                            {numberFormat.format(row.distinctPropertiesViewed)}
                          </td>
                          <td
                            className="num"
                            data-label={text.todayOwnerContacts}
                          >
                            {numberFormat.format(row.ownerContactProperties)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
