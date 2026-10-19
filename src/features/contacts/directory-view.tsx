'use client';
import Link from 'next/link';
import { useCallback, useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { optionLabel } from '@/features/property-maintenance/messages';
import { ContactEditorDrawer } from './editor-drawer';
import type { ContactPage, ContactSummary } from './types';

function phoneText(record: ContactSummary): string | null {
  return record.phones.length ? record.phones.join(' · ') : record.rawPhoneText;
}

export function ContactDirectory({
  initialLocale,
  query,
  after,
  view,
}: {
  initialLocale: Locale;
  query: string | null;
  after: string | null;
  view: string | null;
}) {
  const parameters = new URLSearchParams();
  if (query) parameters.set('query', query);
  if (after) parameters.set('after', after);
  // Unknown views still reach the guarded read and are refused, never silently replaced.
  if (view) parameters.set('view', view);
  const suffix = parameters.toString();
  const endpoint = '/api/contacts' + (suffix ? '?' + suffix : '');
  const { data, error, busy, surface, logout, reload, employee } =
    useProtectedData<ContactPage>(endpoint);
  const staff =
    employee !== null && ['staff', 'manager', 'admin'].includes(employee.role);
  const locale = initialLocale;
  const text = messages[locale];
  const [opened, setOpened] = useState<{
    endpoint: string;
    id: string;
    opener: HTMLElement;
  } | null>(null);
  const selected =
    opened?.endpoint === endpoint
      ? data?.contacts.find((record) => record.id === opened.id)
      : null;
  const ownersView = view === 'owners';
  const denied = useCallback((status: number) => {
    window.location.replace(status === 401 ? '/login' : '/access-denied');
  }, []);
  function href(next: {
    query: string | null;
    after: string | null;
    view: string | null;
  }) {
    const page = new URLSearchParams();
    if (next.query) page.set('query', next.query);
    if (next.after) page.set('after', next.after);
    if (next.view === 'owners') page.set('view', 'owners');
    const value = page.toString();
    return '/people/contacts' + (value ? '?' + value : '');
  }
  const emptyMessage = query
    ? ownersView
      ? text.contactOwnersEmptyQuery
      : text.contactDirectoryEmptyQuery
    : ownersView
      ? text.contactOwnersEmpty
      : text.contactDirectoryEmpty;
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <h1 id="contact-directory">
            {ownersView ? text.contactViewOwners : text.contactsLink}
          </h1>
          <p className="intro-copy">
            {data
              ? text.contactPageInfo.replace(
                  '{n}',
                  String(data.contacts.length),
                )
              : text.contactDirectoryNote}
          </p>
        </div>
      </div>
      <section className="panel page-section">
        <div className="panel-body">
          <nav className="tabs" aria-label={text.contactViews}>
            <Link
              className="tab"
              href={href({ query, after: null, view: 'all' })}
              aria-current={ownersView ? undefined : 'page'}
              prefetch={false}
            >
              {text.contactViewAll}
            </Link>
            <Link
              className="tab"
              href={href({ query, after: null, view: 'owners' })}
              aria-current={ownersView ? 'page' : undefined}
              prefetch={false}
            >
              {text.contactViewOwners}
            </Link>
          </nav>
          <form
            className="toolbar"
            action="/people/contacts"
            method="get"
            role="search"
          >
            {ownersView ? (
              <input type="hidden" name="view" value="owners" />
            ) : null}
            <div className="search">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20.5 20.5 16.7 16.7" />
              </svg>
              <label className="sr" htmlFor="contact-query">
                {text.contactSearch}
              </label>
              <input
                className="input"
                id="contact-query"
                name="query"
                type="search"
                autoComplete="off"
                maxLength={120}
                defaultValue={query ?? ''}
                placeholder={text.contactSearch}
              />
              <button
                className="search-btn"
                type="submit"
                aria-label={text.contactSearch}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20.5 20.5 16.7 16.7" />
                </svg>
              </button>
            </div>
          </form>
          <p className="search-hint">{text.contactSearchHint}</p>
        </div>
      </section>
      {error ? (
        <div
          className="alert"
          data-tone={error === 'invalid-input' ? 'neutral' : 'danger'}
          role="alert"
        >
          <span>
            {error === 'invalid-input'
              ? text.invalidInput
              : error === 'sign-out-failed'
                ? text.signOutFailed
                : error === 'access-changed'
                  ? text.accessChanged
                  : text.contactDirectoryFailed}
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
        <LoadingSkeleton
          label={text.loading}
          className="panel page-section"
          shape="table"
          rows={6}
          columns={5}
        />
      ) : null}
      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <section
            className="panel page-section"
            aria-labelledby="contact-directory"
          >
            <div className="panel-body">
              {!data.contacts.length ? (
                <div className="state-panel">
                  <h3>{emptyMessage}</h3>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table stackable contacts-table">
                    <thead>
                      <tr>
                        <th scope="col">{text.contactColumnName}</th>
                        <th scope="col">{text.contactColumnRelation}</th>
                        <th scope="col">{text.contactColumnPhone}</th>
                        <th scope="col">{text.contactColumnProperties}</th>
                        <th className="cell-actions" scope="col">
                          {text.contactColumnActions}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.contacts.map((record) => (
                        <tr key={record.id}>
                          <th scope="row" data-label={text.contactColumnName}>
                            <span className="cell-person">
                              <span
                                className="sgn-avatar sgn-avatar-sm"
                                aria-hidden="true"
                              >
                                {[
                                  ...record.displayName.trim(),
                                ][0]?.toUpperCase() ?? '?'}
                              </span>
                              <span>
                                <b translate="no">{record.displayName}</b>
                                <small className="row-meta">
                                  {optionLabel(locale, record.contactType)}
                                </small>
                              </span>
                            </span>
                          </th>
                          <td data-label={text.contactColumnRelation}>
                            {record.links.length ? (
                              [
                                ...new Set(
                                  record.links.map((link) => link.relation),
                                ),
                              ].map((relation) => (
                                <span
                                  key={relation}
                                  className="badge badge-plain"
                                  data-tone="neutral"
                                >
                                  {optionLabel(locale, relation)}
                                </span>
                              ))
                            ) : (
                              <span className="is-unknown">{text.unknown}</span>
                            )}
                          </td>
                          <td data-label={text.contactColumnPhone}>
                            {phoneText(record) === null ? (
                              <span className="is-unknown">{text.unknown}</span>
                            ) : (
                              <span className="num" translate="no">
                                {phoneText(record)}
                              </span>
                            )}
                          </td>
                          <td data-label={text.contactColumnProperties}>
                            {record.links.length ? (
                              <span className="contact-links">
                                <small className="row-meta">
                                  {text.contactPropertyCount.replace(
                                    '{n}',
                                    String(record.propertyCount),
                                  )}
                                </small>
                                {record.links.map((link) => (
                                  <span
                                    className="contact-link"
                                    key={link.propertyId}
                                  >
                                    <Link
                                      className="link"
                                      href={'/properties/' + link.propertyId}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      translate="no"
                                      prefetch={false}
                                    >
                                      {link.propertyCode}
                                    </Link>
                                    <small className="row-meta">
                                      {optionLabel(locale, link.relation)}
                                      {link.isPrimary
                                        ? ' · ' + text.contactPrimaryLink
                                        : ''}
                                      {link.archived
                                        ? ' · ' + text.archived
                                        : ''}
                                    </small>
                                  </span>
                                ))}
                              </span>
                            ) : (
                              <span className="is-unknown">
                                {text.contactNoProperties}
                              </span>
                            )}
                          </td>
                          <td
                            className="cell-actions"
                            data-label={text.contactColumnActions}
                          >
                            {record.links.length || staff ? (
                              <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                aria-haspopup="dialog"
                                onClick={(event) =>
                                  setOpened({
                                    endpoint,
                                    id: record.id,
                                    opener: event.currentTarget,
                                  })
                                }
                              >
                                {text.contactOpen}
                              </button>
                            ) : (
                              <span className="row-meta">
                                {text.contactUnlinkedNote}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {data.contacts.length > 0 || after ? (
              <div className="panel-foot">
                <nav className="pagination" aria-label={text.contactDirectory}>
                  <span className="page-info">
                    {text.contactPageInfo.replace(
                      '{n}',
                      String(data.contacts.length),
                    )}
                  </span>
                  <span className="page-buttons">
                    {after ? (
                      <Link
                        className="pager-btn"
                        href={href({ query, after: null, view })}
                        prefetch={false}
                      >
                        {text.first}
                      </Link>
                    ) : null}
                    {data.nextCursor ? (
                      <Link
                        className="pager-btn"
                        href={href({ query, after: data.nextCursor, view })}
                        prefetch={false}
                      >
                        {text.next}
                      </Link>
                    ) : null}
                  </span>
                </nav>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      {selected && !busy ? (
        <ContactEditorDrawer
          key={selected.id}
          record={selected}
          locale={locale}
          opener={opened?.opener ?? null}
          onClose={() => setOpened(null)}
          onDenied={denied}
          onSaved={reload}
        />
      ) : null}
    </>
  );
}
