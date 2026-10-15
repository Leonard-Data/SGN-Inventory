'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { vietnamTimestamp } from '@/features/properties/format';
import { api, RequestError } from './api';
import {
  deactivationFailure,
  deactivationProblemAfterLoad,
  type DeactivationFailure,
} from './deactivation';
import {
  deletionResumable,
  deletionStatus,
  mayAdministerEmployees,
  type DeletionConfirmation,
} from './deletion';
import type { DirectoryEntry } from './directory';

// Issue #67: the permanent-deletion confirmation a live admin opens from the employee list.
// It names the exact retained employee, states that the sign-in account is permanently
// removed while business records remain, requires the employee's own email to be typed
// before the destructive control enables, and shows the recorded
// pending/reconciliation/storage-blocked/confirmed state instead of an optimistic guess.
export function EmployeeAccountDeletionPanel({
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
  const [snapshot, setSnapshot] = useState<DeletionConfirmation | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [actionProblem, setActionProblem] =
    useState<DeactivationFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  // One client key per opened confirmation: a retry after an ambiguous failure reuses it, so
  // the same action reconciles instead of creating a conflicting lifecycle event.
  const [actionKey] = useState<string | null>(() =>
    typeof crypto === 'undefined' ? null : crypto.randomUUID(),
  );
  const [refresh, setRefresh] = useState(0);
  const typedRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    setRefresh((value) => value + 1);
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    api<DeletionConfirmation>(
      '/api/employees/' + employee.id + '/deletion',
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
  const status = deletionStatus(operation);
  const problemText: Record<string, string> = {
    'last-admin': text.employeeDeleteLastAdmin,
    'not-deletable': text.employeeDeleteNotDeletable,
    'lifecycle-conflict': text.employeeDeleteLifecycleConflict,
    'deletion-key-conflict': text.employeeDeleteKeyConflict,
    'stale-operation': text.employeeDeleteStale,
    'provider-unavailable': text.employeeDeleteProviderUnavailable,
    'invalid-input': text.invalidInput,
    'not-found': text.employeeDeleteLoadFailed,
    unavailable: text.unavailable,
  };
  const statusLabel =
    status === 'confirmed'
      ? text.employeeDeleteConfirmedLabel
      : status === 'storage-blocked'
        ? text.employeeDeleteStorageBlockedLabel
        : status === 'reconciliation'
          ? text.employeeDeleteReconciliationLabel
          : status === 'pending'
            ? text.employeeDeletePendingLabel
            : null;
  const statusTone =
    status === 'confirmed'
      ? 'success'
      : status === 'storage-blocked'
        ? 'danger'
        : status === 'reconciliation'
          ? 'danger'
          : status === 'pending'
            ? 'muted'
            : 'neutral';
  // A failed, blocked or still-pending provider step can be resumed by a currently
  // authorized admin, so the action stays available while the account is unlinked.
  const resumable =
    deletionResumable(operation) && mayAdministerEmployees(actorRole);
  // Only a linked employee has an account left to delete, and only while the action is not
  // already recorded as completed.
  const linked = employee.access === 'active' || employee.access === 'inactive';
  const typedMatches =
    typed.trim().toLowerCase() === employee.email.trim().toLowerCase();
  const confirmable = typedMatches
    ? null
    : typed.trim().length === 0
      ? text.employeeDeleteConfirmRequired
      : text.employeeDeleteConfirmMismatch;
  const actionable =
    mayAdministerEmployees(actorRole) &&
    actionKey !== null &&
    !loading &&
    problem === null &&
    snapshot !== null &&
    (status === 'confirmed' ? false : linked || resumable);
  // Resuming never requires the typed confirmation again: the destructive decision was made
  // when the action was opened. A first deletion always requires it.
  const confirmedByTyping = resumable || typedMatches;

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !actionKey || !confirmedByTyping) {
      if (!confirmedByTyping) typedRef.current?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    setActionProblem(null);
    setNotice(null);
    try {
      const next = await api<DeletionConfirmation>(
        '/api/employees/' + employee.id + '/deletion',
        { key: actionKey },
      );
      setSnapshot(next);
      const recorded = deletionStatus(next.operation);
      if (recorded === 'confirmed') {
        setNotice(text.employeeDeleteSuccess);
        onChanged();
      } else if (recorded === 'storage-blocked') {
        setNotice(text.employeeDeleteStorageBlocked);
        onChanged();
      } else if (recorded === 'reconciliation') {
        setNotice(text.employeeDeleteFailed);
        onChanged();
      } else {
        setNotice(text.employeeDeletePending);
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
          <dt>{text.employeeDeleteTarget}</dt>
          <dd>
            {employee.displayName} · {employee.email} ·{' '}
            {label(locale, employee.role)}
          </dd>
        </div>
        <div>
          <dt>{text.employeeDeleteState}</dt>
          <dd>
            {statusLabel ? (
              <span className="badge" data-tone={statusTone}>
                {statusLabel}
              </span>
            ) : (
              text.employeeAccessActive
            )}
            {operation && operation.storageOwnedCount !== null ? (
              <span className="field-hint">
                {text.employeeDeleteStorageEvidence
                  .replace('{owned}', String(operation.storageOwnedCount))
                  .replace(
                    '{reassigned}',
                    String(operation.storageReassignedCount ?? 0),
                  )}
              </span>
            ) : null}
            {operation?.providerDetail ? (
              <span className="field-hint" translate="no">
                {operation.providerDetail}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>

      <p className="panel-note">{text.employeeDeleteNote}</p>
      <p className="field-hint">{text.employeeDeleteStorageNote}</p>

      <h3>{text.employeeDeactivateOutstanding}</h3>
      {loading ? (
        <p className="panel-note" role="status">
          {text.loading}
        </p>
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
            {!resumable ? (
              <div className="field">
                <label className="field-label" htmlFor="deletion-confirm-email">
                  {text.employeeDeleteConfirmLabel}
                </label>
                <input
                  id="deletion-confirm-email"
                  className="input"
                  type="text"
                  name="confirm-email"
                  autoComplete="off"
                  spellCheck={false}
                  ref={typedRef}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  aria-describedby="deletion-confirm-hint"
                  aria-invalid={confirmable !== null}
                  disabled={busy}
                />
                <p className="field-hint" id="deletion-confirm-hint">
                  {text.employeeDeleteConfirmHint.replace(
                    '{email}',
                    employee.email,
                  )}
                </p>
              </div>
            ) : null}
            <button
              className="btn btn-sm btn-danger"
              type="submit"
              disabled={busy || !confirmedByTyping}
            >
              {busy
                ? text.loading
                : resumable
                  ? text.retry
                  : text.employeeDeleteConfirm}
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
