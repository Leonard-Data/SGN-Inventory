'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { vietnamDate } from '@/features/properties/format';
import type { CompletedSaleRanking as CompletedSaleRankingReport } from './types';

// Manager/admin completed-sale ranking. The report is derived from recorded logical
// completions; reservations, raw sold statuses and legacy attribution earn no credit and are
// reported separately rather than assigned to a guessed employee.
export function CompletedSaleRanking({
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
    return '/api/reports/completed-sales' + (query ? '?' + query : '');
  })();
  const { data, error, busy, surface, logout, reload } =
    useProtectedData<CompletedSaleRankingReport>(endpoint);
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
          <h1>{text.completedSalesRanking}</h1>
          <p className="intro-copy">{text.completedSalesNote}</p>
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
            action="/reports/completed-sales"
            method="get"
          >
            <div className="field">
              <label className="field-label" htmlFor="ranking-from">
                {text.filterFrom}
              </label>
              <input
                className="input"
                id="ranking-from"
                name="from"
                type="date"
                defaultValue={initialFrom}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ranking-to">
                {text.filterTo}
              </label>
              <input
                className="input"
                id="ranking-to"
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
                  : text.completedSalesFailed}
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
          <section
            className="panel page-section"
            aria-labelledby="completed-sales-ranking"
          >
            <div className="panel-head">
              <h2 id="completed-sales-ranking">{text.completedSales}</h2>
              <span className="panel-note num">
                {vietnamDate(data.from)} – {vietnamDate(data.to)}
              </span>
            </div>
            <div className="panel-body">
              {data.rows.length === 0 ? (
                <div className="state-panel">
                  <h3>{text.completedSalesEmpty}</h3>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table stackable">
                    <thead>
                      <tr>
                        <th scope="col">{text.rank}</th>
                        <th scope="col">{text.companyEmployee}</th>
                        <th scope="col">{text.completedSalesCount}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row) => (
                        <tr key={row.employeeId}>
                          <td className="num" data-label={text.rank}>
                            {numberFormat.format(row.rank)}
                          </td>
                          <th scope="row" data-label={text.companyEmployee}>
                            {row.employeeName}
                          </th>
                          <td
                            className="num"
                            data-label={text.completedSalesCount}
                          >
                            {numberFormat.format(row.completedSales)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="panel-foot">
              <span>
                {text.completedSalesTotal.replace(
                  '{n}',
                  numberFormat.format(data.totalCompletedSales),
                )}
              </span>
              <span>
                {text.completedSalesUnknown
                  .replace('{n}', numberFormat.format(data.unknownAttribution))
                  .replace('{date}', vietnamDate(data.today) ?? '')}
              </span>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
