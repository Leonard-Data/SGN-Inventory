'use client';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton } from '@/features/skeleton';
import { EmployeeDeactivationPanel } from './employee-deactivation';
import { EmployeeAccountDeletionPanel } from './employee-account-deletion';
import { EmployeeInvitationForm } from './employee-invitation';
import { EmployeeInvitationResendPanel } from './employee-invitation-resend';
import { EmployeeProfilePanel } from './employee-profile-panel';
import { mayAdministerEmployees } from './deactivation';
import {
  employeeActions,
  menuIndex,
  type EmployeeActionId,
} from './action-menu';
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

// The row's actions are one menu, not a row of buttons. The trigger keeps
// aria-haspopup/aria-expanded, opening moves focus to the first item, the arrow keys and
// Home/End walk the items, Escape closes and returns focus to the trigger, and a pointer
// press anywhere outside closes without stealing focus — the contract the record toolbar
// already uses.
function EmployeeActionsMenu({
  label,
  actions,
  labels,
  onPick,
}: {
  label: string;
  actions: EmployeeActionId[];
  labels: Record<EmployeeActionId, string>;
  onPick: (action: EmployeeActionId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [...(menu.current?.querySelectorAll('button') ?? [])];
    if (!items.length) return;
    // The focused item is the base, so the state index is only a fallback.
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = menuIndex(event.key, at >= 0 ? at : index, items.length);
    if (next === null) return;
    event.preventDefault();
    setIndex(next);
    items[next]?.focus();
  }
  return (
    <div className="cell-actions action-popover-wrap" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setIndex(0);
          setOpen(!open);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menu}
          className="action-popover"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setOpen(false);
          }}
        >
          {actions.map((action, at) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              tabIndex={at === index ? 0 : -1}
              onFocus={() => setIndex(at)}
              onClick={() => {
                setOpen(false);
                // The panel the action opens is a row below this one, so the trigger stays
                // the anchor rather than leaving focus on the body.
                trigger.current?.focus();
                onPick(action);
              }}
            >
              {labels[action]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
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
    panel: 'deactivate' | 'delete' | 'profile' | 'resend';
    opener: HTMLElement | null;
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
  const toggle = (
    id: string,
    panel: 'deactivate' | 'delete' | 'profile' | 'resend',
  ) => {
    setOpen(
      open?.id === id && open.panel === panel
        ? null
        : { id, panel, opener: document.activeElement as HTMLElement },
    );
  };
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
  const editing =
    open?.panel === 'profile'
      ? data?.employees.find((entry) => entry.id === open.id)
      : null;
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <h1 id="employees">{text.employeeDirectory}</h1>
          <p className="intro-copy">
            {data
              ? text.employeePageInfo.replace(
                  '{n}',
                  String(data.employees.length),
                )
              : text.employeeDirectoryNote}
          </p>
        </div>
        {mayAdministerEmployees(actor?.role ?? '') ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => setInvitationOpen(true)}
          >
            {text.employeeInviteOpen}
          </button>
        ) : null}
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
          columns={6}
        />
      ) : null}

      <div ref={surface} hidden={!data || busy}>
        {data ? (
          <section className="panel page-section" aria-labelledby="employees">
            <div className="panel-body">
              {data.employees.length === 0 ? (
                <div className="state-panel">
                  <h3>{text.employeeDirectoryEmpty}</h3>
                </div>
              ) : (
                <div className="table-wrap employee-table-wrap">
                  <table className="data-table stackable">
                    <thead>
                      <tr>
                        <th scope="col">{text.employeeName}</th>
                        <th scope="col">{text.email}</th>
                        <th scope="col">{text.employeeRole}</th>
                        <th scope="col">{text.employeeBio}</th>
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
                        const deactivationOpen =
                          open?.id === employee.id &&
                          open.panel === 'deactivate';
                        const deletionOpen =
                          open?.id === employee.id && open.panel === 'delete';
                        const resendOpen =
                          open?.id === employee.id && open.panel === 'resend';
                        // Which actions this row offers, and their copy: the conditions are
                        // named once in action-menu.ts and are the ones the row has offered
                        // since #160.
                        const actions = employeeActions({
                          access: employee.access,
                          invitation: employee.invitation,
                          deactivation: state,
                          deletion,
                          actorRole: actor?.role ?? '',
                        });
                        const actionLabels: Record<EmployeeActionId, string> = {
                          profile: text.employeeEdit,
                          resend: text.employeeInviteResendOpen,
                          deactivate: resumable
                            ? text.employeeDeactivateReconcile
                            : text.employeeDeactivate,
                          delete: resumingDeletion
                            ? text.employeeDeleteReconcile
                            : text.employeeDelete,
                        };
                        return (
                          <Fragment key={employee.id}>
                            <tr>
                              <th scope="row" data-label={text.employeeName}>
                                <b translate="no">
                                  {employee.displayName.trim() ||
                                    text.employeeUnnamed}
                                </b>
                                {!employee.displayName.trim() ? (
                                  <small translate="no">{employee.email}</small>
                                ) : null}
                              </th>
                              <td data-label={text.email}>{employee.email}</td>
                              <td data-label={text.employeeRole}>
                                {label(locale, employee.role)}
                              </td>
                              <td data-label={text.employeeBio}>
                                {employee.bio ? (
                                  <span translate="no">{employee.bio}</span>
                                ) : (
                                  <span className="field-hint">
                                    {text.employeeBioNone}
                                  </span>
                                )}
                              </td>
                              <td
                                className="status-cell"
                                data-label={text.employeeAccess}
                              >
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
                                  <small className="employee-invitation-history">
                                    {text.employeeInvitationHistory}:{' '}
                                    {invitationLabel[employee.invitation.state]}
                                  </small>
                                ) : null}
                              </td>
                              <td data-label={text.employeeActions}>
                                <EmployeeActionsMenu
                                  label={text.employeeActions}
                                  actions={actions}
                                  labels={actionLabels}
                                  onPick={(action) =>
                                    toggle(employee.id, action)
                                  }
                                />
                              </td>
                            </tr>
                            {deactivationOpen ? (
                              <tr>
                                <td colSpan={6}>
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
                                <td colSpan={6}>
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
                            {resendOpen ? (
                              <tr>
                                <td colSpan={6}>
                                  <EmployeeInvitationResendPanel
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
      {editing && !busy ? (
        <EmployeeProfilePanel
          key={editing.id}
          employee={editing}
          locale={locale}
          opener={open?.opener ?? null}
          onChanged={reload}
          onDenied={redirectDenied}
          onClose={() => setOpen(null)}
        />
      ) : null}
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
