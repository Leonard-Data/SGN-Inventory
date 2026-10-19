'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { EmployeeDeactivationPanel } from './employee-deactivation';
import { EmployeeAccountDeletionPanel } from './employee-account-deletion';
import { EmployeeInvitationForm } from './employee-invitation';
import { mayAdministerEmployees } from './deactivation';
import {
  deletionResumable,
  deletionStatus,
  type DeletionStatus,
} from './deletion';
import type {
  DirectoryDeactivation,
  DirectoryInvitation,
  DirectoryPage,
  EmployeeAccess,
} from './directory';

// A refused protected read leaves this surface; the panel uses the same rule as the read
// that owns the list.
function redirectDenied(status: number) {
  window.location.replace(status === 403 ? '/access-denied' : '/login');
}

// People → Employees (#65): the admin employee list every later lifecycle control acts
// from. It reads recorded identities through /api/employees; the shell provides the rail,
// topbar and skip link. Loading, empty, error and denial stay distinct states. Issue #66
// adds the guarded deactivation control and the truthful recorded operation state.
export function EmployeeDirectory({
  initialLocale,
  after,
}: {
  initialLocale: Locale;
  after: string | null;
}) {
  const endpoint =
    '/api/employees' + (after ? '?after=' + encodeURIComponent(after) : '');
  const {
    employee: actor,
    data,
    error,
    busy,
    surface,
    logout,
    reload,
  } = useProtectedData<DirectoryPage>(endpoint);
  const [open, setOpen] = useState<{
    id: string;
    panel: 'deactivate' | 'delete';
  } | null>(null);
  const [invitationOpen, setInvitationOpen] = useState(false);
  const invitationDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = invitationDialogRef.current;
    if (!dialog) return;
    if (invitationOpen && !dialog.open) dialog.showModal();
    if (!invitationOpen && dialog.open) dialog.close();
  }, [invitationOpen]);

  // At most one lifecycle confirmation is open at a time.
  const toggle = (id: string, panel: 'deactivate' | 'delete') =>
    setOpen(open?.id === id && open.panel === panel ? null : { id, panel });
  // The sgn-locale cookie is the rendered locale; the shell keeps it equal to the saved
  // preference.
  const locale = initialLocale;
  const text = messages[locale];
  const accessLabel: Record<EmployeeAccess, string> = {
    active: text.employeeAccessActive,
    inactive: text.employeeAccessInactive,
    unlinked: text.employeeAccessUnlinked,
    account_deleted: text.employeeAccessAccountDeleted,
  };
  const accessTone: Record<EmployeeAccess, string> = {
    active: 'success',
    inactive: 'muted',
    unlinked: 'neutral',
    account_deleted: 'danger',
  };
  const deactivationLabel: Record<DirectoryDeactivation['state'], string> = {
    provider_pending: text.employeeDeactivatePendingLabel,
    provider_failed: text.employeeDeactivateReconciliationLabel,
    completed: text.employeeDeactivateConfirmedLabel,
  };
  const deactivationTone: Record<DirectoryDeactivation['state'], string> = {
    provider_pending: 'muted',
    provider_failed: 'danger',
    completed: 'success',
  };
  // The row badge renders the same classification the confirmation panel uses; a blocked
  // Storage ownership step is its own recorded state, not a generic failure.
  const deletionLabel: Record<Exclude<DeletionStatus, 'none'>, string> = {
    pending: text.employeeDeletePendingLabel,
    reconciliation: text.employeeDeleteReconciliationLabel,
    'storage-blocked': text.employeeDeleteStorageBlockedLabel,
    confirmed: text.employeeDeleteConfirmedLabel,
  };
  const deletionTone: Record<DirectoryDeactivation['state'], string> = {
    provider_pending: 'muted',
    provider_failed: 'danger',
    completed: 'success',
  };
  const invitationLabel: Record<DirectoryInvitation['state'], string> = {
    provider_pending: text.employeeInvitePendingLabel,
    provider_failed: text.employeeInviteReconciliationLabel,
    recorded: text.employeeInviteRecordedLabel,
  };
  const invitationTone: Record<DirectoryInvitation['state'], string> = {
    provider_pending: 'muted',
    provider_failed: 'danger',
    recorded: 'success',
  };
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.people}</p>
          <h1>{text.employeeDirectory}</h1>
          <p className="intro-copy">{text.employeeDirectoryNote}</p>
        </div>
      </div>

      {error ? (
        <div className="alert" data-tone="danger" role="alert">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>
            {error === 'invalid-input'
              ? text.invalidInput
              : error === 'sign-out-failed'
                ? text.signOutFailed
                : error === 'access-changed'
                  ? text.accessChanged
                  : text.employeeDirectoryFailed}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={error === 'sign-out-failed' ? logout : reload}
          >
            {text.retry}
          </button>
        </div>
      ) : null}

      {busy ? (
        <LoadingSkeleton
          label={text.loading}
          className="panel page-section"
          shape="table"
          rows={6}
          columns={5}
        />
      ) : null}

      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <section className="panel page-section" aria-labelledby="employees">
            <div className="panel-head">
              <h2 id="employees">{text.employeesLink}</h2>
            </div>
            <div className="panel-body">
              {mayAdministerEmployees(actor?.role ?? '') ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setInvitationOpen(true)}
                >
                  {text.employeeInviteOpen}
                </button>
              ) : null}
              {data.employees.length === 0 ? (
                <div className="state-panel">
                  <h3>{text.employeeDirectoryEmpty}</h3>
                </div>
              ) : (
                <div className="table-wrap">
                  <table className="data-table stackable">
                    <thead>
                      <tr>
                        <th scope="col">{text.employeeName}</th>
                        <th scope="col">{text.email}</th>
                        <th scope="col">{text.employeeRole}</th>
                        <th scope="col">{text.employeeAccess}</th>
                        <th scope="col">{text.employeeActions}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.employees.map((employee) => {
                        const state = employee.deactivation;
                        const resumable =
                          state?.state === 'provider_pending' ||
                          state?.state === 'provider_failed';
                        const deletion = employee.deletion;
                        const resumingDeletion = deletionResumable(deletion);
                        const deletionState = deletionStatus(
                          deletion && {
                            state: deletion.state,
                            providerOutcome: deletion.outcome,
                          },
                        );
                        // Only an employee whose sign-in account is still linked has an
                        // account left to delete.
                        const deletable =
                          employee.access === 'active' ||
                          employee.access === 'inactive';
                        const deactivationOpen =
                          open?.id === employee.id &&
                          open.panel === 'deactivate';
                        const deletionOpen =
                          open?.id === employee.id && open.panel === 'delete';
                        return (
                          <Fragment key={employee.id}>
                            <tr>
                              <th scope="row" data-label={text.employeeName}>
                                {employee.displayName}
                              </th>
                              <td data-label={text.email}>{employee.email}</td>
                              <td data-label={text.employeeRole}>
                                {label(locale, employee.role)}
                              </td>
                              <td data-label={text.employeeAccess}>
                                <span
                                  className="badge"
                                  data-tone={accessTone[employee.access]}
                                >
                                  {accessLabel[employee.access]}
                                </span>
                                {state ? (
                                  <span
                                    className="badge"
                                    data-tone={deactivationTone[state.state]}
                                  >
                                    {deactivationLabel[state.state]}
                                  </span>
                                ) : null}
                                {deletion && deletionState !== 'none' ? (
                                  <span
                                    className="badge"
                                    data-tone={deletionTone[deletion.state]}
                                  >
                                    {deletionLabel[deletionState]}
                                  </span>
                                ) : null}
                                {employee.invitation ? (
                                  <span
                                    className="badge"
                                    data-tone={
                                      invitationTone[employee.invitation.state]
                                    }
                                  >
                                    {invitationLabel[employee.invitation.state]}
                                  </span>
                                ) : null}
                              </td>
                              <td data-label={text.employeeActions}>
                                <div className="cell-actions">
                                  {employee.access === 'active' || resumable ? (
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      aria-label={
                                        resumable
                                          ? text.employeeDeactivateReconcile
                                          : text.employeeDeactivate
                                      }
                                      title={
                                        resumable
                                          ? text.employeeDeactivateReconcile
                                          : text.employeeDeactivate
                                      }
                                      aria-expanded={deactivationOpen}
                                      onClick={() =>
                                        toggle(employee.id, 'deactivate')
                                      }
                                    >
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        aria-hidden="true"
                                      >
                                        <path d="M12 3v10" />
                                        <path d="M6.6 6.6a8 8 0 1 0 10.8 0" />
                                      </svg>
                                    </button>
                                  ) : null}
                                  {deletable || resumingDeletion ? (
                                    <button
                                      type="button"
                                      className="icon-btn"
                                      aria-label={
                                        resumingDeletion
                                          ? text.employeeDeleteReconcile
                                          : text.employeeDelete
                                      }
                                      title={
                                        resumingDeletion
                                          ? text.employeeDeleteReconcile
                                          : text.employeeDelete
                                      }
                                      aria-expanded={deletionOpen}
                                      onClick={() =>
                                        toggle(employee.id, 'delete')
                                      }
                                    >
                                      <svg
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                      >
                                        <path d="M4 7h16" />
                                        <path d="M10 11v6M14 11v6" />
                                        <path d="M6 7l1 13h10l1-13" />
                                        <path d="M9 7V4h6v3" />
                                      </svg>
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                            {deactivationOpen ? (
                              <tr>
                                <td colSpan={5}>
                                  <EmployeeDeactivationPanel
                                    employee={employee}
                                    actorRole={actor?.role ?? ''}
                                    locale={locale}
                                    onChanged={reload}
                                    onDenied={redirectDenied}
                                    onClose={() => setOpen(null)}
                                  />
                                </td>
                              </tr>
                            ) : null}
                            {deletionOpen ? (
                              <tr>
                                <td colSpan={5}>
                                  <EmployeeAccountDeletionPanel
                                    employee={employee}
                                    actorRole={actor?.role ?? ''}
                                    locale={locale}
                                    onChanged={reload}
                                    onDenied={redirectDenied}
                                    onClose={() => setOpen(null)}
                                  />
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {data.employees.length > 0 || after ? (
              <div className="panel-foot">
                <nav className="pagination" aria-label={text.employeeDirectory}>
                  <span className="page-info">
                    {text.employeePageInfo.replace(
                      '{n}',
                      String(data.employees.length),
                    )}
                  </span>
                  <span className="page-buttons">
                    {after ? (
                      <a className="pager-btn" href="/people/employees">
                        {text.first}
                      </a>
                    ) : null}
                    {data.nextCursor ? (
                      <a
                        className="pager-btn"
                        href={
                          '/people/employees?after=' +
                          encodeURIComponent(data.nextCursor)
                        }
                      >
                        {text.next}
                      </a>
                    ) : null}
                  </span>
                </nav>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
      <dialog
        ref={invitationDialogRef}
        className="sgn-dialog"
        aria-labelledby="employee-invitation-title"
        onClose={() => setInvitationOpen(false)}
        onCancel={() => setInvitationOpen(false)}
      >
        <div className="sgn-dialog-panel">
          <div className="sgn-dialog-head">
            <h2 id="employee-invitation-title">{text.employeeInviteOpen}</h2>
            <button
              type="button"
              className="sgn-dialog-close"
              aria-label={text.close}
              onClick={() => setInvitationOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="sgn-dialog-body">
            {invitationOpen ? (
              <EmployeeInvitationForm
                actorRole={actor?.role ?? ''}
                locale={locale}
                onChanged={reload}
                onDenied={redirectDenied}
                onRecorded={() => setInvitationOpen(false)}
              />
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
