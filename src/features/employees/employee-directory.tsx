'use client';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { renderedSession } from '@/features/employees/protected-load';
import type { EmployeeSession } from '@/features/employees/types';
import { LoadingSkeleton } from '@/features/skeleton';
import {
  StreamGap,
  StreamTableChunk,
} from '@/features/stream/stream-table-chunk';
import { useCursorWindow } from '@/features/stream/use-cursor-read';
import { useStreamLayout } from '@/features/stream/use-stream-layout';
import { useWindowStream } from '@/features/stream/use-windows';
import {
  STREAM_CHUNK_ROWS,
  streamChunkRows,
  streamKnownRows,
  streamWindows,
} from '@/features/stream/window';
import { EmployeeDeactivationPanel } from './employee-deactivation';
import { EmployeeAccountDeletionPanel } from './employee-account-deletion';
import { EmployeeInvitationForm } from './employee-invitation';
import { EmployeeInvitationResendPanel } from './employee-invitation-resend';
import { EmployeeProfilePanel } from './employee-profile-panel';
import { mayAdministerEmployees } from './deactivation';
import {
  DIRECTORY_PAGE_SIZE,
  type DirectoryDeactivation,
  type DirectoryEntry,
  type DirectoryInvitation,
  type EmployeeAccess,
} from './directory';
import { DIRECTORY_ENDPOINT, directoryWindow } from './directory-window';
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

// The columns of the directory table, and therefore the span of a reserved chunk's row.
const COLUMNS = 6;

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
// from. It reads recorded identities through /api/employees as one stream of windows: the
// rows near the viewport are in the page, and scrolling near their end reads the next
// window instead of stopping at a page boundary. The shell provides the rail, topbar and
// skip link. Loading, empty, error and denial stay distinct states. Issue #66 adds the
// guarded deactivation control and the truthful recorded operation state.
export function EmployeeDirectory({
  initialLocale,
}: {
  initialLocale: Locale;
}) {
  // The session is this surface's own protection: the stream below reads nothing until the
  // session has answered, and the employee read stays admin-only on the server either way.
  const {
    employee: actor,
    error: sessionError,
    busy,
    surface,
    logout,
    clear,
    reload,
  } = useProtectedData<EmployeeSession>('/api/session');
  const denied = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  const source = actor ? DIRECTORY_ENDPOINT : null;
  const readWindow = useCursorWindow<DirectoryEntry>({
    source,
    pageSize: DIRECTORY_PAGE_SIZE,
    page: directoryWindow,
  });
  const stream = useWindowStream<DirectoryEntry>({
    source,
    identity: actor ? renderedSession(actor) : 'no-session',
    readWindow,
    onDenied: denied,
  });
  const { request, retry, refresh } = stream;
  // The rows the stream accounts for: what its reads have reached, plus the one row standing for
  // the window it is about to fetch, so that window's chunk is reserved before it arrives.
  const rows = streamKnownRows(stream.loaded, stream.more === true);
  const ready = stream.more !== null;
  const [container, layout] = useStreamLayout({
    active: ready && !busy,
    rows,
    chunkRows: STREAM_CHUNK_ROWS,
    resultSet: DIRECTORY_ENDPOINT,
  });
  const needed = useMemo(
    () =>
      streamWindows({
        first: layout.band.first,
        last: layout.band.last,
        total: rows,
        chunkRows: STREAM_CHUNK_ROWS,
        pageSize: DIRECTORY_PAGE_SIZE,
      }),
    [layout.band.first, layout.band.last, rows],
  );
  // The band asks the stream for the windows it would show. Near the end of the loaded rows the
  // band holds the chunk the next window fills, so the next window is read without a button
  // press. Which row position the band is centred on decides which read windows survive.
  useEffect(() => {
    if (!ready) return;
    request(needed, layout.band.top);
  }, [request, needed, layout.band.top, ready]);

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
  // The record the profile drawer edits: the rows the stream has loaded, since only a drawn row
  // can open the drawer.
  const editing =
    open?.panel === 'profile'
      ? ([...stream.windows.values()]
          .flat()
          .find((entry) => entry.id === open.id) ?? null)
      : null;

  // One employee and, when it is open, the panel below it. The panel is part of the chunk that
  // holds the row, so the chunk measures its rows' real height: the stream keeps its scroll
  // position when a panel opens or closes.
  function employeeRows(employee: DirectoryEntry) {
    const state = employee.deactivation;
    const resumable =
      state?.state === 'provider_pending' || state?.state === 'provider_failed';
    const deletion = employee.deletion;
    const resumingDeletion = deletionResumable(deletion);
    const deletionState = deletionStatus(
      deletion && {
        state: deletion.state,
        providerOutcome: deletion.outcome,
      },
    );
    const deactivationOpen =
      open?.id === employee.id && open.panel === 'deactivate';
    const deletionOpen = open?.id === employee.id && open.panel === 'delete';
    const resendOpen = open?.id === employee.id && open.panel === 'resend';
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
              {employee.displayName.trim() || text.employeeUnnamed}
            </b>
            {!employee.displayName.trim() ? (
              <small translate="no">{employee.email}</small>
            ) : null}
          </th>
          <td data-label={text.email}>{employee.email}</td>
          <td data-label={text.employeeRole}>{label(locale, employee.role)}</td>
          <td data-label={text.employeeBio}>
            {employee.bio ? (
              <span translate="no">{employee.bio}</span>
            ) : (
              <span className="field-hint">{text.employeeBioNone}</span>
            )}
          </td>
          <td className="status-cell" data-label={text.employeeAccess}>
            <span className="badge" data-tone={accessTone[employee.access]}>
              {accessLabel[employee.access]}
            </span>
            {state ? (
              <span className="badge" data-tone={deactivationTone[state.state]}>
                {deactivationLabel[state.state]}
              </span>
            ) : null}
            {deletion && deletionState !== 'none' ? (
              <span className="badge" data-tone={deletionTone[deletion.state]}>
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
              onPick={(action) => toggle(employee.id, action)}
            />
          </td>
        </tr>
        {deactivationOpen ? (
          <tr>
            <td colSpan={COLUMNS}>
              <EmployeeDeactivationPanel
                employee={employee}
                actorRole={actor?.role ?? ''}
                locale={locale}
                onChanged={refresh}
                onDenied={denied}
                onClose={() => setOpen(null)}
              />
            </td>
          </tr>
        ) : null}
        {deletionOpen ? (
          <tr>
            <td colSpan={COLUMNS}>
              <EmployeeAccountDeletionPanel
                employee={employee}
                actorRole={actor?.role ?? ''}
                locale={locale}
                onChanged={refresh}
                onDenied={denied}
                onClose={() => setOpen(null)}
              />
            </td>
          </tr>
        ) : null}
        {resendOpen ? (
          <tr>
            <td colSpan={COLUMNS}>
              <EmployeeInvitationResendPanel
                employee={employee}
                actorRole={actor?.role ?? ''}
                locale={locale}
                onChanged={refresh}
                onDenied={denied}
                onClose={() => setOpen(null)}
              />
            </td>
          </tr>
        ) : null}
      </Fragment>
    );
  }

  const failure = sessionError ?? stream.error;
  const failureMessage = (code: string) =>
    code === 'invalid-input'
      ? text.invalidInput
      : code === 'sign-out-failed'
        ? text.signOutFailed
        : code === 'access-changed'
          ? text.accessChanged
          : text.employeeDirectoryFailed;
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.people}</p>
          <h1>{text.employeeDirectory}</h1>
          <p className="intro-copy">{text.employeeDirectoryNote}</p>
        </div>
      </div>

      {failure ? (
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
          <span>{failureMessage(failure)}</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={
              sessionError
                ? sessionError === 'sign-out-failed'
                  ? logout
                  : reload
                : retry
            }
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
          columns={COLUMNS}
        />
      ) : null}

      <div className="page-head">
        <div className="page-intro">
          <h1 id="employees">{text.employeeDirectory}</h1>
          <p className="intro-copy">{text.employeeDirectoryNote}</p>
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

      <div ref={surface} hidden={!actor || busy}>
        <section className="panel page-section" aria-labelledby="employees">
          <div className="panel-body">
            {!ready && !failure ? (
              <LoadingSkeleton
                label={text.loading}
                shape="table"
                rows={6}
                columns={COLUMNS}
              />
            ) : null}
            {ready && stream.loaded === 0 && !failure ? (
              <div className="state-panel">
                <h3>{text.employeeDirectoryEmpty}</h3>
              </div>
            ) : null}
            {ready && stream.loaded > 0 ? (
              <div className="table-wrap employee-table-wrap" ref={container}>
                <table className="data-table stackable">
                  <thead>
                    <tr>
                      <th scope="col">{text.employeeName}</th>
                      <th scope="col">{text.email}</th>
                      <th scope="col">{text.employeeRole}</th>
                      <th scope="col">{text.employeeBio}</th>
                      <th scope="col">{text.employeeAccess}</th>
                      <th className="cell-actions" scope="col">
                        {text.employeeActions}
                      </th>
                    </tr>
                  </thead>
                  <StreamGap height={layout.band.top} columns={COLUMNS} />
                  {layout.mounted.map((index) => {
                    const chunk = streamChunkRows(
                      stream.windows,
                      index * STREAM_CHUNK_ROWS,
                      STREAM_CHUNK_ROWS,
                      DIRECTORY_PAGE_SIZE,
                      rows,
                    );
                    return (
                      <StreamTableChunk
                        key={`${STREAM_CHUNK_ROWS}:${index}`}
                        geometry={layout}
                        index={index}
                        rows={chunk}
                        count={Math.min(
                          STREAM_CHUNK_ROWS,
                          Math.max(0, rows - index * STREAM_CHUNK_ROWS),
                        )}
                        columns={COLUMNS}
                        locale={locale}
                      >
                        {chunk?.map(employeeRows)}
                      </StreamTableChunk>
                    );
                  })}
                  <StreamGap height={layout.band.bottom} columns={COLUMNS} />
                </table>
              </div>
            ) : null}
          </div>
          {ready && stream.loaded > 0 ? (
            <div className="panel-foot">
              <div className="row-between">
                <p className="result-line">
                  <b>
                    {text.employeeLoadedInfo.replace(
                      '{n}',
                      String(stream.loaded),
                    )}
                  </b>
                </p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
      {editing && !busy ? (
        <EmployeeProfilePanel
          key={editing.id}
          employee={editing}
          locale={locale}
          opener={open?.opener ?? null}
          onChanged={async () => {
            const opener = open?.opener;
            refresh();
            requestAnimationFrame(() => {
              if (opener?.isConnected) opener.focus();
            });
          }}
          onDenied={denied}
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
                onChanged={refresh}
                onDenied={denied}
                onRecorded={() => setInvitationOpen(false)}
              />
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
