'use client';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { label, messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { vietnamDate, vietnamTimestamp } from '@/features/properties/format';
import { SALE_REFERENCE_MAX } from './rules';
import type { SaleCompletionState } from './types';

const accessLabel = {
  active: 'employeeAccessActive',
  inactive: 'employeeAccessInactive',
  unlinked: 'employeeAccessUnlinked',
} as const;

// Reviewer-only confirmation of an actual completed sale. The database decides independence,
// eligibility and atomic effects; this panel only collects the explicit credited closer, the
// actual Vietnam completion date and the contract reference the reviewer confirmed.
export function SaleCompletion({
  propertyId,
  locale,
  employeeId,
  onDenied,
  onSaved,
}: {
  propertyId: string;
  locale: Locale;
  employeeId: string;
  onDenied: (status: number) => void;
  onSaved: () => void;
}) {
  const text = messages[locale],
    headingId = useId(),
    closerId = useId(),
    dateId = useId(),
    referenceId = useId(),
    helpId = useId();
  const [state, setState] = useState<SaleCompletionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [closer, setCloser] = useState('');
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);
  // One client-chosen key per draft, so an interrupted or ambiguous confirmation retries the
  // same logical completion instead of recording another one.
  const key = useRef<string>('');
  const dateTouched = useRef(false);
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
    api<SaleCompletionState>(
      '/api/properties/' + propertyId + '/sale-completion',
      undefined,
      abort.signal,
    )
      .then((value) => {
        if (version !== generation.current) return;
        setState(value);
        setLoadFailed(false);
        if (!dateTouched.current) setDate(value.today);
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
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !state) return;
    key.current ||= crypto.randomUUID();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api<SaleCompletionState>(
        '/api/properties/' + propertyId + '/sale-completion',
        {
          creditedEmployeeId: closer,
          completedOn: date,
          reference,
          key: key.current,
        },
      );
      setState(next);
      setCloser('');
      setReference('');
      dateTouched.current = false;
      key.current = '';
      setNotice(text.completedSaleRecorded);
      onSaved();
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
        [
          'completion-conflict',
          'sale-unavailable',
          'reservation-conflict',
          'rental-active',
        ].includes(problem.code)
      )
        setRefresh((value) => value + 1);
      setError(problem instanceof RequestError ? problem.code : 'unavailable');
    } finally {
      setSaving(false);
    }
  }
  function message(code: string | null): string {
    if (code === 'invalid-input') return text.completedSaleReferenceRequired;
    if (code === 'future-date') return text.completedSaleFutureDate;
    if (code === 'self-credit-forbidden') return text.completedSaleSelfCredit;
    if (code === 'completion-conflict') return text.completedSaleConflict;
    if (code === 'reservation-conflict')
      return text.completedSaleReservationConflict;
    if (code === 'rental-active') return text.completedSaleRentalActive;
    if (code === 'sale-unavailable') return text.completedSaleUnavailable;
    return text.completedSaleFailed;
  }
  function blockedMessage(block: NonNullable<SaleCompletionState['blocked']>) {
    if (block === 'archived') return text.completedSaleArchived;
    if (block === 'rental') return text.completedSaleRentalActive;
    if (block === 'no-credited-employee') return text.completedSaleNoCloser;
    return text.completedSaleUnavailable.replace(
      '{status}',
      label(locale, state?.status),
    );
  }
  const suggestion = state?.suggestedCloser;
  return (
    <section
      className="panel sale-completion"
      data-loaded={state ? 'yes' : 'no'}
      aria-labelledby={headingId}
    >
      <h2 id={headingId}>{text.completedSaleTitle}</h2>
      {loading && !state ? <p role="status">{text.loading}</p> : null}
      {loadFailed ? (
        <p role="alert">
          {text.completedSaleLoadFailed}{' '}
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
      {state?.completion ? (
        <div className="sale-completion-recorded">
          <p>
            <span className="badge">{text.sold}</span>
          </p>
          <dl>
            <dt>{text.completedSaleCreditedCloser}</dt>
            <dd translate="no">{state.completion.creditedEmployeeName}</dd>
            <dt>{text.completedSaleDate}</dt>
            <dd>{vietnamDate(state.completion.completedOn)}</dd>
            <dt>{text.completedSaleReference}</dt>
            <dd translate="no">{state.completion.reference}</dd>
            <dt>{text.completedSalePreviousStatus}</dt>
            <dd>{label(locale, state.completion.previousStatus)}</dd>
            <dt>{text.completedSaleRecordedBy}</dt>
            <dd translate="no">{state.completion.confirmedByName}</dd>
            <dt>{text.completedSaleRecordedAt}</dt>
            <dd>
              {vietnamTimestamp(state.completion.confirmedAt, locale)}{' '}
              <span className="field-hint">{text.vietnamTime}</span>
            </dd>
          </dl>
        </div>
      ) : state?.blocked ? (
        <p className="field-hint">{blockedMessage(state.blocked)}</p>
      ) : state ? (
        <form onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor={closerId}>
              {text.completedSaleCreditedCloser}
            </label>
            <select
              className="select"
              id={closerId}
              name="creditedEmployeeId"
              required
              value={closer}
              onChange={(event) => setCloser(event.target.value)}
              disabled={saving}
            >
              <option value="">{text.completedSaleSelectCloser}</option>
              {state.employees.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.displayName}
                  {row.access === 'active'
                    ? ''
                    : ` — ${text[accessLabel[row.access]]}`}
                </option>
              ))}
            </select>
          </div>
          {suggestion && suggestion.id !== employeeId ? (
            <p className="field-hint">
              {text.completedSaleSuggestedCloser.replace(
                '{name}',
                suggestion.name,
              )}
            </p>
          ) : null}
          <div className="field">
            <label className="field-label" htmlFor={dateId}>
              {text.completedSaleDate}
            </label>
            <input
              className="input"
              id={dateId}
              name="completedOn"
              type="date"
              required
              max={state.today}
              value={date}
              onChange={(event) => {
                dateTouched.current = true;
                setDate(event.target.value);
              }}
              disabled={saving}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={referenceId}>
              {text.completedSaleReference}
            </label>
            <input
              className="input"
              id={referenceId}
              name="reference"
              type="text"
              required
              maxLength={SALE_REFERENCE_MAX}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              aria-describedby={helpId}
              disabled={saving}
            />
          </div>
          <p className="field-hint" id={helpId}>
            {text.completedSaleReferenceHint}
          </p>
          <p className="field-hint">{text.completedSaleClosesReservations}</p>
          {error ? <p role="alert">{message(error)}</p> : null}
          <button
            className="btn btn-sm btn-primary"
            type="submit"
            disabled={saving || !closer || !date || !reference.trim()}
            aria-busy={saving}
          >
            {saving ? text.loading : text.completedSaleSubmit}
          </button>
        </form>
      ) : null}
      <p role="status" aria-live="polite">
        {notice}
      </p>
      <p className="field-hint">{text.completedSaleNote}</p>
    </section>
  );
}
