'use client';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { api, RequestError } from './api';
import {
  EMPLOYEE_ROLES,
  invitationFailure,
  invitationProblemAfterLoad,
  invitationStatus,
  mayAdministerEmployees,
  type EmployeeRole,
  type InvitationFailure,
  type InvitationRecord,
} from './invitation';

// Issue #68: the admin invitation form. It records one normalized email and one existing
// company role under the live admin's authority, then shows what the database recorded and
// what the provider actually returned: an accepted request is shown as a recorded invitation,
// never as delivered mail and never as active access. A retry after an ambiguous failure
// reuses the same submission key and re-reads the recorded state instead of guessing.
export function EmployeeInvitationForm({
  actorRole,
  locale,
  onChanged,
  onDenied,
}: {
  actorRole: string;
  locale: Locale;
  onChanged: () => void;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale];
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<EmployeeRole>('sales');
  const [record, setRecord] = useState<InvitationRecord | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const targetRef = useRef<string | null>(null);
  const [problem, setProblem] = useState<InvitationFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(() =>
    typeof crypto === 'undefined' ? null : crypto.randomUUID(),
  );

  const reconcile = useCallback((address: string) => {
    targetRef.current = address;
    setSubmitted(address);
    setLoading(true);
    setRefresh((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!submitted) return;
    const abort = new AbortController();
    const superseded = () =>
      abort.signal.aborted || targetRef.current !== submitted;
    api<InvitationRecord>(
      '/api/employees/invitations?email=' + encodeURIComponent(submitted),
      undefined,
      abort.signal,
    )
      .then((value) => {
        if (superseded()) return;
        setRecord(value);
        setLoadProblem(null);
        setProblem((current) =>
          value.employee ? invitationProblemAfterLoad(current) : current,
        );
      })
      .catch((failure: unknown) => {
        if (superseded()) return;
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
  }, [submitted, refresh, onDenied]);

  const invitation = record?.invitation ?? null;
  const status = invitationStatus(invitation);
  const shownProblem = problem?.code ?? loadProblem;
  const problemText: Record<string, string> = {
    'invitation-email-recorded': text.employeeInviteEmailRecorded,
    'invitation-already-recorded': text.employeeInviteAlreadyRecorded,
    'invitation-role-conflict': text.employeeInviteRoleConflict,
    'invitation-key-conflict': text.employeeInviteKeyConflict,
    'invitation-changed': text.employeeInviteChanged,
    'invitation-stale': text.employeeInviteStale,
    'provider-unavailable': text.employeeInviteProviderUnavailable,
    'invalid-input': text.invalidInput,
    'access-denied': text.denied,
    unavailable: text.unavailable,
    'not-found': text.employeeInviteLoadFailed,
  };
  const statusLabel =
    status === 'recorded'
      ? text.employeeInviteRecordedLabel
      : status === 'reconciliation'
        ? text.employeeInviteReconciliationLabel
        : status === 'pending'
          ? text.employeeInvitePendingLabel
          : text.employeeInviteNoneLabel;
  const statusTone =
    status === 'recorded'
      ? 'success'
      : status === 'reconciliation'
        ? 'danger'
        : 'muted';
  const actionable =
    mayAdministerEmployees(actorRole) && actionKey !== null && !busy;
  // A recorded invitation cannot be sent again, so the form only offers a retry while the
  // provider step is pending or failed.
  const retriable =
    mayAdministerEmployees(actorRole) &&
    actionKey !== null &&
    !busy &&
    (status === 'pending' || status === 'reconciliation');

  async function send(address: string, targetRole: EmployeeRole) {
    if (busy || !actionKey) return;
    targetRef.current = address;
    if (record?.employee && record.employee.email !== address) {
      setRecord(null);
      setSubmitted(null);
      setLoading(false);
    }
    setBusy(true);
    setLoadProblem(null);
    setProblem(null);
    setNotice(null);
    try {
      const next = await api<InvitationRecord>('/api/employees/invitations', {
        email: address,
        role: targetRole,
        key: actionKey,
      });
      setRecord(next);
      const recorded = invitationStatus(next.invitation);
      if (recorded === 'recorded') {
        setNotice(text.employeeInviteSuccess);
        // The recorded invitation is terminal for this key: a later person is a new action.
        setActionKey(crypto.randomUUID());
      } else if (recorded === 'reconciliation') {
        setNotice(text.employeeInviteFailed);
      } else {
        setNotice(text.employeeInvitePending);
      }
      onChanged();
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      const classified = invitationFailure(
        failure instanceof RequestError ? failure : null,
      );
      // Only a genuinely ambiguous response may have sent the invitation; reconcile the same
      // recorded action instead of guessing, and keep the key for the retry.
      if (classified.ambiguous) {
        reconcile(address);
        onChanged();
      }
      if (classified.code === 'invitation-key-conflict')
        setActionKey(crypto.randomUUID());
      setProblem(classified);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim().toLowerCase();
    if (!address) return;
    await send(address, role);
  }

  async function retry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!record?.employee || !invitation) return;
    await send(record.employee.email, invitation.role);
  }

  return (
    <div>
      <p className="panel-note">{text.employeeInviteNote}</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy} className="stack-4">
          <div className="field">
            <label className="field-label" htmlFor="employee-invite-email">
              {text.email} <span className="field-req">*</span>
            </label>
            <input
              id="employee-invite-email"
              className="input"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <p className="field-hint">{text.employeeInviteEmailHint}</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="employee-invite-role">
              {text.employeeRole} <span className="field-req">*</span>
            </label>
            <select
              id="employee-invite-role"
              className="input"
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as EmployeeRole)}
            >
              {EMPLOYEE_ROLES.map((value) => (
                <option key={value} value={value}>
                  {label(locale, value)}
                </option>
              ))}
            </select>
            <p className="field-hint">{text.employeeInviteRoleHint}</p>
          </div>
        </fieldset>
        {shownProblem ? (
          <p role="alert" className="field-error">
            {problemText[shownProblem] ?? text.unavailable}
          </p>
        ) : null}
        {notice ? (
          <p className="panel-note" role="status">
            {notice}
          </p>
        ) : null}
        <div className="form-foot">
          <button className="btn btn-primary" disabled={!actionable}>
            {busy ? text.saving : text.employeeInviteSubmit}
          </button>
        </div>
      </form>

      {record?.employee ? (
        <div className="invitation-record">
          <dl className="summary-list">
            <div className="summary-row">
              <dt>{text.employeeInviteTarget}</dt>
              <dd translate="no">{record.employee.email}</dd>
            </div>
            <div className="summary-row">
              <dt>{text.employeeRole}</dt>
              <dd>{label(locale, invitation?.role ?? record.employee.role)}</dd>
            </div>
            <div className="summary-row">
              <dt>{text.employeeInviteState}</dt>
              <dd>
                {loading ? (
                  text.loading
                ) : (
                  <span className="badge" data-tone={statusTone}>
                    {statusLabel}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          {status === 'recorded' ? (
            <p className="field-hint">{text.employeeInviteDeliveryNote}</p>
          ) : status === 'none' ? null : (
            <p className="field-hint">{text.employeeInviteUnconfirmedNote}</p>
          )}
          {invitation?.providerDetail ? (
            <p className="field-hint" translate="no">
              {invitation.providerDetail}
            </p>
          ) : null}
          {retriable ? (
            <form onSubmit={retry}>
              <button className="btn btn-sm btn-ghost" type="submit">
                {text.retry}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
