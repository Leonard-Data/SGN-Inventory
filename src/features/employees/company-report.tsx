'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { vietnamDate } from '@/features/properties/format';
import type { CompanyActivityReport } from './company-report-data';

// Company employee-by-day activity report (#57) extended with the employee owner-contact
// activity ranking (#34). One authenticated screen: the filter posts back to this route so the
// range stays in the URL, and both reads come from /api/activity/company. The shell provides
// the rail, topbar and skip link.
export function CompanyReport({
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
    return '/api/activity/company' + (query ? '?' + query : '');
  })();
  const { data, error, busy, surface, logout, reload } =
    useProtectedData<CompanyActivityReport>(endpoint);
  // The sgn-locale cookie is the rendered locale; the shell keeps it equal to the saved
  // preference (see detail.tsx).
  const locale = initialLocale;
  const text = messages[locale];
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.companyActivity}</h1>
          <p className="intro-copy">{text.companyActivityNote}</p>
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
            action="/activity/company"
            method="get"
          >
            <div className="field">
              <label className="field-label" htmlFor="report-from">
                {text.filterFrom}
              </label>
              <input
                className="input"
                id="report-from"
                name="from"
                type="date"
                defaultValue={initialFrom}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="report-to">
                {text.filterTo}
              </label>
              <input
                className="input"
                id="report-to"
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
                : error === 'range-too-large'
                  ? text.rankingTooLarge
                      .replace('{from}', initialFrom)
                      .replace('{to}', initialTo)
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
              aria-labelledby="today-summary"
            >
              <div className="panel-head">
                <h2 id="today-summary">{text.todaySummary}</h2>
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
                <span>{text.companyActivityNote}</span>
              </div>
            </section>

            <section
              className="panel page-section"
              aria-labelledby="company-ranking"
            >
              <div className="panel-head">
                <h2 id="company-ranking">{text.rankingTitle}</h2>
                <span className="panel-note num">
                  {vietnamDate(data.from)} – {vietnamDate(data.to)}
                </span>
              </div>
              <div className="panel-body">
                {data.ranking.length === 0 ? (
                  <div className="state-panel">
                    <h3>{text.noEmployees}</h3>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table stackable">
                      <thead>
                        <tr>
                          <th scope="col">{text.rankingRank}</th>
                          <th scope="col">{text.companyEmployee}</th>
                          <th scope="col">{text.todayOwnerContacts}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.ranking.map((row) => (
                          <tr key={row.employeeId}>
                            <td className="num" data-label={text.rankingRank}>
                              {numberFormat.format(row.rank)}
                            </td>
                            <th scope="row" data-label={text.companyEmployee}>
                              <span className="record-head">
                                <span translate="no">{row.employeeName}</span>
                                {row.employeeActive ? null : (
                                  <span
                                    className="badge badge-plain"
                                    data-tone="muted"
                                  >
                                    {text.rankingInactive}
                                  </span>
                                )}
                              </span>
                            </th>
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
                )}
              </div>
              <div className="panel-foot">
                <span>{text.rankingNote}</span>
              </div>
            </section>

            <section
              className="panel page-section"
              aria-labelledby="company-history"
            >
              <div className="panel-head">
                <h2 id="company-history">{text.companyHistory}</h2>
                <span className="panel-note num">
                  {vietnamDate(data.from)} – {vietnamDate(data.to)}
                </span>
              </div>
              <div className="panel-body">
                {data.rowsError === 'range-too-large' ? (
                  // The daily table's own payload cap: it refuses the requested employee x day
                  // scope instead of showing a short or truncated day list, while the ranking
                  // panel above keeps its independent aggregate totals.
                  <div className="state-panel" data-tone="danger">
                    <h3>
                      {text.rangeTooLarge
                        .replace('{from}', vietnamDate(data.from) ?? data.from)
                        .replace('{to}', vietnamDate(data.to) ?? data.to)}
                    </h3>
                  </div>
                ) : data.rows.length === 0 ? (
                  <div className="state-panel">
                    <h3>{text.noEmployees}</h3>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table stackable">
                      <thead>
                        <tr>
                          <th scope="col">{text.companyEmployee}</th>
                          <th scope="col">{text.todayDay}</th>
                          <th scope="col">{text.todayPageViews}</th>
                          <th scope="col">{text.todayProperties}</th>
                          <th scope="col">{text.todayOwnerContacts}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((row) => (
                          <tr key={row.employeeId + row.businessDay}>
                            <th scope="row" data-label={text.companyEmployee}>
                              {row.employeeName}
                            </th>
                            <td className="num" data-label={text.todayDay}>
                              {vietnamDate(row.businessDay)}
                            </td>
                            <td
                              className="num"
                              data-label={text.todayPageViews}
                            >
                              {numberFormat.format(row.pageViewEvents)}
                            </td>
                            <td
                              className="num"
                              data-label={text.todayProperties}
                            >
                              {numberFormat.format(
                                row.distinctPropertiesViewed,
                              )}
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
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </>
  );
}
