'use client';
import { useId, useState, type FormEvent } from 'react';
import { api, RequestError } from '@/features/employees/api';
import { label, messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { fields } from '@/features/property-maintenance/fields';
import { useToast } from '@/features/toasts/toast-host';
import { LoadingSkeleton } from '@/features/skeleton';
import { vietnamTimestamp } from '@/features/properties/format';
import type { StatusChange, StatusTrailPage } from './data';
import { statusMessage, statusText } from './messages';

const STATUS_OPTIONS = fields.status?.options ?? [];
const NOTE_MAX = 500;

// One status the person may pick, with the note they typed beside it. The database decides what is
// allowed: a change any employee may make is applied, and sold or rented becomes a request a manager
// or admin decides instead of changing the record.
export function StatusControl({
  propertyId,
  status,
  locale,
  onDenied,
  onChanged,
}: {
  propertyId: string;
  status: string;
  locale: Locale;
  onDenied: (status: number) => void;
  onChanged: (change: StatusChange) => void;
}) {
  const text = statusText(locale);
  const notify = useToast();
  const id = useId();
  const [next, setNext] = useState(status);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ change: StatusChange }>(
        `/api/properties/${propertyId}/status`,
        { status: next, note: note.trim() === '' ? null : note },
      );
      // A request that is still waiting changed nothing, so the picker returns to the recorded
      // status and the confirmation says what was actually recorded.
      const applied = result.change.state === 'applied';
      setNext(applied ? result.change.to_status : result.change.from_status);
      notify({
        saved: true,
        message: applied ? text.statusSaved : text.statusRequested,
      });
      setNote('');
      onChanged(result.change);
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      setError(
        statusMessage(
          locale,
          failure instanceof RequestError ? failure.code : 'unavailable',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const hintId = `${id}-hint`;
  return (
    <form className="status-control" onSubmit={(event) => void submit(event)}>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-status`}>
          {text.statusLabel}
        </label>
        <select
          className="select"
          id={`${id}-status`}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          disabled={busy}
          aria-describedby={hintId}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {label(locale, option)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-note`}>
          {text.statusNote}
        </label>
        <textarea
          className="textarea"
          id={`${id}-note`}
          rows={2}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={busy}
          aria-describedby={hintId}
        />
      </div>
      <p className="field-hint" id={hintId}>
        {text.statusNoteHint} {text.saleFinalNote}
      </p>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="composer-foot">
        <button
          className="btn btn-primary btn-sm"
          type="submit"
          disabled={busy || next === status}
        >
          {busy ? text.statusSaving : text.statusSubmit}
        </button>
      </div>
    </form>
  );
}

// One recorded event. A direct change names the person who made it; a request names who asked, and
// once decided it also names who decided, in the same row and in the order it happened.
function ChangeEvent({
  change,
  locale,
}: {
  change: StatusChange;
  locale: Locale;
}) {
  const text = statusText(locale);
  const decided = change.state !== 'pending';
  return (
    <li className="tl-item">
      <p className="status-change-line">
        <span className="badge badge-plain" data-tone="neutral">
          {label(locale, change.from_status)}
        </span>{' '}
        →{' '}
        <span className="badge" data-tone="accent">
          {label(locale, change.to_status)}
        </span>{' '}
        {change.state === 'pending' ? (
          <span className="badge" data-tone="warn">
            {text.statusAwaiting}
          </span>
        ) : change.state === 'rejected' ? (
          <span className="badge" data-tone="danger">
            {text.statusRejected}
          </span>
        ) : change.origin === 'request' ? (
          <span className="badge" data-tone="success">
            {text.statusApproved}
          </span>
        ) : (
          <span className="badge badge-plain" data-tone="neutral">
            {text.statusSet}
          </span>
        )}
      </p>
      <p className="comment-meta">
        {change.origin === 'request' ? text.statusRequestedBy + ': ' : ''}
        <span translate="no">{change.requested_by_name}</span> ·{' '}
        <time dateTime={change.requested_at}>
          {vietnamTimestamp(change.requested_at, locale)}
        </time>
      </p>
      {change.note ? (
        <p className="record-body" translate="no">
          {change.note}
        </p>
      ) : null}
      {decided && change.decided_by_name ? (
        <p className="comment-meta">
          {text.statusDecidedBy}:{' '}
          <span translate="no">{change.decided_by_name}</span> ·{' '}
          <time dateTime={change.decided_at ?? undefined}>
            {vietnamTimestamp(change.decided_at, locale)}
          </time>
        </p>
      ) : null}
      {change.decision_reason ? (
        <p className="record-body" translate="no">
          {change.decision_reason}
        </p>
      ) : null}
    </li>
  );
}

export function StatusTrail({
  propertyId,
  locale,
}: {
  propertyId: string;
  locale: Locale;
}) {
  const text = statusText(locale);
  const { data, error, busy, surface, reload } =
    useProtectedData<StatusTrailPage>(
      '/api/properties/' + propertyId + '/status-history',
    );
  return (
    <section className="panel" data-od-id="panel-status-history">
      <div className="panel-head">
        <h2>{text.statusTrail}</h2>
      </div>
      <div className="panel-body">
        {busy ? (
          <LoadingSkeleton
            label={messages[locale].loading}
            shape="rows"
            rows={3}
          />
        ) : null}
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>
              {error === 'access-changed'
                ? messages[locale].accessChanged
                : text.statusTrailFailed}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={reload}>
              {text.refresh}
            </button>
          </div>
        ) : null}
        <div ref={surface} hidden={!data || busy}>
          {data ? (
            data.changes.length ? (
              <ol className="timeline">
                {data.changes.map((change) => (
                  <ChangeEvent
                    key={change.id}
                    change={change}
                    locale={locale}
                  />
                ))}
              </ol>
            ) : (
              <p className="field-hint">{text.statusTrailEmpty}</p>
            )
          ) : null}
        </div>
        <p className="field-hint">{text.statusTrailNote}</p>
      </div>
    </section>
  );
}
