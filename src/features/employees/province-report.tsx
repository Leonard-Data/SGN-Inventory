'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { vietnamDate } from '@/features/properties/format';
import { activityLevel } from './activity-level';
import type { ProvinceActivityReport } from './province-report-data';

// Province owner-contact activity (#35). One authenticated screen for manager/admin: the
// filter posts back to this route so the range stays in the URL, and the table itself is read
// through /api/activity/provinces. The database rechecks the live role, so an ordinary
// employee cannot reach the same read by navigating directly or changing the filters.
const levelKeys = {
  none: 'activityLevelNone',
  low: 'activityLevelLow',
  medium: 'activityLevelMedium',
  high: 'activityLevelHigh',
} as const;

export function ProvinceReport({
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
    return '/api/activity/provinces' + (query ? '?' + query : '');
  })();
  const { data, error, busy, surface, logout, reload } =
    useProtectedData<ProvinceActivityReport>(endpoint);
  // The sgn-locale cookie is the rendered locale; the shell keeps it equal to the saved
  // preference (see detail.tsx).
  const locale = initialLocale;
  const text = messages[locale];
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );
  // Bands compare groups inside this period only, so the largest group is the scale.
  const largest = data
    ? data.rows.reduce(
        (top, row) => Math.max(top, row.ownerContactProperties),
        0,
      )
    : 0;
  // A genuinely empty period is a real zero report, not a failure: the Unverified group still
  // appears with its zero and the note above the table says so explicitly.
  const empty = data !== null && data.total === 0;
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.provinceActivity}</h1>
          <p className="intro-copy">{text.provinceActivityNote}</p>
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
            action="/activity/provinces"
            method="get"
          >
            <div className="field">
              <label className="field-label" htmlFor="province-report-from">
                {text.filterFrom}
              </label>
              <input
                className="input"
                id="province-report-from"
                name="from"
                type="date"
                defaultValue={initialFrom}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="province-report-to">
                {text.filterTo}
              </label>
              <input
                className="input"
                id="province-report-to"
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
          <section className="panel page-section" aria-labelledby="province-at">
            <div className="panel-head">
              <h2 id="province-at">{text.provinceActivityLink}</h2>
              <span className="panel-note num">
                {vietnamDate(data.from)} – {vietnamDate(data.to)}
              </span>
            </div>
            <div className="panel-body">
              {empty ? (
                <p className="panel-note" role="status">
                  {text.provinceActivityEmpty}
                </p>
              ) : null}
              <div className="table-wrap">
                <table className="data-table stackable">
                  <thead>
                    <tr>
                      <th scope="col">{text.provinceColumn}</th>
                      <th scope="col">{text.provinceOwnerContact}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => {
                      const level = activityLevel(
                        row.ownerContactProperties,
                        largest,
                      );
                      return (
                        <tr key={row.provinceUnitId ?? 'unverified'}>
                          <th scope="row" data-label={text.provinceColumn}>
                            {row.provinceUnitId === null
                              ? text.unverifiedLocation
                              : row.provinceName}
                            {row.officialCode ? (
                              <small className="num">{row.officialCode}</small>
                            ) : null}
                          </th>
                          <td
                            className="num activity-cell"
                            data-num
                            data-level={level}
                            data-label={text.provinceOwnerContact}
                          >
                            <b>
                              {numberFormat.format(row.ownerContactProperties)}
                            </b>
                            <small>{text[levelKeys[level]]}</small>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="panel-foot">
              <span>
                {text.provinceActivityTotal}{' '}
                <span className="num">{numberFormat.format(data.total)}</span> ·{' '}
                {text.provinceActivityCountsFrom}
              </span>
              <br />
              <span>{text.provinceActivityBands}</span>
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
