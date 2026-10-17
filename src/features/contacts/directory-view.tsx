'use client';
import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { useProtectedData } from '@/features/employees/use-protected-data';
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
import type { ContactPage, ContactSummary } from './types';

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
  // The view passes through unchanged so an unknown filter is refused by the read instead
  // of silently rendering a different view.
  if (view) parameters.set('view', view);
  const suffix = parameters.toString();
  const endpoint = '/api/contacts' + (suffix ? '?' + suffix : '');
  const { data, error, busy, surface, logout, reload } =
    useProtectedData<ContactPage>(endpoint);
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
  const [notice, setNotice] = useState(false);
  const ownersView = view === 'owners';
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  // A page change retires the expansion: the editor belongs to the page it was opened on.
  const openId = opened?.endpoint === endpoint ? opened.id : null;
  function denied(status: number) {
    window.location.replace(status === 401 ? '/login' : '/access-denied');
  }
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
    setNotice(false);
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
    setNotice(true);
    await reload();
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

      {notice ? <p role="status">{copy.saved}</p> : null}

      {error ? (
        <div
          className="alert"
          data-tone={error === 'invalid-input' ? 'neutral' : 'danger'}
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
        <p className="panel-note" role="status">
          {text.loading}
        </p>
      ) : null}

      <div ref={surface} hidden={!data || busy}>
        {data ? (
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
              {data.contacts.length === 0 ? (
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
                        <Fragment key={record.id}>
                          <tr>
                            <th scope="row" data-label={text.contactColumnName}>
                              <span className="cell-person">
                                <span
                                  className="sgn-avatar sgn-avatar-sm"
                                  aria-hidden="true"
                                >
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
                                <span className="is-unknown">
                                  {text.unknown}
                                </span>
                              )}
                            </td>
                            <td data-label={text.contactColumnPhone}>
                              {phoneText(record) === null ? (
                                <span className="is-unknown">
                                  {text.unknown}
                                </span>
                              ) : (
                                <span className="num" translate="no">
                                  {phoneText(record)}
                                </span>
                              )}
                            </td>
                            <td data-label={text.contactColumnProperties}>
                              {record.links.length ? (
                                <span className="contact-links">
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
                              {record.links.length ? (
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  aria-expanded={openId === record.id}
                                  onClick={() =>
                                    openId === record.id
                                      ? close()
                                      : void open(record)
                                  }
                                >
                                  {openId === record.id
                                    ? text.contactClose
                                    : text.contactOpen}
                                </button>
                              ) : (
                                <span className="row-meta">
                                  {text.contactUnlinkedNote}
                                </span>
                              )}
                            </td>
                          </tr>
                          {openId === record.id ? (
                            <tr className="row-detail">
                              <td colSpan={5}>
                                <div className="row-editor">
                                  {detailBusy ? (
                                    <p className="panel-note" role="status">
                                      {text.loading}
                                    </p>
                                  ) : null}
                                  {detailError ? (
                                    <div
                                      className="alert"
                                      data-tone={
                                        detailError === 'contact-refusal'
                                          ? 'neutral'
                                          : 'danger'
                                      }
                                      role="alert"
                                    >
                                      <span>
                                        {maintenanceError(locale, detailError)}
                                      </span>
                                      <button
                                        type="button"
                                        className="btn btn-sm btn-ghost"
                                        onClick={() => void open(record)}
                                      >
                                        {text.retry}
                                      </button>
                                    </div>
                                  ) : null}
                                  {editor && editor.id === record.id ? (
                                    <>
                                      <div className="row-editor-head">
                                        <h3 translate="no">
                                          {String(
                                            editor.values.display_name ?? '',
                                          )}
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
                                              String(
                                                editor.values.contact_type ??
                                                  'unknown',
                                              ),
                                            )}
                                          </dd>
                                        </div>
                                        <div className="fact">
                                          <dt>{text.contactColumnPhone}</dt>
                                          <dd
                                            className={
                                              recordedPhone(editor.values) ===
                                              null
                                                ? 'is-unknown'
                                                : 'num'
                                            }
                                            translate="no"
                                          >
                                            {recordedPhone(editor.values) ??
                                              text.unknown}
                                          </dd>
                                        </div>
                                        <div className="fact">
                                          <dt>{text.contactRawPhoneText}</dt>
                                          <dd
                                            className={
                                              editor.values.raw_phone_text ==
                                              null
                                                ? 'is-unknown'
                                                : undefined
                                            }
                                            translate="no"
                                          >
                                            {String(
                                              editor.values.raw_phone_text ??
                                                text.unknown,
                                            )}
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
                                            {String(
                                              editor.values.notes ??
                                                text.unknown,
                                            )}
                                          </dd>
                                        </div>
                                      </dl>
                                      <section
                                        className="impact"
                                        aria-labelledby="contact-impact"
                                      >
                                        <p
                                          className="impact-label"
                                          id="contact-impact"
                                        >
                                          {text.contactLinkedProperties}
                                        </p>
                                        <p>
                                          {text.contactLinkedPropertiesNote}
                                        </p>
                                        {editor.impact.properties.length ? (
                                          <div className="chips">
                                            {editor.impact.properties.map(
                                              (property) => (
                                                <Link
                                                  className="chip"
                                                  key={property.id}
                                                  href={
                                                    '/properties/' + property.id
                                                  }
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  translate="no"
                                                  prefetch={false}
                                                >
                                                  {property.property_code}
                                                </Link>
                                              ),
                                            )}
                                          </div>
                                        ) : (
                                          <p className="is-unknown">
                                            {text.contactNoProperties}
                                          </p>
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
                        href={href({
                          query,
                          after: data.nextCursor,
                          view,
                        })}
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
    </>
  );
}
