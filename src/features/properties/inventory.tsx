'use client';
import { useState, useCallback, type FormEvent } from 'react';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import type { PropertyPage } from './types';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { PropertyCard } from './property-card';
import { CreateProperty } from '@/features/property-maintenance/create';
import { CorrectionQueue } from '@/features/corrections/queue';

export function Inventory({
  initialLocale,
  initialQuery,
  after,
  trail,
}: {
  initialLocale: Locale;
  initialQuery: string;
  after: string | null;
  trail: string;
}) {
  const endpoint =
    '/api/properties?' +
    new URLSearchParams({ query: initialQuery, ...(after ? { after } : {}) });
  const { employee, data, error, busy, surface, logout, clear, reload } =
    useProtectedData<PropertyPage>(endpoint);
  const locale = employee?.locale ?? initialLocale;
  const text = messages[locale];
  const [searchError, setSearchError] = useState(false);
  const denyFiles = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  const cursors = trail
    ? trail
        .split(',')
        .filter((cursor) => cursor === '~' || /^[0-9a-f-]{36}$/i.test(cursor))
    : [];
  const previous = cursors[cursors.length - 1];
  function search(event: FormEvent<HTMLFormElement>) {
    const query = new FormData(event.currentTarget).get('query');
    if (typeof query !== 'string' || [...query].length > 120) {
      event.preventDefault();
      setSearchError(true);
    } else {
      setSearchError(false);
    }
  }
  function href(cursor: string | null, cursorTrail: string[]) {
    return (
      '/properties?' +
      new URLSearchParams({
        query: initialQuery,
        ...(cursor && cursor !== '~' ? { after: cursor } : {}),
        ...(cursorTrail.length ? { trail: cursorTrail.join(',') } : {}),
      })
    );
  }
  const resultLocation = href(after, cursors);
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.inventory}</h1>
          <p className="intro-copy">{text.searchHint}</p>
        </div>
      </div>

      <section className="panel page-section">
        <div className="panel-body">
          <form
            className="toolbar"
            action="/properties"
            method="get"
            onSubmit={search}
            role="search"
          >
            <div className="search">
              <label className="sr" htmlFor="query">
                {text.search}
              </label>
              <input
                className="input"
                id="query"
                name="query"
                type="search"
                autoComplete="off"
                defaultValue={initialQuery}
                aria-invalid={searchError}
                placeholder={text.search}
              />
              <button
                className="search-btn"
                type="submit"
                aria-label={text.search}
              >
                {text.search}
              </button>
            </div>
          </form>
          <p className="search-hint">{text.searchHint}</p>
          {searchError ? (
            <p className="search-hint" role="alert">
              {text.queryTooLong}
            </p>
          ) : null}
        </div>
      </section>

      {busy ? (
        <div className="busy-head" role="status">
          <div className="busy-bar" />
          <div className="busy-line">
            <span className="spinner" aria-hidden="true" />
            <span>{text.loading}</span>
          </div>
        </div>
      ) : null}

      <section className="page-section">
        {error ? (
          <div className="panel">
            <div className="state-panel" data-tone="danger">
              <span className="state-mark" aria-hidden="true">
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 4 3 20h18L12 4z" />
                  <path d="M12 10v4" />
                  <path d="M12 17h.01" />
                </svg>
              </span>
              <h3>
                {error === 'query-too-long'
                  ? text.queryTooLong
                  : error === 'sign-out-failed'
                    ? text.signOutFailed
                    : error === 'invalid-input'
                      ? text.invalidInput
                      : text.unavailable}
              </h3>
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={error === 'sign-out-failed' ? logout : reload}
              >
                {text.retry}
              </button>
            </div>
          </div>
        ) : null}

        <div ref={surface} hidden={!data || busy}>
          {data ? (
            <>
              <div className="row-between">
                <p className="result-line">
                  <b>
                    {data.properties.length} {text.inventory}
                  </b>
                </p>
              </div>

              {data.properties.length === 0 ? (
                <div className="panel">
                  <div className="state-panel">
                    <span className="state-mark" aria-hidden="true">
                      <svg
                        viewBox="0 0 24 24"
                        width="26"
                        height="26"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <path d="M20.5 20.5 16.7 16.7" />
                      </svg>
                    </span>
                    <h3>{text.empty}</h3>
                  </div>
                </div>
              ) : (
                <div className="property-list" data-view="cards">
                  {data.properties.map((record) => (
                    <PropertyCard
                      key={record.id}
                      record={record}
                      locale={locale}
                      resultLocation={resultLocation}
                      onDenied={denyFiles}
                    />
                  ))}
                </div>
              )}

              <nav className="pagination" aria-label={text.inventory}>
                <span className="page-info">
                  {after ? text.previous : text.first}
                </span>
                <span className="page-buttons">
                  {previous ? (
                    <a
                      className="pager-btn"
                      href={href(previous, cursors.slice(0, -1))}
                    >
                      {text.previous}
                    </a>
                  ) : after ? (
                    <a className="pager-btn" href={href(null, [])}>
                      {text.first}
                    </a>
                  ) : null}
                  {data.nextCursor ? (
                    <a
                      className="pager-btn"
                      href={href(data.nextCursor, [...cursors, after ?? '~'])}
                    >
                      {text.next}
                    </a>
                  ) : null}
                </span>
              </nav>

              {employee ? (
                <>
                  <CreateProperty locale={locale} onDenied={denyFiles} />
                  <CorrectionQueue
                    employee={employee}
                    locale={locale}
                    onDenied={denyFiles}
                  />
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
