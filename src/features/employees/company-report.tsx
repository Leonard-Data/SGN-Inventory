'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { SessionHeader } from '@/features/employees/session-header';
import { vietnamDate } from '@/features/properties/format';
import type { CompanyActivityReport } from './company-report-data';

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
  const {
    employee,
    data,
    error,
    busy,
    surface,
    logout,
    applyLocale,
    clear,
    reload,
  } = useProtectedData<CompanyActivityReport>(endpoint);
  const locale = employee?.locale ?? initialLocale;
  const text = messages[locale];
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );
  return (
    <main lang={locale}>
      <a className="skip-link" href="#main-content">
        {text.skipToContent}
      </a>
      <SessionHeader
        employee={employee}
        locale={locale}
        busy={busy}
        logout={logout}
        applyLocale={applyLocale}
        clear={clear}
      />
      <section className="page-intro">
        <div>
          <p className="eyebrow">{text.title}</p>
          <h1 id="main-content" tabIndex={-1}>
            {text.companyActivity}
          </h1>
        </div>
        <p className="intro-copy">{text.companyActivityNote}</p>
      </section>
      <p>
        <Link href="/properties" prefetch={false}>
          {text.backToInventory}
        </Link>
      </p>
      <form className="report-filter" action="/activity/company" method="get">
        <label htmlFor="report-from">
          {text.filterFrom}
          <input
            id="report-from"
            name="from"
            type="date"
            defaultValue={initialFrom}
          />
        </label>
        <label htmlFor="report-to">
          {text.filterTo}
          <input
            id="report-to"
            name="to"
            type="date"
            defaultValue={initialTo}
          />
        </label>
        <button>{text.applyFilter}</button>
      </form>
      {busy ? <p role="status">{text.loading}</p> : null}
      {error ? (
        <p role="alert">
          {error === 'invalid-range'
            ? text.invalidRange
            : error === 'invalid-input'
              ? text.invalidInput
              : error === 'range-too-large'
                ? text.rangeTooLarge
                    .replace('{from}', initialFrom)
                    .replace('{to}', initialTo)
                : error === 'sign-out-failed'
                  ? text.signOutFailed
                  : text.unavailable}{' '}
          <button onClick={error === 'sign-out-failed' ? logout : reload}>
            {text.retry}
          </button>
        </p>
      ) : null}
      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <>
            <section className="panel" aria-labelledby="today-summary">
              <h2 id="today-summary">{text.todaySummary}</h2>
              <dl>
                <dt>{text.todayDay}</dt>
                <dd>{vietnamDate(data.today)}</dd>
                <dt>{text.todayPageViews}</dt>
                <dd>{numberFormat.format(data.todayTotals.pageViewEvents)}</dd>
                <dt>{text.todayProperties}</dt>
                <dd>
                  {numberFormat.format(
                    data.todayTotals.distinctPropertiesViewed,
                  )}
                </dd>
                <dt>{text.todayOwnerContacts}</dt>
                <dd>
                  {numberFormat.format(data.todayTotals.ownerContactProperties)}
                </dd>
              </dl>
            </section>
            <section className="panel" aria-labelledby="company-history">
              <h2 id="company-history">{text.companyHistory}</h2>
              {data.rows.length === 0 ? (
                <p>{text.noEmployees}</p>
              ) : (
                <div className="report-table-wrap">
                  <table className="report-table">
                    <caption>
                      {text.companyActivity} · {vietnamDate(data.from)} –{' '}
                      {vietnamDate(data.to)}
                    </caption>
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
                          <th scope="row">{row.employeeName}</th>
                          <td>{vietnamDate(row.businessDay)}</td>
                          <td>{numberFormat.format(row.pageViewEvents)}</td>
                          <td>
                            {numberFormat.format(row.distinctPropertiesViewed)}
                          </td>
                          <td>
                            {numberFormat.format(row.ownerContactProperties)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
