'use client';
import { useState, useCallback, useMemo, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import type { PropertyPage } from './types';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { SkeletonCards } from '@/features/skeleton';
import { PropertyCard } from './property-card';
import { SearchIsland } from './search-island';
import {
  activeFilterCount,
  filterParams,
  type InventoryFilters,
} from './filters';
import {
  inventoryPageCount,
  isInventoryOrder,
  reversedOrder,
  INVENTORY_PAGE_SIZES,
  type InventoryOrder,
  type InventoryPageSize,
} from './paging';

export function Inventory({
  initialLocale,
  initialQuery,
  page,
  sort,
  filters,
  pageSize,
}: {
  initialLocale: Locale;
  initialQuery: string;
  page: string | null;
  pageSize: string | null;
  sort: string | null;
  filters: InventoryFilters;
}) {
  const activeOrder = isInventoryOrder(sort) ? sort : null;
  const router = useRouter();
  // The filters the address states travel with every read of this view: the free-text search,
  // the ordering, the paging links and the search island all carry the same set.
  const activeFilters = filterParams(filters);
  const endpoint =
    '/api/properties?' +
    new URLSearchParams({
      query: initialQuery,
      ...(sort ? { sort } : {}),
      ...(page ? { page } : {}),
      ...(pageSize ? { pageSize } : {}),
      ...activeFilters,
    });
  const { employee, data, error, busy, surface, logout, clear, reload } =
    useProtectedData<PropertyPage>(endpoint);
  // From the sgn-locale cookie the page resolved server-side, so the language switch
  // re-renders this body after its refresh (see detail.tsx).
  const locale = initialLocale;
  const text = messages[locale];
  const [searchError, setSearchError] = useState(false);
  // The toolbar owns the filter panel's trigger, so the island below only renders the dialog.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const denyFiles = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  // The read states the matching total and the page it served, so the count and the pager
  // describe that same result set rather than counting the rows this page happens to hold.
  const total = data?.total ?? 0;
  const servedPage = data?.page ?? 1;
  const activePageSize = Number(pageSize) || 24;
  const pages = inventoryPageCount(total, activePageSize);
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );
  function search(event: FormEvent<HTMLFormElement>) {
    const query = new FormData(event.currentTarget).get('query');
    if (typeof query !== 'string' || [...query].length > 120) {
      event.preventDefault();
      setSearchError(true);
    } else {
      setSearchError(false);
    }
  }
  // Every pager link carries the same search, filters and ordering, so moving between pages never
  // changes which result set is being paged; an absent page is page one.
  function href(target: number) {
    return (
      '/properties?' +
      new URLSearchParams({
        query: initialQuery,
        ...(sort ? { sort } : {}),
        ...(pageSize ? { pageSize } : {}),
        ...activeFilters,
        ...(target > 1 ? { page: String(target) } : {}),
      })
    );
  }
  // Switching order starts at page one; the ordering never rewrites the search or the filters.
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
  const resultLocation = href(servedPage);
  function step(label: string, target: number, disabled: boolean) {
    return disabled ? (
      <span className="pager-link is-disabled" aria-disabled="true">
        {label}
      </span>
    ) : (
      <a className="pager-link" href={href(target)}>
        {label}
      </a>
    );
  }
  const orders: { value: InventoryOrder | null; label: string }[] = [
    { value: null, label: text.sortDefault },
    { value: 'oldest', label: text.sortOldest },
    { value: 'newest', label: text.sortNewest },
  ];
  const reversed = reversedOrder(activeOrder);
  const filterCount = activeFilterCount(filters);
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.inventory}</h1>
          <p className="intro-copy">{text.searchHint}</p>
        </div>
        <div className="page-actions">
          <Link
            className="btn btn-primary"
            href="/properties/new"
            prefetch={false}
          >
            <span aria-hidden="true">＋</span>
            {text.navNewProperty}
          </Link>
          {employee?.role === 'manager' || employee?.role === 'admin' ? (
            <Link
              className="btn btn-ghost"
              href="/activity/company"
              prefetch={false}
            >
              {text.companyActivityLink}
            </Link>
          ) : null}
        </div>
      </div>

      <section className="panel page-section">
        <div className="panel-body">
          <div className="toolbar">
            <form
              className="toolbar-search"
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
            </form>
            <label className="sr" htmlFor="inventory-sort">
              {text.sortLabel}
            </label>
            <select
              id="inventory-sort"
              className="select toolbar-sort"
              key={sort ?? 'default'}
              defaultValue={sort ?? ''}
              onChange={(event) => {
                const next = event.currentTarget.value;
                router.push(orderHref(isInventoryOrder(next) ? next : null));
              }}
            >
              {orders.map((order) => (
                <option
                  key={order.value ?? 'default'}
                  value={order.value ?? ''}
                >
                  {order.label}
                </option>
              ))}
            </select>
            {reversed ? (
              <Link
                className="btn btn-secondary btn-sm toolbar-dir"
                href={orderHref(reversed)}
                prefetch={false}
                title={`${text.orderReverse}: ${reversed === 'oldest' ? text.sortOldest : text.sortNewest}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 20V6M8 6 5 9M8 6l3 3" />
                  <path d="M16 4v14M16 18l3-3M16 18l-3-3" />
                </svg>
                {reversed === 'oldest' ? text.sortOldest : text.sortNewest}
              </Link>
            ) : (
              <button
                className="btn btn-secondary btn-sm toolbar-dir"
                type="button"
                disabled
                title={text.orderReverseHint}
                aria-label={`${text.orderReverse}: ${text.orderReverseHint}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M8 20V6M8 6 5 9M8 6l3 3" />
                  <path d="M16 4v14M16 18l3-3M16 18l-3-3" />
                </svg>
                {text.orderReverse}
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => setFiltersOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              aria-controls="inventory-filters"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 5h16l-6.2 7.4V19l-3.6-1.8v-4.8L4 5z" />
              </svg>
              {text.filters}
              {filterCount ? (
                <span className="badge" data-tone="neutral">
                  {filterCount}
                </span>
              ) : null}
            </button>
          </div>
          <SearchIsland
            locale={locale}
            query={initialQuery}
            sort={sort}
            filters={filters}
            open={filtersOpen}
            onOpen={setFiltersOpen}
            onDenied={denyFiles}
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

      {busy ? <SkeletonCards label={text.loading} /> : null}

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
                      : error === 'access-changed'
                        ? text.accessChanged
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
                    {text.inventoryMatchCount.replace(
                      '{total}',
                      numberFormat.format(data.total),
                    )}
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
                  {text.pageOf
                    .replace('{page}', numberFormat.format(servedPage))
                    .replace('{pages}', numberFormat.format(pages))}
                </span>
                <span className="page-buttons">
                  <label className="page-size-control">
                    <span>{text.pageSize}</span>
                    <select
                      value={String(activePageSize)}
                      onChange={(event) => {
                        const next = Number(
                          event.currentTarget.value,
                        ) as InventoryPageSize;
                        const nextUrl = new URL(window.location.href);
                        nextUrl.searchParams.set('pageSize', String(next));
                        nextUrl.searchParams.delete('page');
                        router.push(nextUrl.pathname + nextUrl.search);
                      }}
                      aria-label={text.pageSize}
                    >
                      {INVENTORY_PAGE_SIZES.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </label>
                  {step(`‹ ${text.previous}`, servedPage - 1, servedPage === 1)}
                  {step(`${text.next} ›`, servedPage + 1, servedPage === pages)}
                </span>
              </nav>
            </>
          ) : null}
        </div>
      </section>
    </>
  );
}
