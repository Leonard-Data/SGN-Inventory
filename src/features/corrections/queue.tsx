'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import type { Employee } from '@/features/employees/types';
import type { PropertyDetail } from '@/features/properties/detail-data';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { api, RequestError } from '@/features/employees/api';
import { useToast } from '@/features/toasts/toast-host';
import { BusinessValues } from '@/features/property-maintenance/history';
import type { ContactDetail } from '@/features/property-maintenance/data';
import {
  maintenanceError,
  maintenanceText,
  optionLabel,
  requestStatusLabel,
} from '@/features/property-maintenance/messages';
import { failureRoute } from '@/features/property-maintenance/refusal-rules';
import { vietnamTimestamp } from '@/features/properties/format';
import { applyServerSummary } from '@/features/properties/catalogue-changes';
import { useCatalogueChange } from '@/features/properties/catalogue-provider';
import type { PropertySummary } from '@/features/properties/types';
import { CorrectionDraft } from './draft';
import { Amendments } from './amendments';
import { changedValues } from './changes';
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
  const notify = useToast();
  // An applied correction changed the property through the same maintenance operation, so the
  // browser's catalogue takes the server's own read of it.
  const applyChange = useCatalogueChange();
  // The dialog closes on a committed decision, so the confirmation names the decision.
  const decided: Record<string, string> = {
    apply: text.correctionApplied,
    reject: text.correctionRejected,
    withdraw: text.correctionWithdrawn,
    amend: text.requestSaved,
  };
  // previewContact() and decide('apply') both route through the shared refusal decision.
  function failure(error: unknown) {
    if (
      error instanceof RequestError &&
      failureRoute(error.status, error.code) === 'denied'
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
      const result = await api<{
        ok: true;
        summary?: PropertySummary | null;
      }>('/api/corrections/' + snapshot.id, {
        action,
        requestRevision: snapshot.revision,
        reason,
      });
      if (action === 'apply')
        applyServerSummary(applyChange, result, snapshot.property_id);
      notify({ saved: true, message: decided[action] ?? text.requestSaved });
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
          {maintenanceError(locale, error)}{' '}
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
  locale,
  onDenied,
  onChanged,
}: {
  propertyId?: string;
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
        {busy ? (
          <LoadingSkeleton label={text.loading} shape="rows" rows={3} />
        ) : null}
        {error ? (
          <div className="alert" data-tone="danger" role="alert">
            <span>
              {error === 'access-changed'
                ? messages[locale].accessChanged
                : text.unavailable}
            </span>
            <button className="btn btn-sm btn-ghost" onClick={reload}>
              {text.refresh}
            </button>
          </div>
        ) : null}
        <div ref={surface} hidden={!data || busy}>
          {data && sessionEmployee ? (
            <>
              {data.requests.length ? (
                data.requests.map((request) => {
                  const amendments = data.amendments.filter(
                    (a) => a.request_id === request.id,
                  );
                  const latestAmendment = amendments[0];
                  const latestObserved =
                    latestAmendment?.observed_values ?? request.observed_values;
                  const latestProposal =
                    latestAmendment?.proposed_values ?? request.proposed_values;
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
                      <p>
                        {text.actor}:{' '}
                        <span translate="no">
                          {data.actors.find(
                            (a) => a.id === request.requester_id,
                          )?.display_name ?? request.requester_id}
                        </span>
                      </p>
                      <p translate="no">{request.explanation}</p>
                      {/* The reviewer judges one change: the fields the proposal names, each
                          with the value that was observed, and nothing else from the record. */}
                      <h4>{text.needsUpdate}</h4>
                      <div className="history-comparison">
                        <section>
                          <h4>{text.before}</h4>
                          <BusinessValues
                            values={
                              changedValues(latestObserved, latestProposal)
                                .observed
                            }
                            locale={locale}
                          />
                        </section>
                        <section>
                          <h4>{text.after}</h4>
                          <BusinessValues
                            values={latestProposal}
                            locale={locale}
                          />
                        </section>
                      </div>
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
                          employee={sessionEmployee}
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
