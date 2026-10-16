'use client';
import { useState, useCallback, type FormEvent } from 'react';
import Link from 'next/link';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import type { PropertyPage } from './types';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { PropertyCard } from './property-card';
import { SearchIsland } from './search-island';
import {
  activeFilterCount,
  filterParams,
  type InventoryFilters,
} from './filters';
import {
  isInventoryOrder,
  validTrailToken,
  type InventoryOrder,
} from './age-cursor';

export function Inventory({
  initialLocale,
  initialQuery,
  after,
  trail,
  sort,
  filters,
}: {
  initialLocale: Locale;
  initialQuery: string;
  after: string | null;
  trail: string;
  sort: string | null;
  filters: InventoryFilters;
}) {
  const activeOrder = isInventoryOrder(sort) ? sort : null;
  // The filters the address states travel with every read of this view: the free-text search,
  // the ordering, the paging links and the search island all carry the same set.
  const activeFilters = filterParams(filters);
  const endpoint =
    '/api/properties?' +
    new URLSearchParams({
      query: initialQuery,
      ...(sort ? { sort } : {}),
      ...(after ? { after } : {}),
      ...activeFilters,
    });
  const { employee, data, error, busy, surface, logout, clear, reload } =
    useProtectedData<PropertyPage>(endpoint);
  // From the sgn-locale cookie the page resolved server-side, so the language switch
  // re-renders this body after its refresh (see detail.tsx).
  const locale = initialLocale;
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
    ? trail.split(',').filter((cursor) => validTrailToken(activeOrder, cursor))
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
        ...(sort ? { sort } : {}),
        ...activeFilters,
        ...(cursor && cursor !== '~' ? { after: cursor } : {}),
        ...(cursorTrail.length ? { trail: cursorTrail.join(',') } : {}),
      })
    );
  }
  // Switching order starts a new page-one journey; the ordering never rewrites the search or
  // the filters.
  function orderHref(next: InventoryOrder | null) {
    return (
      '/properties?' +
      new URLSearchParams({
        query: initialQuery,
        ...(next ? { sort: next } : {}),
        ...activeFilters,
      })
    );
  }
  const resultLocation = href(after, cursors);
  const orders: { value: InventoryOrder | null; label: string }[] = [
    { value: null, label: text.sortDefault },
    { value: 'oldest', label: text.sortOldest },
    { value: 'newest', label: text.sortNewest },
  ];
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.inventory}</h1>
          <p className="intro-copy">{text.searchHint}</p>
        </div>
        {employee?.role === 'manager' || employee?.role === 'admin' ? (
          <div className="page-actions">
            <Link
              className="btn btn-secondary"
              href="/activity/company"
              prefetch={false}
            >
              {text.companyActivityLink}
            </Link>
          </div>
        ) : null}
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
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20.5 20.5 16.7 16.7" />
              </svg>
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
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20.5 20.5 16.7 16.7" />
                </svg>
              </button>
            </div>
            {sort ? <input type="hidden" name="sort" value={sort} /> : null}
            {Object.entries(activeFilters).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <div className="seg" role="group" aria-label={text.sortLabel}>
              {orders.map((order) => (
                <a
                  key={order.value ?? 'default'}
                  className="seg-btn"
                  href={orderHref(order.value)}
                  aria-current={
                    activeOrder === order.value ? 'true' : undefined
                  }
                >
                  {order.label}
                </a>
              ))}
            </div>
          </form>
          <SearchIsland
            locale={locale}
            query={initialQuery}
            sort={sort}
            filters={filters}
          />
          <p className="search-hint">{text.searchHint}</p>
          {sort ? <p className="search-hint">{text.ageHint}</p> : null}
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
                    <h3>
                      {activeFilterCount(filters)
                        ? text.emptyFiltered
                        : text.empty}
                    </h3>
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
                      showEntry={Boolean(data.order)}
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
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
