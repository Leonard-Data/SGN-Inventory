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
import { vietnamTimestamp } from './format';
import type { ReservationState } from './types';

const requestable = ['available', 'negotiating'];
// Mirrors the decision bounds the database enforces; the server validates again.
const days = Array.from({ length: 30 }, (_, index) => index + 1);
const defaultDays = 7;

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
      <p className="muted">
        {text.reservationRequestedAt}: {vietnamTimestamp(requestedAt, locale)}
      </p>
      <p>{reason}</p>
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          if (submitter instanceof HTMLButtonElement)
            onDecide(submitter.value === 'approve', event.currentTarget);
        }}
      >
        <label htmlFor={reasonId}>{text.reservationDecisionReason}</label>
        <textarea
          id={reasonId}
          name="reason"
          rows={3}
          required
          minLength={10}
          maxLength={2000}
          aria-describedby={helpId}
          disabled={busy}
        />
        <p className="muted" id={helpId}>
          {text.reservationReasonHint}
        </p>
        <label htmlFor={daysId}>{text.reservationDays}</label>
        <select
          id={daysId}
          name="days"
          defaultValue={defaultDays}
          disabled={busy}
        >
          {days.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" value="approve" disabled={busy}>
          {text.reservationApprove}
        </button>
        <button type="submit" value="reject" disabled={busy}>
          {text.reservationReject}
        </button>
      </form>
    </article>
  );
}

export function Reservation({
  propertyId,
  locale,
  status,
  archived,
  employeeId,
  onDenied,
}: {
  propertyId: string;
  locale: Locale;
  status: string;
  archived: boolean;
  employeeId: string;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale],
    headingId = useId(),
    requestReasonId = useId(),
    requestHelpId = useId();
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
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);
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
    setNotice(null);
    try {
      const next = await api<ReservationState>(
        '/api/properties/' + propertyId + '/reservations',
        { reason: draft },
      );
      setState(next);
      setDraft('');
      setNotice(text.reservationRequested);
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
    setNotice(null);
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
      setState(next);
      setNotice(approve ? text.reservationApproved : text.reservationRejected);
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
        problem.code === 'reservation-unavailable'
      )
        setRefresh((value) => value + 1);
    } finally {
      setDeciding(null);
    }
  }
  function message(code: string | null, fallback: string) {
    if (code === 'invalid-input') return text.reservationReasonRequired;
    if (code === 'reservation-conflict') return text.reservationConflict;
    if (code === 'reservation-unavailable') return text.reservationUnavailable;
    if (code === 'self-approval-forbidden') return text.reservationSelfApproval;
    if (code === 'not-found') return text.notFound;
    return fallback;
  }
  return (
    <section
      className="panel reservation"
      data-loaded={state ? 'yes' : 'no'}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{text.reservations}</h2>
      {loading && !state ? <p role="status">{text.loading}</p> : null}
      {loadFailed ? (
        <p role="alert">
          {text.reservationLoadFailed}{' '}
          <button
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
          {state.effective ? (
            <div className="reservation-effective">
              <p>
                <span className="badge">{text.reservationEffective}</span>
              </p>
              <dl>
                <dt>{text.reservationClaimant}</dt>
                <dd translate="no">{state.effective.claimantName}</dd>
                <dt>{text.reservationExpires}</dt>
                <dd>
                  {vietnamTimestamp(state.effective.expiresAt, locale)}{' '}
                  <span className="muted">{text.vietnamTime}</span>
                </dd>
              </dl>
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
                  <span className="muted">{text.vietnamTime}</span>
                </dd>
                <dt>{text.reservationPendingExpires}</dt>
                <dd>
                  {vietnamTimestamp(own.expiresAt, locale)}{' '}
                  <span className="muted">{text.vietnamTime}</span>
                </dd>
              </dl>
              <p className="muted">{text.reservationPendingNote}</p>
            </div>
          ) : null}
          {!state.effective && !own ? (
            archived ? (
              <p className="muted">{text.reservationArchived}</p>
            ) : requestable.includes(status) ? (
              <form onSubmit={submitRequest}>
                <label htmlFor={requestReasonId}>
                  {text.reservationReason}
                </label>
                <textarea
                  id={requestReasonId}
                  name="reason"
                  rows={3}
                  required
                  minLength={10}
                  maxLength={2000}
                  aria-describedby={requestHelpId}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={posting}
                />
                <p className="muted" id={requestHelpId}>
                  {text.reservationReasonHint}
                </p>
                {postError ? (
                  <p role="alert">
                    {message(postError, text.reservationRequestFailed)}
                  </p>
                ) : null}
                <button type="submit" disabled={posting} aria-busy={posting}>
                  {posting ? text.loading : text.submitReservation}
                </button>
              </form>
            ) : (
              <p className="muted">{text.reservationUnavailable}</p>
            )
          ) : null}
          {state.canDecide ? (
            <>
              <h3>{text.reservationRequests}</h3>
              {state.pending.length ? (
                state.pending.map((request) =>
                  request.claimantId === employeeId ? (
                    <article className="reservation-request" key={request.id}>
                      <h4 translate="no">{request.claimantName}</h4>
                      <p className="muted">
                        {text.reservationRequestedAt}:{' '}
                        {vietnamTimestamp(request.requestedAt, locale)}
                      </p>
                      <p>{request.reason}</p>
                      <p className="muted">{text.reservationSelfApproval}</p>
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
                  ),
                )
              ) : (
                <p className="muted">{text.reservationNoRequests}</p>
              )}
            </>
          ) : null}
        </>
      ) : null}
      <p role="status" aria-live="polite">
        {notice}
      </p>
      <p className="muted">{text.reservationNote}</p>
    </section>
  );
}
