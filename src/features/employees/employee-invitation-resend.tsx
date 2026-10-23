'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { vietnamTimestamp } from '@/features/properties/format';
import { api, RequestError } from './api';
import { useToast } from '@/features/toasts/toast-host';
import { LoadingSkeleton } from '@/features/skeleton';
import {
  invitationFailure,
  invitationProblemAfterLoad,
  mayAdministerEmployees,
  resendableInvitation,
  type InvitationFailure,
  type InvitationRecord,
} from './invitation';
import type { DirectoryEntry } from './directory';

// The confirmation a live admin opens from the employee list to send a recorded invitation
// again. Production invitations expired after an hour, so this is how an invited person who
// never got in receives a working link. It shows the recorded target and the role that stays
// recorded, then the recorded outcome of the further send: the provider's acceptance with the
// time it was sent, or the refusal with the earlier recorded state still in view.
export function EmployeeInvitationResendPanel({
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
  const [record, setRecord] = useState<InvitationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [actionProblem, setActionProblem] = useState<InvitationFailure | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const load = useCallback(() => setRefresh((value) => value + 1), []);

  useEffect(() => {
    const abort = new AbortController();
    api<InvitationRecord>(
      '/api/employees/invitations?email=' + encodeURIComponent(employee.email),
      undefined,
      abort.signal,
    )
      .then((value) => {
        setRecord(value);
        setLoadProblem(null);
        setActionProblem((current) => invitationProblemAfterLoad(current));
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
  }, [employee.email, refresh, onDenied]);

  const invitation = record?.invitation ?? null;
  const problem = actionProblem?.code ?? loadProblem;
  const problemText: Record<string, string> = {
    'invitation-not-accepted': text.employeeInviteResendNotRecorded,
    'invitation-already-accepted': text.employeeInviteAlreadyAccepted,
    'invitation-changed': text.employeeInviteChanged,
    'invitation-stale': text.employeeInviteStale,
    'provider-unavailable': text.employeeInviteProviderUnavailable,
    'invalid-input': text.invalidInput,
    'not-found': text.employeeInviteLoadFailed,
    unavailable: text.unavailable,
  };
  const resentAt = vietnamTimestamp(invitation?.resendAttemptedAt, locale);
  const resendLabel =
    invitation?.resendOutcome === 'accepted'
      ? text.employeeInviteResendSentLabel
      : invitation?.resendOutcome === 'failed'
        ? text.employeeInviteResendFailedLabel
        : invitation?.resendOutcome === 'ambiguous'
          ? text.employeeInviteResendUnconfirmedLabel
          : null;
  const resendTone =
    invitation?.resendOutcome === 'accepted'
      ? 'success'
      : invitation?.resendOutcome === 'failed'
        ? 'danger'
        : 'muted';
  const actionable =
    mayAdministerEmployees(actorRole) &&
    !busy &&
    !loading &&
    problem === null &&
    !!record &&
    resendableInvitation(
      record.invitation,
      record.employee?.access ?? 'unlinked',
    );

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setActionProblem(null);
    setNotice(null);
    try {
      const next = await api<InvitationRecord>(
        '/api/employees/invitations/resend',
        { email: employee.email },
      );
      setRecord(next);
      const outcome = next.invitation?.resendOutcome ?? null;
      if (outcome === 'accepted') {
        notify({ saved: true, message: text.employeeInviteResendSuccess });
      } else {
        // The provider refused or did not answer: say so and keep the recorded state that the
        // last accepted send left behind on screen.
        setNotice(
          outcome === 'failed'
            ? text.employeeInviteResendFailed
            : text.employeeInviteResendUnconfirmed,
        );
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
      // A lost or server-side response may have sent the mail: re-read the recorded state
      // instead of guessing, and leave a definite refusal on screen as it is.
      if (classified.ambiguous) {
        load();
        onChanged();
      }
      setActionProblem(classified);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="deactivation-panel">
      <dl className="summary-list">
        <div className="summary-row">
          <dt>{text.employeeInviteTarget}</dt>
          <dd translate="no">{employee.email}</dd>
        </div>
        <div className="summary-row">
          <dt>{text.employeeRole}</dt>
          <dd>{label(locale, invitation?.role ?? employee.role)}</dd>
        </div>
        <div className="summary-row">
          <dt>{text.employeeInviteResendCountLabel}</dt>
          <dd>
            {loading ? (
              <LoadingSkeleton label={text.loading} shape="lines" rows={1} />
            ) : (
              (invitation?.resendCount ?? 0)
            )}
          </dd>
        </div>
        <div className="summary-row">
          <dt>{text.employeeInviteResendLast}</dt>
          <dd>
            {loading ? (
              <LoadingSkeleton label={text.loading} shape="lines" rows={1} />
            ) : resentAt ? (
              <>
                <span className="badge" data-tone={resendTone}>
                  {resendLabel}
                </span>
                <span>{resentAt}</span>
              </>
            ) : (
              text.employeeInviteResendNever
            )}
          </dd>
        </div>
      </dl>
      {invitation?.resendDetail ? (
        <p className="field-hint" translate="no">
          {invitation.resendDetail}
        </p>
      ) : null}

      <p className="panel-note">{text.employeeInviteResendNote}</p>
      <p className="field-hint">{text.employeeInviteResendRoleNote}</p>

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
              {busy ? text.loading : text.employeeInviteResendConfirm}
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
