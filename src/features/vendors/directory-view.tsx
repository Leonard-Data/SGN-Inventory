'use client';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { mayMaintainVendors } from './directory';
import { VendorCreateForm } from './create-form';
import type { VendorCursor, VendorPage } from './types';

// People → Vendors (#73): the company directory. Every active employee reads it; the
// create panel renders only for staff/manager/admin, and the route and database refuse
// the mutation independently. Loading, empty, failure and denial stay distinct states.
export function VendorDirectory({
  initialLocale,
  query,
  before,
  beforeId,
}: {
  initialLocale: Locale;
  query: string | null;
  before: string | null;
  beforeId: string | null;
}) {
  const parameters = new URLSearchParams();
  if (query) parameters.set('query', query);
  if (before && beforeId) {
    parameters.set('before', before);
    parameters.set('beforeId', beforeId);
  }
  const suffix = parameters.toString();
  const endpoint = '/api/vendors' + (suffix ? '?' + suffix : '');
  const { employee, data, error, busy, surface, logout, reload } =
    useProtectedData<VendorPage>(endpoint);
  // The sgn-locale cookie is the rendered locale; the shell keeps it equal to the saved
  // preference.
  const locale = initialLocale;
  const text = messages[locale];
  const maintainer = employee ? mayMaintainVendors(employee.role) : false;
  function denied(status: number) {
    window.location.replace(status === 401 ? '/login' : '/access-denied');
  }
  function pageHref(cursor: VendorCursor | null) {
    const page = new URLSearchParams();
    if (query) page.set('query', query);
    if (cursor) {
      page.set('before', cursor.before);
      page.set('beforeId', cursor.beforeId);
    }
    const value = page.toString();
    return '/people/vendors' + (value ? '?' + value : '');
  }
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.people}</p>
          <h1>{text.vendorsLink}</h1>
          <p className="intro-copy">{text.vendorDirectoryNote}</p>
        </div>
      </div>

      <section className="panel page-section">
        <div className="panel-body">
          <form
            className="toolbar"
            action="/people/vendors"
            method="get"
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
              <label className="sr" htmlFor="vendor-query">
                {text.vendorSearch}
              </label>
              <input
                className="input"
                id="vendor-query"
                name="query"
                type="search"
                autoComplete="off"
                maxLength={120}
                defaultValue={query ?? ''}
                placeholder={text.vendorSearch}
              />
              <button
                className="search-btn"
                type="submit"
                aria-label={text.vendorSearch}
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
          </form>
          <p className="search-hint">{text.vendorSearchHint}</p>
        </div>
      </section>

      {maintainer ? (
        <section className="panel page-section" aria-labelledby="vendor-create">
          <div className="panel-head">
            <h2 id="vendor-create">{text.vendorCreate}</h2>
            <span className="panel-note">{text.vendorCreateNote}</span>
          </div>
          <div className="panel-body">
            <VendorCreateForm locale={locale} onDenied={denied} />
          </div>
        </section>
      ) : (
        <p className="panel-note">{text.vendorMaintainerOnly}</p>
      )}

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
            {error === 'invalid-input'
              ? text.invalidInput
              : error === 'sign-out-failed'
                ? text.signOutFailed
                : text.vendorDirectoryFailed}
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
            aria-labelledby="vendor-directory"
          >
            <div className="panel-head">
              <h2 id="vendor-directory">{text.vendorDirectory}</h2>
            </div>
            <div className="panel-body">
              {data.vendors.length === 0 ? (
                <div className="state-panel">
                  <h3>
                    {query
                      ? text.vendorDirectoryEmptyQuery
                      : text.vendorDirectoryEmpty}
                  </h3>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table stackable">
                    <thead>
                      <tr>
                        <th scope="col">{text.vendorCompanyName}</th>
                        <th scope="col">{text.vendorContactName}</th>
                        <th scope="col">{text.vendorPhones}</th>
                        <th scope="col">{text.email}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.vendors.map((vendor) => (
                        <tr key={vendor.id}>
                          <th scope="row" data-label={text.vendorCompanyName}>
                            <Link
                              href={'/people/vendors/' + vendor.id}
                              prefetch={false}
                            >
                              {vendor.displayName}
                            </Link>
                          </th>
                          <td data-label={text.vendorContactName}>
                            {vendor.contactName ?? (
                              <span className="is-unknown">{text.unknown}</span>
                            )}
                          </td>
                          <td data-label={text.vendorPhones}>
                            {vendor.phones?.length ? (
                              <span className="num">
                                {vendor.phones.join(' · ')}
                              </span>
                            ) : (
                              <span className="is-unknown">{text.unknown}</span>
                            )}
                          </td>
                          <td data-label={text.email}>
                            {vendor.email ?? (
                              <span className="is-unknown">{text.unknown}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {data.vendors.length > 0 || before ? (
              <div className="panel-foot">
                <nav className="pagination" aria-label={text.vendorDirectory}>
                  <span className="page-info">
                    {text.vendorPageInfo.replace(
                      '{n}',
                      String(data.vendors.length),
                    )}
                  </span>
                  <span className="page-buttons">
                    {before ? (
                      <Link
                        className="pager-btn"
                        href={pageHref(null)}
                        prefetch={false}
                      >
                        {text.first}
                      </Link>
                    ) : null}
                    {data.nextCursor ? (
                      <a className="pager-btn" href={pageHref(data.nextCursor)}>
                        {text.next}
                      </a>
                    ) : null}
                  </span>
                </nav>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </>
  );
}
