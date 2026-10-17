'use client';
import { useId, useRef, useState, useEffect, type FormEvent } from 'react';
import { api, RequestError } from '@/features/employees/api';
import type { Locale } from '@/i18n/messages';
import { maintenanceText, optionLabel } from './messages';
import type { ContactPage } from '@/features/contacts/types';
export function ContactPicker({
  locale,
  selected,
  onSelected,
  onDenied,
}: {
  locale: Locale;
  selected: string;
  onSelected: (id: string) => void;
  onDenied: (status: number) => void;
}) {
  const id = useId(),
    controller = useRef<AbortController | null>(null),
    [query, setQuery] = useState(''),
    [page, setPage] = useState<ContactPage | null>(null),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    text = maintenanceText(locale);
  useEffect(() => () => controller.current?.abort(), []);
  async function search(after?: string) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(false);
    try {
      const result = await api<ContactPage>(
        '/api/contacts?' +
          new URLSearchParams({ query, ...(after ? { after } : {}) }),
        undefined,
        abort.signal,
      );
      if (!abort.signal.aborted) setPage(result);
    } catch (failure) {
      if (abort.signal.aborted) return;
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      )
        onDenied(failure.status);
      else setError(true);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void search();
  }
  return (
    <div>
      <form onSubmit={submit}>
        <div className="field">
          <label className="field-label" htmlFor={id}>
            {text.contactSearch}
          </label>
          <input
            id={id}
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={120}
          />
        </div>
        <button className="btn btn-sm" disabled={busy}>
          {busy ? text.loading : text.contactSearch}
        </button>
      </form>
      {error ? <p role="alert">{text.unavailable}</p> : null}
      {page ? (
        <ul className="contact-choices">
          {page.contacts.map((contact) => (
            <li key={contact.id}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-pressed={selected === contact.id}
                onClick={() => onSelected(contact.id)}
                translate="no"
              >
                {contact.displayName} ·{' '}
                {optionLabel(locale, contact.contactType)}
                <small>
                  {contact.rawPhoneText ||
                    contact.phones.join(' / ') ||
                    text.unknown}
                </small>
                <small>{contact.id}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {page?.nextCursor ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={busy}
          onClick={() => search(page.nextCursor!)}
        >
          {text.more}
        </button>
      ) : null}
      <p>
        {text.chooseContact}:{' '}
        <span translate="no">
          {page?.contacts.find((c) => c.id === selected)?.displayName ??
            (selected || text.unknown)}
        </span>
      </p>
    </div>
  );
}
