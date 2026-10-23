'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { api, RequestError } from '@/features/employees/api';
import { label, messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { useToast } from '@/features/toasts/toast-host';
import { vietnamTimestamp } from '@/features/properties/format';
import { applyServerSummary } from '@/features/properties/catalogue-changes';
import { useCatalogueChange } from '@/features/properties/catalogue-provider';
import type { PropertySummary } from '@/features/properties/types';
import type { StatusChange, StatusRequestQueue } from './data';
import { statusMessage, statusText } from './messages';

// The reviewer's queue: only requests nobody has decided yet, oldest first. A decision is one
// action with its own reason, and a decided case leaves this list — its outcome stays readable in
// the record's own status history.
export function StatusRequestQueue({
  locale,
  onDenied,
}: {
  locale: Locale;
  onDenied: (status: number) => void;
}) {
  const text = statusText(locale);
  const notify = useToast();
  const applyChange = useCatalogueChange();
  const [cursor, setCursor] = useState<{
    after: string;
    afterId: string;
  } | null>(null);
  const endpoint = '/api/status-requests?' + new URLSearchParams(cursor ?? {});
  const { data, error, busy, surface, reload } =
    useProtectedData<StatusRequestQueue>(endpoint);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [failure, setFailure] = useState<{
    id: string;
    code: string;
  } | null>(null);
  async function decide(
    id: string,
    approve: boolean,
    reason: string,
  ): Promise<boolean> {
    if (deciding) return false;
    setDeciding(id);
    setFailure(null);
    try {
      const result = await api<{
        change: StatusChange;
        summary?: PropertySummary | null;
      }>('/api/status-requests/' + id, { approve, reason });
      // An approval applied a status, so the property's catalogue row is refreshed from the
      // server's own answer rather than left reading the status it had before the decision.
      applyServerSummary(applyChange, result, result.change.property_id);
      notify({
        saved: true,
        message: approve ? text.queueApproved : text.queueRejected,
      });
      return true;
    } catch (error) {
      if (
        error instanceof RequestError &&
        (error.status === 401 || error.status === 403)
      ) {
        onDenied(error.status);
        return false;
      }
      setFailure({
        id,
        code: error instanceof RequestError ? error.code : 'unavailable',
      });
      return false;
    } finally {
      setDeciding(null);
    }
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{text.queueTitle}</h2>
      </div>
      <div className="panel-body">
        {busy && !data ? (
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
                : text.loadFailed}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={reload}>
              {text.refresh}
            </button>
          </div>
        ) : null}
        <div ref={surface} hidden={!data || busy}>
          {data ? (
            data.changes.length ? (
              data.changes.map((change) => (
                <RequestRow
                  key={change.id}
                  change={change}
                  propertyCode={
                    data.properties.find(
                      (property) => property.id === change.property_id,
                    )?.property_code ?? null
                  }
                  locale={locale}
                  busy={deciding === change.id}
                  failure={failure?.id === change.id ? failure.code : null}
                  onDecide={decide}
                  onReloaded={reload}
                />
              ))
            ) : (
              <p>{text.queueEmpty}</p>
            )
          ) : null}
        </div>
        <nav aria-label={text.queueTitle}>
          {cursor ? (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setCursor(null)}
            >
              {messages[locale].first}
            </button>
          ) : null}
          {data?.nextCursor ? (
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => setCursor(data.nextCursor)}
            >
              {messages[locale].next}
            </button>
          ) : null}
          <button className="btn btn-sm btn-ghost" onClick={reload}>
            {text.refresh}
          </button>
        </nav>
        <p className="field-hint">{text.queueNote}</p>
      </div>
    </section>
  );
}

function RequestRow({
  change,
  propertyCode,
  locale,
  busy,
  failure,
  onDecide,
  onReloaded,
}: {
  change: StatusRequestQueue['changes'][number];
  propertyCode: string | null;
  locale: Locale;
  busy: boolean;
  failure: string | null;
  onDecide: (id: string, approve: boolean, reason: string) => Promise<boolean>;
  onReloaded: () => void;
}) {
  const text = statusText(locale);
  const [reason, setReason] = useState('');
  const [invalid, setInvalid] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (!(submitter instanceof HTMLButtonElement)) return;
    if (reason.trim().length < 10) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (
      await onDecide(change.id, submitter.value === 'approve', reason.trim())
    ) {
      setReason('');
      onReloaded();
    }
  }
  return (
    <article className="history-event">
      <h3>
        <Link href={'/properties/' + change.property_id} prefetch={false}>
          {propertyCode ?? text.queueFor}
        </Link>{' '}
        ·{' '}
        <span className="badge badge-plain" data-tone="neutral">
          {label(locale, change.from_status)}
        </span>{' '}
        →{' '}
        <span className="badge" data-tone="accent">
          {label(locale, change.to_status)}
        </span>
      </h3>
      <p className="comment-meta">
        {text.statusRequestedBy}:{' '}
        <span translate="no">{change.requested_by_name}</span> ·{' '}
        {text.queueRequestedAt}:{' '}
        <time dateTime={change.requested_at}>
          {vietnamTimestamp(change.requested_at, locale)}
        </time>
      </p>
      {change.note ? (
        <p className="record-body" translate="no">
          {change.note}
        </p>
      ) : null}
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label className="field-label" htmlFor={'reason-' + change.id}>
            {text.queueDecisionReason}
          </label>
          <textarea
            className="textarea"
            id={'reason-' + change.id}
            name="reason"
            rows={2}
            minLength={10}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={busy}
            aria-describedby={'reason-hint-' + change.id}
          />
        </div>
        <p className="field-hint" id={'reason-hint-' + change.id}>
          {text.queueDecisionReasonHint}
        </p>
        {invalid ? (
          <p className="field-error" role="alert">
            {text.queueInvalidReason}
          </p>
        ) : null}
        {failure ? (
          <p className="field-error" role="alert">
            {statusMessage(locale, failure)}
          </p>
        ) : null}
        <div className="composer-foot">
          <button
            className="btn btn-sm btn-primary"
            type="submit"
            value="approve"
            disabled={busy}
          >
            {busy ? text.statusSaving : text.queueApprove}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            type="submit"
            value="reject"
            disabled={busy}
          >
            {text.queueReject}
          </button>
        </div>
      </form>
    </article>
  );
}
