'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { useToast } from '@/features/toasts/toast-host';
import { LoadingSkeleton } from '@/features/skeleton';
import {
  RESERVATION_DAYS_DEFAULT,
  RESERVATION_DAYS_MAX,
  RESERVATION_DAYS_MIN,
  RESERVATION_REASON_MAX,
  RESERVATION_REASON_MIN,
} from './reservation-rules';
import { vietnamTimestamp } from './format';
import type { ReservationState } from './types';

const requestable = ['available', 'negotiating'];
const days = Array.from(
  { length: RESERVATION_DAYS_MAX - RESERVATION_DAYS_MIN + 1 },
  (_, index) => RESERVATION_DAYS_MIN + index,
);

function DecisionForm({
  claimantName,
  reason,
  requestedAt,
  locale,
  busy,
  error,
  onDecide,
}: {
  claimantName: string;
  reason: string;
  requestedAt: string;
  locale: Locale;
  busy: boolean;
  error: string | null;
  onDecide: (approve: boolean, form: HTMLFormElement) => void;
}) {
  const text = messages[locale],
    reasonId = useId(),
    daysId = useId(),
    helpId = useId();
  return (
    <article className="reservation-request">
      <h3 translate="no">{claimantName}</h3>
      <p className="field-hint">
        {text.reservationRequestedAt}: {vietnamTimestamp(requestedAt, locale)}
      </p>
      <p translate="no">{reason}</p>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          if (submitter instanceof HTMLButtonElement)
            onDecide(submitter.value === 'approve', event.currentTarget);
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor={reasonId}>
            {text.reservationDecisionReason}
          </label>
          <textarea
            id={reasonId}
            className="textarea"
            name="reason"
            rows={3}
            required
            minLength={RESERVATION_REASON_MIN}
            maxLength={RESERVATION_REASON_MAX}
            aria-describedby={helpId}
            disabled={busy}
          />
        </div>
        <p className="field-hint" id={helpId}>
          {text.reservationReasonHint}
        </p>
        <div className="field">
          <label className="field-label" htmlFor={daysId}>
            {text.reservationDays}
          </label>
          <select
            id={daysId}
            className="select"
            name="days"
            defaultValue={RESERVATION_DAYS_DEFAULT}
            disabled={busy}
          >
            {days.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <button
          className="btn btn-sm btn-primary"
          type="submit"
          value="approve"
          disabled={busy}
        >
          {text.reservationApprove}
        </button>
        <button
          className="btn btn-sm btn-ghost"
          type="submit"
          value="reject"
          disabled={busy}
        >
          {text.reservationReject}
        </button>
      </form>
    </article>
  );
}

function ReleaseForm({
  locale,
  busy,
  error,
  onSubmit,
}: {
  locale: Locale;
  busy: boolean;
  error: string | null;
  onSubmit: (form: HTMLFormElement) => void;
}) {
  const text = messages[locale],
    reasonId = useId(),
    helpId = useId();
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(event.currentTarget);
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor={reasonId}>
          {text.reservationReleaseReason}
        </label>
        <textarea
          id={reasonId}
          className="textarea"
          name="reason"
          rows={3}
          required
          minLength={RESERVATION_REASON_MIN}
          maxLength={RESERVATION_REASON_MAX}
          aria-describedby={helpId}
          disabled={busy}
        />
      </div>
      <p className="field-hint" id={helpId}>
        {text.reservationReleaseReasonHint}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      <button className="btn btn-sm btn-ghost" type="submit" disabled={busy}>
        {busy ? text.loading : text.reservationReleaseSubmit}
      </button>
      <p className="field-hint">{text.reservationReleaseNote}</p>
    </form>
  );
}

export function Reservation({
  propertyId,
  locale,
  status,
  archived,
  employeeId,
  onDenied,
  onCommitted,
}: {
  propertyId: string;
  locale: Locale;
  status: string;
  archived: boolean;
  employeeId: string;
  onDenied: (status: number) => void;
  // A committed reservation closes the dialog it was recorded from; the confirmation then
  // follows the person onto the page.
  onCommitted: () => void;
}) {
  const text = messages[locale],
    requestReasonId = useId(),
    requestHelpId = useId();
  const notify = useToast();
  const [state, setState] = useState<ReservationState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState<{
    id: string;
    code: string;
  } | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  // A mutation's snapshot wins over any read that started before it committed.
  const apply = useCallback((next: ReservationState) => {
    inFlight.current?.abort();
    generation.current += 1;
    setState(next);
  }, []);
  const failure = useCallback(
    (problem: unknown, set: (code: string) => void) => {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      ) {
        onDenied(problem.status);
        return;
      }
      set(problem instanceof RequestError ? problem.code : 'unavailable');
    },
    [onDenied],
  );
  useEffect(() => {
    inFlight.current?.abort();
    const abort = new AbortController();
    inFlight.current = abort;
    const version = ++generation.current;
    api<ReservationState>(
      '/api/properties/' + propertyId + '/reservations',
      undefined,
      abort.signal,
    )
      .then((value) => {
        if (version !== generation.current) return;
        setState(value);
        setLoadFailed(false);
      })
      .catch((problem: unknown) => {
        if (version !== generation.current || abort.signal.aborted) return;
        failure(problem, () => setLoadFailed(true));
      })
      .finally(() => {
        if (version === generation.current) setLoading(false);
      });
    return () => abort.abort();
  }, [propertyId, refresh, failure]);
  const own = state?.pending.find(
    (request) => request.claimantId === employeeId,
  );
  // The database commits the decision and returns the fresh state, so the browser shows what
  // was actually recorded rather than an optimistic guess.
  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (posting) return;
    setPosting(true);
    setPostError(null);
    try {
      const next = await api<ReservationState>(
        '/api/properties/' + propertyId + '/reservations',
        { reason: draft },
      );
      apply(next);
      setDraft('');
      notify({ saved: true, message: text.reservationRequested });
      onCommitted();
    } catch (problem) {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      ) {
        onDenied(problem.status);
        return;
      }
      // A conflict means the committed state moved on: refetch instead of guessing.
      if (
        problem instanceof RequestError &&
        problem.code === 'reservation-conflict'
      )
        setRefresh((value) => value + 1);
      setPostError(
        problem instanceof RequestError ? problem.code : 'unavailable',
      );
    } finally {
      setPosting(false);
    }
  }
  async function decide(
    lockId: string,
    approve: boolean,
    form: HTMLFormElement,
  ) {
    if (deciding) return;
    const data = new FormData(form);
    setDeciding(lockId);
    setDecisionError(null);
    try {
      const next = await api<ReservationState>(
        '/api/properties/' + propertyId + '/reservations/decision',
        {
          lockId,
          approve,
          reason: data.get('reason'),
          days: Number(data.get('days')),
        },
      );
      apply(next);
      notify({
        saved: true,
        message: approve ? text.reservationApproved : text.reservationRejected,
      });
      onCommitted();
    } catch (problem) {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      ) {
        onDenied(problem.status);
        return;
      }
      if (problem instanceof RequestError)
        setDecisionError({
          id: lockId,
          code: problem.code,
        });
      else setDecisionError({ id: lockId, code: 'unavailable' });
      if (
        problem instanceof RequestError &&
        ['reservation-conflict', 'reservation-unavailable'].includes(
          problem.code,
        )
      )
        setRefresh((value) => value + 1);
    } finally {
      setDeciding(null);
    }
  }
  function message(code: string | null, fallback: string) {
    if (code === 'invalid-input') return text.reservationReasonRequired;
    if (code === 'reservation-conflict') return text.reservationConflict;
    if (code === 'reservation-unavailable')
      return text.reservationNotProceeding;
    if (code === 'reservation-closed') return text.reservationReleaseClosed;
    if (code === 'self-approval-forbidden') return text.reservationSelfApproval;
    if (code === 'not-found') return text.notFound;
    return fallback;
  }
  // The audited release keeps the original claimant and every recorded event; a completed
  // sale of another claimant must go through it instead of rewriting the reservation.
  async function release(lockId: string, form: HTMLFormElement) {
    if (releasing) return;
    const data = new FormData(form);
    setReleasing(true);
    setReleaseError(null);
    try {
      const next = await api<ReservationState>(
        '/api/properties/' + propertyId + '/reservations/release',
        { lockId, reason: data.get('reason') },
      );
      apply(next);
      notify({ saved: true, message: text.reservationReleased });
      onCommitted();
    } catch (problem) {
      if (
        problem instanceof RequestError &&
        (problem.status === 401 || problem.status === 403)
      ) {
        onDenied(problem.status);
        return;
      }
      if (
        problem instanceof RequestError &&
        problem.code === 'reservation-closed'
      )
        setRefresh((value) => value + 1);
      setReleaseError(
        problem instanceof RequestError ? problem.code : 'unavailable',
      );
    } finally {
      setReleasing(false);
    }
  }
  const effective = state?.effective ?? null;
  return (
    <section
      className="panel reservation"
      data-loaded={state ? 'yes' : 'no'}
      aria-label={text.reservations}
    >
      {loading && !state ? (
        <LoadingSkeleton
          label={text.loading}
          className="skeleton-inset"
          shape="rows"
          rows={3}
        />
      ) : null}
      {loadFailed ? (
        <p role="alert">
          {text.reservationLoadFailed}{' '}
          <button
            className="btn btn-sm btn-ghost"
            type="button"
            onClick={() => {
              setLoading(true);
              setRefresh((value) => value + 1);
            }}
          >
            {text.retry}
          </button>
        </p>
      ) : null}
      {state ? (
        <>
          {effective ? (
            <div className="reservation-effective">
              <p>
                <span className="badge">{text.reservationEffective}</span>
              </p>
              <dl>
                <dt>{text.reservationClaimant}</dt>
                <dd translate="no">{effective.claimantName}</dd>
                <dt>{text.reservationExpires}</dt>
                <dd>
                  {vietnamTimestamp(effective.expiresAt, locale)}{' '}
                  <span className="field-hint">{text.vietnamTime}</span>
                </dd>
              </dl>
              {state.canDecide ? (
                <ReleaseForm
                  locale={locale}
                  busy={releasing}
                  error={
                    releaseError
                      ? message(releaseError, text.reservationReleaseFailed)
                      : null
                  }
                  onSubmit={(form) => void release(effective.id, form)}
                />
              ) : null}
            </div>
          ) : null}
          {own ? (
            <div className="reservation-pending">
              <p>
                <span className="badge">{text.reservationPending}</span>
              </p>
              <dl>
                <dt>{text.reservationRequestedAt}</dt>
                <dd>
                  {vietnamTimestamp(own.requestedAt, locale)}{' '}
                  <span className="field-hint">{text.vietnamTime}</span>
                </dd>
                <dt>{text.reservationPendingExpires}</dt>
                <dd>
                  {vietnamTimestamp(own.expiresAt, locale)}{' '}
                  <span className="field-hint">{text.vietnamTime}</span>
                </dd>
              </dl>
              <p className="field-hint">{text.reservationPendingNote}</p>
            </div>
          ) : null}
          {!state.effective && !own ? (
            archived ? (
              <p className="field-hint">{text.reservationArchived}</p>
            ) : requestable.includes(status) ? (
              <form onSubmit={submitRequest}>
                <div className="field">
                  <label className="field-label" htmlFor={requestReasonId}>
                    {text.reservationReason}
                  </label>
                  <textarea
                    id={requestReasonId}
                    className="textarea"
                    name="reason"
                    rows={3}
                    required
                    minLength={RESERVATION_REASON_MIN}
                    maxLength={RESERVATION_REASON_MAX}
                    aria-describedby={requestHelpId}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={posting}
                  />
                </div>
                <p className="field-hint" id={requestHelpId}>
                  {text.reservationReasonHint}
                </p>
                {postError ? (
                  <p role="alert">
                    {message(postError, text.reservationRequestFailed)}
                  </p>
                ) : null}
                <button
                  className="btn btn-sm btn-primary"
                  type="submit"
                  disabled={posting}
                  aria-busy={posting}
                >
                  {posting ? text.loading : text.submitReservation}
                </button>
              </form>
            ) : (
              <p className="field-hint">{text.reservationUnavailable}</p>
            )
          ) : null}
          {state.canDecide ? (
            <>
              <h3>{text.reservationRequests}</h3>
              {state.pending.length ? (
                // The database refuses every decision on an archived property, so show the
                // archived notice instead of a control that cannot succeed.
                state.pending.map((request) => {
                  const isOwn = request.claimantId === employeeId;
                  return isOwn || archived ? (
                    <article className="reservation-request" key={request.id}>
                      <h4 translate="no">{request.claimantName}</h4>
                      <p className="field-hint">
                        {text.reservationRequestedAt}:{' '}
                        {vietnamTimestamp(request.requestedAt, locale)}
                      </p>
                      <p translate="no">{request.reason}</p>
                      <p className="field-hint">
                        {isOwn
                          ? text.reservationSelfApproval
                          : text.reservationArchived}
                      </p>
                    </article>
                  ) : (
                    <DecisionForm
                      key={request.id}
                      claimantName={request.claimantName}
                      reason={request.reason}
                      requestedAt={request.requestedAt}
                      locale={locale}
                      busy={deciding === request.id}
                      error={
                        decisionError?.id === request.id
                          ? message(
                              decisionError.code,
                              text.reservationDecisionFailed,
                            )
                          : null
                      }
                      onDecide={(approve, form) =>
                        void decide(request.id, approve, form)
                      }
                    />
                  );
                })
              ) : (
                <p className="field-hint">{text.reservationNoRequests}</p>
              )}
            </>
          ) : null}
        </>
      ) : null}
      <p className="field-hint">{text.reservationNote}</p>
    </section>
  );
}
