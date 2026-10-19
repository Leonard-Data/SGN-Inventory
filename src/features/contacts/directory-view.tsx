'use client';
import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { useToast } from '@/features/toasts/toast-host';
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
import type { ContactDetail } from '@/features/property-maintenance/data';
import {
  targetFields,
  type Changes,
} from '@/features/property-maintenance/fields';
import {
  MutationForm,
  RecordFields,
} from '@/features/property-maintenance/forms';
import {
  maintenanceError,
  maintenanceText,
  optionLabel,
} from '@/features/property-maintenance/messages';
import { failureRoute } from '@/features/property-maintenance/refusal-rules';
import { CONTACT_PAGE_SIZE } from './directory';
import type { ContactSummary } from './types';
import { contactWindow } from './window';

// People → Contacts (#71): the shared-identity directory, its Owners view and the expanded
// record that corrects the shared contact. An Owner is a Contact linked to a Property with
// `relation = owner`; the identity's general classification never decides it. The expansion
// opens the same detail read and the same correction operation the property maintenance
// workspace uses, so the affected-set preview, the revision check and the object-level
// refusal are the same ones. A recorded correction changes the shared person, which every
// linked property presents on its next read. Loading, empty, no-match, failure and
// object-level refusal stay distinct, and the protected surface clears on sign-out or lost
// membership.
type Editor = {
  id: string;
  revision: string;
  values: Record<string, unknown>;
  impact: ContactDetail['impact'];
};

function recordedPhone(values: Record<string, unknown>): string | null {
  const phones = Array.isArray(values.phones)
    ? (values.phones as unknown[]).map(String)
    : [];
  if (phones.length > 0) return phones.join(' · ');
  return typeof values.raw_phone_text === 'string'
    ? values.raw_phone_text
    : null;
}

function phoneText(record: ContactSummary): string | null {
  return recordedPhone({
    phones: record.phones,
    raw_phone_text: record.rawPhoneText,
  });
}

function initials(name: string): string {
  return [...name.trim()][0]?.toUpperCase() ?? '?';
}

// The columns of the directory table, and therefore the span of a reserved chunk's row.
const COLUMNS = 5;

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
  // The view passes through unchanged so an unknown filter is refused by the read instead
  // of silently rendering a different view.
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
  // The rows the stream accounts for: what its reads have reached, plus the one row standing for
  // the window it is about to fetch, so that window's chunk is reserved before it arrives.
  const rows = streamKnownRows(stream.loaded, stream.more === true);
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
  const copy = maintenanceText(locale);
  const [opened, setOpened] = useState<{
    endpoint: string;
    id: string;
  } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const notify = useToast();
  const ownersView = view === 'owners';
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  // A page change retires the expansion: the editor belongs to the page it was opened on.
  const openId = opened?.endpoint === endpoint ? opened.id : null;
  function href(next: { query: string | null; view: string | null }) {
    const page = new URLSearchParams();
    if (next.query) page.set('query', next.query);
    if (next.view === 'owners') page.set('view', 'owners');
    const value = page.toString();
    return '/people/contacts' + (value ? '?' + value : '');
  }
  async function open(record: ContactSummary) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    // The row opens before its read resolves, so the loading, refusal and failure states
    // have somewhere to render instead of the button appearing to do nothing.
    setOpened({ endpoint, id: record.id });
    setEditor(null);
    setDetailBusy(true);
    setDetailError(null);
    try {
      const result = await api<ContactDetail>(
        '/api/contacts/' + record.id,
        undefined,
        abort.signal,
      );
      if (abort.signal.aborted) return;
      setEditor({
        id: record.id,
        revision: result.impact.revision,
        values: result.contact,
        impact: result.impact,
      });
    } catch (failure) {
      if (abort.signal.aborted) return;
      if (
        failure instanceof RequestError &&
        failureRoute(failure.status, failure.code) === 'denied'
      ) {
        denied(failure.status);
        return;
      }
      setDetailError(
        failure instanceof RequestError ? failure.code : 'unavailable',
      );
    } finally {
      if (!abort.signal.aborted) setDetailBusy(false);
    }
  }
  function close() {
    controller.current?.abort();
    setDetailBusy(false);
    setDetailError(null);
    setOpened(null);
    setEditor(null);
  }
  async function save(changes: Changes) {
    if (!editor) return;
    return api('/api/contacts/' + editor.id, {
      revision: editor.revision,
      changes,
    });
  }
  async function saved() {
    setOpened(null);
    setEditor(null);
    notify({ saved: true, message: copy.contactSaved });
    refresh();
  }
  const emptyMessage = query
    ? ownersView
      ? text.contactOwnersEmptyQuery
      : text.contactDirectoryEmptyQuery
    : ownersView
      ? text.contactOwnersEmpty
      : text.contactDirectoryEmpty;
  // The session's own failure outranks a window's: a lost session is why nothing could be read.
  const failure = sessionError ?? stream.error;
  // One contact and, when it is open, the editor below it. Both rows belong to the chunk that
  // holds the contact, so the chunk measures its rows' real height: the stream keeps its scroll
  // position when an editor opens or closes.
  function contactRows(record: ContactSummary) {
    return (
      <Fragment key={record.id}>
        <tr>
          <th scope="row" data-label={text.contactColumnName}>
            <span className="cell-person">
              <span className="sgn-avatar sgn-avatar-sm" aria-hidden="true">
                {initials(record.displayName)}
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
                aria-expanded={openId === record.id}
                onClick={() =>
                  openId === record.id ? close() : void open(record)
                }
              >
                {openId === record.id ? text.contactClose : text.contactOpen}
              </button>
            ) : (
              <span className="row-meta">{text.contactUnlinkedNote}</span>
            )}
          </td>
        </tr>
        {openId === record.id ? (
          <tr className="row-detail">
            <td colSpan={5}>
              <div className="row-editor">
                {detailBusy ? (
                  <LoadingSkeleton
                    label={text.loading}
                    shape="table"
                    rows={3}
                    columns={2}
                  />
                ) : null}
                {detailError ? (
                  <div
                    className="alert"
                    data-tone={
                      detailError === 'contact-refusal' ? 'neutral' : 'danger'
                    }
                    role="alert"
                  >
                    <span>{maintenanceError(locale, detailError)}</span>
                    {detailError === 'contact-refusal' ? null : (
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => void open(record)}
                      >
                        {text.retry}
                      </button>
                    )}
                  </div>
                ) : null}
                {editor && editor.id === record.id ? (
                  <>
                    <div className="row-editor-head">
                      <h3 translate="no">
                        {String(editor.values.display_name ?? '')}
                      </h3>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={close}
                      >
                        {text.contactClose}
                      </button>
                    </div>
                    <dl className="facts">
                      <div className="fact">
                        <dt>{text.contactClassifiedAs}</dt>
                        <dd>
                          {optionLabel(
                            locale,
                            String(editor.values.contact_type ?? 'unknown'),
                          )}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>{text.contactColumnPhone}</dt>
                        <dd
                          className={
                            recordedPhone(editor.values) === null
                              ? 'is-unknown'
                              : 'num'
                          }
                          translate="no"
                        >
                          {recordedPhone(editor.values) ?? text.unknown}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>{text.contactRawPhoneText}</dt>
                        <dd
                          className={
                            editor.values.raw_phone_text == null
                              ? 'is-unknown'
                              : undefined
                          }
                          translate="no"
                        >
                          {String(editor.values.raw_phone_text ?? text.unknown)}
                        </dd>
                      </div>
                      <div className="fact">
                        <dt>{text.notes}</dt>
                        <dd
                          className={
                            editor.values.notes == null
                              ? 'is-unknown'
                              : undefined
                          }
                          translate="no"
                        >
                          {String(editor.values.notes ?? text.unknown)}
                        </dd>
                      </div>
                    </dl>
                    <section
                      className="impact"
                      aria-labelledby="contact-impact"
                    >
                      <p className="impact-label" id="contact-impact">
                        {text.contactLinkedProperties}
                      </p>
                      <p>{text.contactLinkedPropertiesNote}</p>
                      {editor.impact.properties.length ? (
                        <div className="chips">
                          {editor.impact.properties.map((property) => (
                            <Link
                              className="chip"
                              key={property.id}
                              href={'/properties/' + property.id}
                              target="_blank"
                              rel="noopener noreferrer"
                              translate="no"
                              prefetch={false}
                            >
                              {property.property_code}
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <p className="is-unknown">{text.contactNoProperties}</p>
                      )}
                    </section>
                    <h3>{text.contactEditorTitle}</h3>
                    <p>{copy.optional}</p>
                    <MutationForm
                      locale={locale}
                      target="contact"
                      values={editor.values}
                      save={save}
                      onSaved={saved}
                      onDenied={denied}
                    >
                      <p>{text.contactSharedIdentityNote}</p>
                      <label className="check">
                        <input type="checkbox" required />
                        {copy.confirmImpact}
                      </label>
                      <RecordFields
                        locale={locale}
                        names={targetFields.contact}
                        values={editor.values}
                      />
                    </MutationForm>
                  </>
                ) : null}
              </div>
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.people}</p>
          <h1>{text.contactsLink}</h1>
          <p className="intro-copy">{text.contactDirectoryNote}</p>
        </div>
      </div>

      <section className="panel page-section">
        <div className="panel-body">
          <nav className="tabs directory-tabs" aria-label={text.contactViews}>
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
                strokeLinejoin="round"
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
                  strokeLinejoin="round"
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
            <div className="panel-head">
              <h2 id="contact-directory">
                {ownersView ? text.contactViewOwners : text.contactDirectory}
              </h2>
            </div>
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
                  <div className="state-mark">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="9.5" cy="8" r="3.2" />
                      <path d="M3.5 20a6 6 0 0 1 12 0" />
                    </svg>
                  </div>
                  <h3>{emptyMessage}</h3>
                </div>
              ) : (
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
              )}
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
    </>
  );
}
