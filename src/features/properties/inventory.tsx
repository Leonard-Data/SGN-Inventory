'use client';
import { useState, useCallback, type FormEvent } from 'react';
import type { Locale } from '@/i18n/messages';
import { label, messages } from '@/i18n/messages';
import type { PropertyPage } from './types';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { SessionHeader } from '@/features/employees/session-header';
import { CoverImage } from '@/features/property-files/cover-image';

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
  } = useProtectedData<PropertyPage>(endpoint);
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
      <h1 id="main-content" tabIndex={-1}>
        {text.inventory}
      </h1>
      <form action="/properties" method="get" onSubmit={search}>
        <label htmlFor="query">{text.search}</label>
        <input
          id="query"
          name="query"
          autoComplete="off"
          defaultValue={initialQuery}
          aria-describedby="search-help"
          aria-invalid={searchError}
        />
        <p id="search-help" className="muted">
          {text.searchHint}
        </p>
        <button>{text.search}</button>
      </form>
      {searchError ? <p role="alert">{text.queryTooLong}</p> : null}
      {busy ? <p role="status">{text.loading}</p> : null}
      {error ? (
        <p role="alert">
          {error === 'query-too-long'
            ? text.queryTooLong
            : error === 'sign-out-failed'
              ? text.signOutFailed
              : error === 'invalid-input'
                ? text.invalidInput
                : text.unavailable}{' '}
          <button onClick={error === 'sign-out-failed' ? logout : reload}>
            {text.retry}
          </button>
        </p>
      ) : null}
      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <>
            <p>{employee?.displayName}</p>
            {data.properties.length === 0 ? (
              <p>{text.empty}</p>
            ) : (
              <ul className="property-list">
                {data.properties.map((property) => (
                  <li className="property-card" key={property.id}>
                    <CoverImage
                      propertyId={property.id}
                      fileId={property.coverFileId}
                      locale={locale}
                      onDenied={denyFiles}
                    />
                    <h2>
                      <a
                        translate="no"
                        href={
                          '/properties/' +
                          property.id +
                          '?' +
                          new URLSearchParams({ returnTo: resultLocation })
                        }
                      >
                        {property.propertyCode}
                      </a>
                    </h2>
                    <p>
                      {text.listingMode}: {label(locale, property.listingMode)}{' '}
                      · {text.status}: {label(locale, property.status)}
                    </p>
                    {property.addresses.length ? (
                      property.addresses.map((address) => (
                        <p key={address.id}>
                          {label(locale, address.format)} ·{' '}
                          <span className="badge">
                            {label(locale, address.mappingStatus)}
                          </span>
                          <br />
                          <span translate="no">{address.addressText}</span>
                        </p>
                      ))
                    ) : (
                      <p>
                        {text.address}: {text.unknown}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <nav className="pagination" aria-label={text.inventory}>
              {previous ? (
                <a href={href(previous, cursors.slice(0, -1))}>
                  {text.previous}
                </a>
              ) : after ? (
                <a href={href(null, [])}>{text.first}</a>
              ) : null}
              {data.nextCursor ? (
                <a href={href(data.nextCursor, [...cursors, after ?? '~'])}>
                  {text.next}
                </a>
              ) : null}
            </nav>
          </>
        ) : null}
      </div>
    </main>
  );
}
