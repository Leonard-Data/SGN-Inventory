'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { vietnamTimestamp } from '@/features/properties/format';
import { api, RequestError } from './api';
import { useToast } from '@/features/toasts/toast-host';
import { LoadingSkeleton } from '@/features/skeleton';
import {
  deactivationFailure,
  deactivationProblemAfterLoad,
  deactivationStatus,
  mayAdministerEmployees,
  type DeactivationConfirmation,
  type DeactivationFailure,
} from './deactivation';
import type { DirectoryEntry } from './directory';

// Issue #66: the confirmation panel a live admin opens from the employee list. It shows the
// target identity and the outstanding reservations, warns that release or expiry stays
// explicit, and shows the recorded pending/reconciliation/confirmed state instead of an
// optimistic guess.
export function EmployeeDeactivationPanel({
  employee,
  actorRole,
  locale,
  onChanged,
  onDenied,
  onClose,
}: {
  employee: DirectoryEntry;
  actorRole: string;
  locale: Locale;
  onChanged: () => void;
  onDenied: (status: number) => void;
  onClose: () => void;
}) {
  const text = messages[locale];
  const notify = useToast();
  const [snapshot, setSnapshot] = useState<DeactivationConfirmation | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [actionProblem, setActionProblem] =
    useState<DeactivationFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One client key per opened confirmation: a retry after an ambiguous failure reuses it, so
  // the same action reconciles instead of creating a conflicting lifecycle event.
  const [actionKey] = useState<string | null>(() =>
    typeof crypto === 'undefined' ? null : crypto.randomUUID(),
  );
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(() => {
    setRefresh((value) => value + 1);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    api<DeactivationConfirmation>(
      '/api/employees/' + employee.id + '/deactivation',
      undefined,
      abort.signal,
    )
      .then((value) => {
        setSnapshot(value);
        setLoadProblem(null);
        setActionProblem((current) => deactivationProblemAfterLoad(current));
      })
      .catch((failure: unknown) => {
        if (abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          onDenied(failure.status);
          return;
        }
        setLoadProblem(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [employee.id, refresh, onDenied]);

  const operation = snapshot?.operation ?? null;
  const problem = actionProblem?.code ?? loadProblem;
  const status = deactivationStatus(operation);
  const problemText: Record<string, string> = {
    'last-admin': text.employeeDeactivateLastAdmin,
    'not-deactivable': text.employeeDeactivateNotDeactivable,
    'deactivation-key-conflict': text.employeeDeactivateConflict,
    'stale-operation': text.employeeDeactivateStale,
    'provider-unavailable': text.employeeDeactivateProviderUnavailable,
    'invalid-input': text.invalidInput,
    'not-found': text.employeeDeactivateLoadFailed,
    unavailable: text.unavailable,
  };
  const statusLabel =
    status === 'confirmed'
      ? text.employeeDeactivateConfirmedLabel
      : status === 'reconciliation'
        ? text.employeeDeactivateReconciliationLabel
        : status === 'pending'
          ? text.employeeDeactivatePendingLabel
          : null;
  const statusTone =
    status === 'confirmed'
      ? 'success'
      : status === 'reconciliation'
        ? 'danger'
        : status === 'pending'
          ? 'muted'
          : 'neutral';
  // A failed or still-pending provider step can be resumed by a currently authorized admin,
  // so the action stays available while the employee is no longer active.
  const resumable =
    status === 'pending' || status === 'reconciliation'
      ? mayAdministerEmployees(actorRole)
      : false;
  const actionable =
    mayAdministerEmployees(actorRole) &&
    actionKey !== null &&
    !loading &&
    problem === null &&
    snapshot !== null &&
    (employee.access === 'active' || resumable);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !actionKey) return;
    setBusy(true);
    setActionProblem(null);
    setNotice(null);
    try {
      const next = await api<DeactivationConfirmation>(
        '/api/employees/' + employee.id + '/deactivation',
        { key: actionKey },
      );
      setSnapshot(next);
      const recorded = deactivationStatus(next.operation);
      if (recorded === 'confirmed') {
        notify({ saved: true, message: text.employeeDeactivateSuccess });
        onChanged();
      } else if (recorded === 'reconciliation') {
        setNotice(text.employeeDeactivateFailed);
        onChanged();
      } else {
        setNotice(text.employeeDeactivatePending);
        onChanged();
      }
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      const classified = deactivationFailure(
        failure instanceof RequestError ? failure : null,
      );
      // Only a genuinely ambiguous failure may have committed without returning; re-read the
      // confirmation and the directory with the same action key instead of guessing. A
      // definite refusal keeps its message on screen.
      if (classified.ambiguous) {
        void load();
        onChanged();
      }
      setActionProblem(classified);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deactivation-panel">
      <dl>
        <div>
          <dt>{text.employeeDeactivateTarget}</dt>
          <dd>
            {employee.displayName} · {employee.email} ·{' '}
            {label(locale, employee.role)}
          </dd>
        </div>
        <div>
          <dt>{text.employeeDeactivateState}</dt>
          <dd>
            {statusLabel ? (
              <span className="badge" data-tone={statusTone}>
                {statusLabel}
              </span>
            ) : (
              text.employeeAccessActive
            )}
            {operation?.providerDetail ? (
              <span className="field-hint" translate="no">
                {operation.providerDetail}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <p className="panel-note">{text.employeeDeactivateNote}</p>
      <p className="field-hint">{text.employeeDeactivateBanNote}</p>

      <h3>{text.employeeDeactivateOutstanding}</h3>
      {loading ? (
        <LoadingSkeleton label={text.loading} shape="rows" rows={2} />
      ) : snapshot ? (
        snapshot.reservations.length ? (
          <ul className="deactivation-reservations">
            {snapshot.reservations.map((reservation) => (
              <li key={reservation.id}>
                <strong translate="no">{reservation.propertyCode}</strong>
                {' · '}
                {reservation.kind === 'effective'
                  ? text.employeeDeactivateReservationEffective
                  : text.employeeDeactivateReservationPending}
                {' · '}
                {text.employeeDeactivateReservationExpires}:{' '}
                {vietnamTimestamp(reservation.expiresAt, locale) ??
                  text.unknown}
              </li>
            ))}
          </ul>
        ) : (
          <p className="panel-note">{text.employeeDeactivateNoOutstanding}</p>
        )
      ) : null}
      <p className="field-hint">{text.employeeDeactivateReservationNote}</p>

      {problem ? (
        <div className="alert" data-tone="danger" role="alert">
          <span>{problemText[problem] ?? text.unavailable}</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onClose}
          >
            {text.close}
          </button>
        </div>
      ) : null}
      {notice ? (
        <p className="panel-note" role="status">
          {notice}
        </p>
      ) : null}

      <div className="panel-foot deactivation-actions">
        {actionable ? (
          <form onSubmit={confirm}>
            <button
              className="btn btn-sm btn-primary"
              type="submit"
              disabled={busy}
            >
              {busy
                ? text.loading
                : employee.access === 'active' && status === 'none'
                  ? text.employeeDeactivateConfirm
                  : text.retry}
            </button>
          </form>
        ) : null}
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={onClose}
        >
          {text.close}
        </button>
      </div>
    </div>
  );
}
