'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { renderedSession } from '@/features/employees/protected-load';
import { useProtectedData } from '@/features/employees/use-protected-data';
import type { EmployeeSession } from '@/features/employees/types';
import {
  StreamGap,
  StreamTableChunk,
} from '@/features/stream/stream-table-chunk';
import { useCursorWindow } from '@/features/stream/use-cursor-read';
import { useStreamLayout } from '@/features/stream/use-stream-layout';
import { useWindowStream } from '@/features/stream/use-windows';
import {
  STREAM_CHUNK_ROWS,
  streamChunkRows,
  streamKnownRows,
  streamWindows,
} from '@/features/stream/window';
import { LoadingSkeleton } from '@/features/skeleton';
import { optionLabel } from '@/features/property-maintenance/messages';
import { ContactEditorDrawer } from './editor-drawer';
import { CONTACT_PAGE_SIZE } from './directory';
import { contactWindow } from './window';
import type { ContactSummary } from './types';

function phoneText(record: ContactSummary): string | null {
  return record.phones.length ? record.phones.join(' · ') : record.rawPhoneText;
}

// The columns of the directory table, and therefore the span of a reserved chunk's row.
const COLUMNS = 5;

// People → Contacts (#71): the shared-identity directory, its Owners view and the drawer that
// corrects the shared contact. An Owner is a Contact linked to a Property with `relation = owner`;
// the identity's general classification never decides it. The drawer opens the same detail read
// and the same correction operation the property maintenance workspace uses, so the affected-set
// preview, the revision check and the object-level refusal are the same ones. Loading, empty,
// no-match, failure and object-level refusal stay distinct, and the protected surface clears on
// sign-out or lost membership.
export function ContactDirectory({
  initialLocale,
  query,
  view,
}: {
  initialLocale: Locale;
  query: string | null;
  view: string | null;
}) {
  const parameters = new URLSearchParams();
  if (query) parameters.set('query', query);
  // Unknown views still reach the guarded read and are refused, never silently replaced.
  if (view) parameters.set('view', view);
  const suffix = parameters.toString();
  // One read of the directory as a stream: the search and the recorded view travel with every
  // window, and a different search or view is a different stream that starts at the first window.
  const endpoint = '/api/contacts' + (suffix ? '?' + suffix : '');
  // The session is this surface's own protection: the stream below reads nothing until the
  // session has answered, and the contact read stays the same bounded member read it was.
  const {
    employee,
    error: sessionError,
    busy,
    surface,
    logout,
    clear,
    reload,
  } = useProtectedData<EmployeeSession>('/api/session');
  const denied = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  const source = employee ? endpoint : null;
  const readWindow = useCursorWindow<ContactSummary>({
    source,
    pageSize: CONTACT_PAGE_SIZE,
    page: contactWindow,
  });
  const stream = useWindowStream<ContactSummary>({
    source,
    identity: employee ? renderedSession(employee) : 'no-session',
    readWindow,
    onDenied: denied,
  });
  const { request, retry, refresh } = stream;
  // The rows the stream accounts for: what its reads have reached, plus the window it is about to
  // fetch, so the chunks that window fills are reserved - as a skeleton sized to its rows, in the
  // space those rows land on - before it arrives.
  const rows = streamKnownRows(
    stream.loaded,
    stream.more === true,
    CONTACT_PAGE_SIZE,
  );
  const ready = stream.more !== null;
  const [container, layout] = useStreamLayout({
    active: ready && !busy,
    rows,
    chunkRows: STREAM_CHUNK_ROWS,
    resultSet: endpoint,
  });
  const needed = useMemo(
    () =>
      streamWindows({
        first: layout.band.first,
        last: layout.band.last,
        total: rows,
        chunkRows: STREAM_CHUNK_ROWS,
        pageSize: CONTACT_PAGE_SIZE,
      }),
    [layout.band.first, layout.band.last, rows],
  );
  // The band asks the stream for the windows it would show. Near the end of the loaded contacts
  // the band holds the chunk the next window fills, so the next window is read without a button
  // press, and only the rows near the viewport stay in the page however deep the scroll goes.
  useEffect(() => {
    if (!ready) return;
    request(needed, layout.band.top);
  }, [request, needed, layout.band.top, ready]);
  // Unlinked-identity correction from the directory is staff/manager/admin authority
  // (ticket #72); every other role still sees only the linked-identity editor.
  const staff =
    employee !== null && ['staff', 'manager', 'admin'].includes(employee.role);
  // The sgn-locale cookie is the rendered locale; the shell keeps it equal to the saved
  // preference.
  const locale = initialLocale;
  const text = messages[locale];
  const [opened, setOpened] = useState<{
    id: string;
    opener: HTMLElement;
  } | null>(null);
  // The record the drawer edits: the rows the stream has loaded, since only a drawn row can open
  // the drawer, and a new search or view replaces every window and closes it.
  const selected = opened
    ? ([...stream.windows.values()]
        .flat()
        .find((record) => record.id === opened.id) ?? null)
    : null;
  const ownersView = view === 'owners';
  function href(next: { query: string | null; view: string | null }) {
    const page = new URLSearchParams();
    if (next.query) page.set('query', next.query);
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
  const failure = sessionError ?? stream.error;
  function contactRows(record: ContactSummary) {
    return (
      <tr key={record.id}>
        <th scope="row" data-label={text.contactColumnName}>
          <span className="cell-person">
            <span className="sgn-avatar sgn-avatar-sm" aria-hidden="true">
              {[...record.displayName.trim()][0]?.toUpperCase() ?? '?'}
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
            [...new Set(record.links.map((link) => link.relation))].map(
              (relation) => (
                <span
                  key={relation}
                  className="badge badge-plain"
                  data-tone="neutral"
                >
                  {optionLabel(locale, relation)}
                </span>
              ),
            )
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
                <span className="contact-link" key={link.propertyId}>
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
                    {link.isPrimary ? ' · ' + text.contactPrimaryLink : ''}
                    {link.archived ? ' · ' + text.archived : ''}
                  </small>
                </span>
              ))}
            </span>
          ) : (
            <span className="is-unknown">{text.contactNoProperties}</span>
          )}
        </td>
        <td className="cell-actions" data-label={text.contactColumnActions}>
          {record.links.length || staff ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              aria-haspopup="dialog"
              onClick={(event) =>
                setOpened({
                  id: record.id,
                  opener: event.currentTarget,
                })
              }
            >
              {text.contactOpen}
            </button>
          ) : (
            <span className="row-meta">{text.contactUnlinkedNote}</span>
          )}
        </td>
      </tr>
    );
  }
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <h1 id="contact-directory">
            {ownersView ? text.contactViewOwners : text.contactsLink}
          </h1>
          <p className="intro-copy">{text.contactDirectoryNote}</p>
        </div>
      </div>
      <section className="panel page-section">
        <div className="panel-body">
          <nav className="tabs" aria-label={text.contactViews}>
            <Link
              className="tab"
              href={href({ query, view: 'all' })}
              aria-current={ownersView ? undefined : 'page'}
              prefetch={false}
            >
              {text.contactViewAll}
            </Link>
            <Link
              className="tab"
              href={href({ query, view: 'owners' })}
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
      {failure ? (
        <div
          className="alert"
          data-tone={failure === 'invalid-input' ? 'neutral' : 'danger'}
          role="alert"
        >
          <span>
            {failure === 'invalid-input'
              ? text.invalidInput
              : failure === 'sign-out-failed'
                ? text.signOutFailed
                : failure === 'access-changed'
                  ? text.accessChanged
                  : text.contactDirectoryFailed}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={
              sessionError
                ? sessionError === 'sign-out-failed'
                  ? logout
                  : reload
                : retry
            }
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
      <div ref={surface} hidden={!employee || busy}>
        {employee ? (
          <section
            className="panel page-section"
            aria-labelledby="contact-directory"
          >
            <div className="panel-body">
              {!ready && !failure ? (
                <LoadingSkeleton
                  label={text.loading}
                  shape="table"
                  rows={6}
                  columns={COLUMNS}
                />
              ) : null}
              {ready && stream.loaded === 0 && !failure ? (
                <div className="state-panel">
                  <h3>{emptyMessage}</h3>
                </div>
              ) : null}
              {ready && stream.loaded > 0 ? (
                <div className="table-wrap" ref={container}>
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
                    <StreamGap height={layout.band.top} columns={COLUMNS} />
                    {layout.mounted.map((index) => {
                      const chunk = streamChunkRows(
                        stream.windows,
                        index * STREAM_CHUNK_ROWS,
                        STREAM_CHUNK_ROWS,
                        CONTACT_PAGE_SIZE,
                      );
                      return (
                        <StreamTableChunk
                          key={`${STREAM_CHUNK_ROWS}:${index}`}
                          geometry={layout}
                          index={index}
                          rows={chunk}
                          count={Math.min(
                            STREAM_CHUNK_ROWS,
                            Math.max(0, rows - index * STREAM_CHUNK_ROWS),
                          )}
                          columns={COLUMNS}
                          locale={locale}
                        >
                          {chunk?.map(contactRows)}
                        </StreamTableChunk>
                      );
                    })}
                    <StreamGap height={layout.band.bottom} columns={COLUMNS} />
                  </table>
                </div>
              ) : null}
            </div>
            {ready && stream.loaded > 0 ? (
              <div className="panel-foot">
                <div className="row-between">
                  <p className="result-line">
                    <b>
                      {text.contactLoadedInfo.replace(
                        '{n}',
                        String(stream.loaded),
                      )}
                    </b>
                  </p>
                </div>
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
          onSaved={async () => {
            const opener = opened?.opener;
            refresh();
            requestAnimationFrame(() => {
              if (opener?.isConnected) opener.focus();
            });
          }}
        />
      ) : null}
    </>
  );
}
