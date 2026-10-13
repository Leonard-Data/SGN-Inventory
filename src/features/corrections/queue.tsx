'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/messages';
import type { Employee } from '@/features/employees/types';
import type { PropertyDetail } from '@/features/properties/detail-data';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { api, RequestError } from '@/features/employees/api';
import { BusinessValues } from '@/features/property-maintenance/history';
import type { ContactDetail } from '@/features/property-maintenance/data';
import {
  maintenanceText,
  optionLabel,
  requestStatusLabel,
} from '@/features/property-maintenance/messages';
import { vietnamTimestamp } from '@/features/properties/format';
import { CorrectionDraft } from './draft';
import { Amendments } from './amendments';
import type { Correction, CorrectionPage } from './data';
function RequestActions({
  request,
  employee,
  locale,
  onSaved,
  onDenied,
}: {
  request: Correction;
  employee: Employee;
  locale: Locale;
  onSaved: () => void;
  onDenied: (status: number) => void;
}) {
  const [snapshot, setSnapshot] = useState(request),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [impact, setImpact] = useState<ContactDetail['impact'] | null>(null),
    [amend, setAmend] = useState<{
      request: Correction;
      detail: PropertyDetail;
      proposal: Correction['proposed_values'];
    } | null>(null),
    controller = useRef<AbortController | null>(null),
    form = useRef<HTMLFormElement | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const text = maintenanceText(locale),
    staff = ['staff', 'manager', 'admin'].includes(employee.role);
  function failure(error: unknown) {
    if (
      error instanceof RequestError &&
      (error.status === 401 || error.status === 403)
    ) {
      onDenied(error.status);
      return;
    }
    setError(error instanceof RequestError ? error.code : 'invalid-input');
  }
  async function decide(
    action: string,
    reason: FormDataEntryValue | null = null,
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/corrections/' + snapshot.id, {
        action,
        requestRevision: snapshot.revision,
        reason,
      });
      onSaved();
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  }
  async function previewContact() {
    if (!snapshot.target_id || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<ContactDetail>(
        '/api/contacts/' + snapshot.target_id,
      );
      setImpact(result.impact);
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  }
  async function amendCurrent() {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{
          request: Correction;
          proposal: Correction['proposed_values'];
        }>('/api/corrections/' + request.id, undefined, abort.signal),
        detail = await api<PropertyDetail>(
          '/api/properties/' + result.request.property_id,
          undefined,
          abort.signal,
        );
      if (!abort.signal.aborted)
        setAmend({
          request: result.request,
          detail,
          proposal: result.proposal,
        });
    } catch (error) {
      if (!abort.signal.aborted) failure(error);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const button = (event.nativeEvent as SubmitEvent).submitter;
    if (button instanceof HTMLButtonElement)
      void decide(
        button.value,
        new FormData(event.currentTarget).get('reason'),
      );
  }
  return (
    <div>
      {staff ? (
        <form ref={form} onSubmit={submit}>
          {snapshot.target === 'contact' ? (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={previewContact}
                disabled={busy}
              >
                {text.contactImpact}
              </button>
              {impact ? (
                <>
                  <ul>
                    {impact.properties.map((property) => (
                      <li key={property.id}>
                        <a
                          href={'/properties/' + property.id}
                          target="_blank"
                          rel="noopener noreferrer"
                          translate="no"
                        >
                          {property.property_code}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <label className="check">
                    <input type="checkbox" required />
                    {text.confirmImpact}
                  </label>
                </>
              ) : null}
            </>
          ) : null}
          <div className="field">
            <label className="field-label">{text.reason}</label>
            <textarea
              name="reason"
              className="textarea"
              required
              minLength={10}
              maxLength={2000}
              rows={2}
              disabled={busy}
            />
          </div>
          <button
            className="btn btn-sm btn-primary"
            value="apply"
            disabled={busy || (snapshot.target === 'contact' && !impact)}
          >
            {text.apply}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            value="reject"
            disabled={busy}
            formNoValidate
          >
            {text.reject}
          </button>
        </form>
      ) : null}
      {staff || request.requester_id === employee.id ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={busy}
          onClick={amendCurrent}
        >
          {text.amend}
        </button>
      ) : null}
      {request.requester_id === employee.id ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={busy}
          onClick={() => decide('withdraw')}
        >
          {text.withdraw}
        </button>
      ) : null}
      {busy ? <p role="status">{text.saving}</p> : null}
      {error ? (
        <p role="alert">
          {error === 'stale-edit'
            ? text.stale
            : error === 'invalid-input'
              ? text.invalid
              : text.unavailable}{' '}
          <a
            href={'/properties/' + request.property_id}
            target="_blank"
            rel="noopener noreferrer"
            className="link"
          >
            {text.current}
          </a>
        </p>
      ) : null}
      {error ? (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => {
            setSnapshot(request);
            setError(null);
            form.current?.reset();
          }}
        >
          {text.cancel}
        </button>
      ) : null}
      {amend ? (
        <div className="maintenance-editor">
          <CorrectionDraft
            detail={amend.detail}
            request={amend.request}
            proposal={amend.proposal}
            locale={locale}
            role={employee.role}
            onDenied={onDenied}
            onSaved={() => {
              setAmend(null);
              onSaved();
            }}
          />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => setAmend(null)}
          >
            {text.cancel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
export function CorrectionQueue({
  propertyId,
  employee,
  locale,
  onDenied,
  onChanged,
}: {
  propertyId?: string;
  // The queue reads its own session; a caller that already has the viewer passes it.
  employee?: Employee;
  locale: Locale;
  onDenied: (status: number) => void;
  onChanged?: () => void;
}) {
  const [after, setAfter] = useState<string | null>(null),
    endpoint =
      '/api/corrections?' +
      new URLSearchParams({
        ...(propertyId ? { propertyId } : {}),
        ...(after ? { after } : {}),
      }),
    {
      employee: sessionEmployee,
      data,
      error,
      busy,
      surface,
      reload,
    } = useProtectedData<CorrectionPage>(endpoint),
    viewer = employee ?? sessionEmployee,
    text = maintenanceText(locale);
  function changed() {
    void reload();
    onChanged?.();
  }
  return (
    <section className="panel" id="correction-queue">
      <div className="panel-head">
        <h2 className="panel-title">{text.queue}</h2>
      </div>
      <div className="panel-body">
        {busy ? <p role="status">{text.loading}</p> : null}
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>{text.unavailable}</span>
            <button className="btn btn-sm btn-ghost" onClick={reload}>
              {text.refresh}
            </button>
          </div>
        ) : null}
        <div ref={surface} hidden={!data || busy}>
          {data && viewer ? (
            <>
              {data.requests.length ? (
                data.requests.map((request) => {
                  const amendments = data.amendments.filter(
                    (a) => a.request_id === request.id,
                  );
                  return (
                    <article className="history-event" key={request.id}>
                      <h3>
                        <a
                          href={'/properties/' + request.property_id}
                          translate="no"
                        >
                          {data.properties.find(
                            (p) => p.id === request.property_id,
                          )?.property_code ?? request.property_id}
                        </a>{' '}
                        · {optionLabel(locale, request.target)}
                      </h3>
                      <p>
                        {optionLabel(locale, request.category)} ·{' '}
                        <span
                          className="badge"
                          data-tone={
                            request.status === 'open'
                              ? 'accent'
                              : request.status === 'applied'
                                ? 'success'
                                : request.status === 'rejected'
                                  ? 'danger'
                                  : 'muted'
                          }
                        >
                          {requestStatusLabel(locale, request.status)}
                        </span>{' '}
                        ·{' '}
                        <time dateTime={request.created_at}>
                          {vietnamTimestamp(request.created_at, locale)}
                        </time>{' '}
                        ({text.time})
                      </p>
                      <h4>{text.original}</h4>
                      <p>
                        {text.actor}:{' '}
                        <span translate="no">
                          {data.actors.find(
                            (a) => a.id === request.requester_id,
                          )?.display_name ?? request.requester_id}
                        </span>
                      </p>
                      <p translate="no">{request.explanation}</p>
                      <details className="maintenance">
                        <summary>{text.observed}</summary>
                        <BusinessValues
                          values={request.observed_values}
                          locale={locale}
                        />
                      </details>
                      <details className="maintenance">
                        <summary>{text.proposal}</summary>
                        <BusinessValues
                          values={request.proposed_values}
                          locale={locale}
                        />
                      </details>
                      <h4>{text.latestProposal}</h4>
                      <BusinessValues
                        values={
                          amendments[0]?.proposed_values ??
                          request.proposed_values
                        }
                        locale={locale}
                      />
                      {amendments[0] ? (
                        <>
                          <p>
                            {text.actor}:{' '}
                            <span translate="no">
                              {data.actors.find(
                                (a) => a.id === amendments[0]?.actor_id,
                              )?.display_name ?? amendments[0].actor_id}
                            </span>{' '}
                            ·{' '}
                            <time dateTime={amendments[0].created_at}>
                              {vietnamTimestamp(
                                amendments[0].created_at,
                                locale,
                              )}
                            </time>
                          </p>
                          <p translate="no">{amendments[0].explanation}</p>
                          <Amendments requestId={request.id} locale={locale} />
                        </>
                      ) : null}
                      {request.outcome_at ? (
                        <p>
                          {text.actor}:{' '}
                          <span translate="no">
                            {data.actors.find(
                              (a) => a.id === request.outcome_actor_id,
                            )?.display_name ?? request.outcome_actor_id}
                          </span>{' '}
                          ·{' '}
                          <time dateTime={request.outcome_at}>
                            {vietnamTimestamp(request.outcome_at, locale)}
                          </time>
                        </p>
                      ) : null}
                      {request.outcome_reason ? (
                        <p translate="no">{request.outcome_reason}</p>
                      ) : null}
                      {request.status === 'open' ? (
                        <RequestActions
                          request={request}
                          employee={viewer}
                          locale={locale}
                          onDenied={onDenied}
                          onSaved={changed}
                        />
                      ) : (
                        <p>{text.terminal}</p>
                      )}
                    </article>
                  );
                })
              ) : (
                <p>{text.emptyRequests}</p>
              )}
              <nav aria-label={text.requests}>
                {after ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAfter(null)}
                  >
                    {text.first}
                  </button>
                ) : null}
                {data.nextCursor ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAfter(data.nextCursor)}
                  >
                    {text.more}
                  </button>
                ) : null}
                <button className="btn btn-ghost btn-sm" onClick={reload}>
                  {text.refresh}
                </button>
              </nav>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
export function CorrectionReport({
  detail,
  locale,
  role,
  onDenied,
  onSaved,
}: {
  detail: PropertyDetail;
  locale: Locale;
  role: Employee['role'];
  onDenied: (status: number) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    text = maintenanceText(locale);
  return (
    <details
      className="panel maintenance"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{text.submit}</summary>
      {open ? (
        <CorrectionDraft
          detail={detail}
          locale={locale}
          role={role}
          onDenied={onDenied}
          onSaved={async () => {
            setOpen(false);
            await onSaved();
          }}
        />
      ) : null}
    </details>
  );
}
