'use client';
import { useState, useRef, type FormEvent } from 'react';
import { messages, label, type Locale } from '@/i18n/messages';
import { api, RequestError } from './api';
import { EditDrawer } from '@/features/edit-drawer';
import { useToast } from '@/features/toasts/toast-host';
import { EMPLOYEE_ROLES } from './invitation';
import type { DirectoryEntry } from './directory';
import {
  EMPLOYEE_BIO_MAX_LENGTH,
  EMPLOYEE_NAME_MAX_LENGTH,
  EMPLOYEE_PHONE_MAX_LENGTH,
  parseProfileUpdate,
  profileEditable,
  profileProblems,
  type EmployeeRole,
  type ProfileField,
  type ProfileProblem,
} from './profile';

// The admin edit a live admin opens from one employee row: display name, phone, role and bio,
// saved as one deliberate action. The email that identifies the account is shown but is not a
// field, and a deactivated or deleted employee offers the reason instead of a form.
export function EmployeeProfilePanel({
  employee,
  locale,
  onChanged,
  onDenied,
  onClose,
  opener,
}: {
  employee: DirectoryEntry;
  locale: Locale;
  onChanged: () => void;
  onDenied: (status: number) => void;
  onClose: () => void;
  opener: HTMLElement | null;
}) {
  const text = messages[locale];
  const editable = profileEditable(employee.access);
  const notify = useToast();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const [displayName, setDisplayName] = useState(employee.displayName);
  const [phone, setPhone] = useState(employee.phone ?? '');
  const [role, setRole] = useState<EmployeeRole>(
    (EMPLOYEE_ROLES as readonly string[]).includes(employee.role)
      ? (employee.role as EmployeeRole)
      : 'sales',
  );
  const [bio, setBio] = useState(employee.bio ?? '');
  const [problems, setProblems] = useState<ProfileProblem[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty =
    displayName !== employee.displayName ||
    phone !== (employee.phone ?? '') ||
    role !== employee.role ||
    bio !== (employee.bio ?? '');

  const problemMessage = (item: ProfileProblem) =>
    item.code === 'required'
      ? text.employeeProfileNameRequired
      : item.code === 'plain-text'
        ? text.employeeProfilePlainText
        : item.field === 'displayName'
          ? text.employeeProfileNameTooLong
          : item.field === 'phone'
            ? text.employeeProfilePhoneTooLong
            : text.employeeProfileBioTooLong;
  const fieldProblem = (field: ProfileProblem['field']) =>
    problems.find((item) => item.field === field);
  const problemText: Record<string, string> = {
    'last-admin': text.employeeEditLastAdmin,
    'not-editable': text.employeeEditNotEditable,
    'invalid-input': text.invalidInput,
    'not-found': text.employeeEditNotFound,
    'access-denied': text.denied,
    unavailable: text.unavailable,
  };
  const fieldLabel: Record<ProfileField, string> = {
    displayName: text.employeeName,
    phone: text.employeePhone,
    role: text.employeeRole,
    bio: text.employeeBio,
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const found = profileProblems({ displayName, phone, bio }, [
      'displayName',
      'phone',
      'bio',
    ]);
    setProblems(found);
    setProblem(null);
    setNotice(null);
    if (found.length) {
      (
        event.currentTarget.elements.namedItem(
          found[0]!.field,
        ) as HTMLElement | null
      )?.focus();
      return;
    }
    setBusy(true);
    try {
      const update = parseProfileUpdate(
        await api<unknown>('/api/employees/' + employee.id + '/profile', {
          displayName,
          phone,
          role,
          bio,
        }),
      );
      if (!update) {
        setProblem(text.unavailable);
        return;
      }
      // Save reports what actually changed on the recorded row, not what was submitted.
      const message = update.changed.length
        ? text.employeeEditSaved.replace(
            '{fields}',
            update.changed.map((field) => fieldLabel[field]).join(', '),
          )
        : text.employeeProfileUnchanged;
      setNotice(message);
      notify({ saved: true, message });
      onClose();
      onChanged();
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      requestAnimationFrame(() => errorRef.current?.focus());
      setProblem(
        failure instanceof RequestError
          ? (problemText[failure.code] ?? text.unavailable)
          : text.unavailable,
      );
    } finally {
      setBusy(false);
    }
  }

  if (!editable)
    return (
      <EditDrawer
        title={text.employeeEdit}
        locale={locale}
        dirty={false}
        busy={false}
        opener={opener}
        onClose={onClose}
      >
        {(requestClose) => (
          <div className="editor-scroll">
            <p className="panel-note">{text.employeeEditNotEditable}</p>
            <div className="panel-foot">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={requestClose}
              >
                {text.close}
              </button>
            </div>
          </div>
        )}
      </EditDrawer>
    );

  return (
    <EditDrawer
      title={
        text.employeeEdit +
        ' · ' +
        (employee.displayName || text.employeeUnnamed)
      }
      locale={locale}
      dirty={dirty}
      busy={busy}
      opener={opener}
      onClose={onClose}
    >
      {(requestClose) => (
        <form className="editor-form" onSubmit={save} noValidate>
          <div className="editor-scroll">
            <p className="field-hint">{text.employeeEditNote}</p>
            <fieldset disabled={busy} className="stack-4">
              <dl className="summary-list">
                <div className="summary-row">
                  <dt>{text.email}</dt>
                  <dd translate="no">{employee.email}</dd>
                </div>
              </dl>
              <p className="field-hint">{text.employeeEditEmailNote}</p>
              <div className="field">
                <label className="field-label" htmlFor="employee-edit-name">
                  {text.employeeName} <span className="field-req">*</span>
                </label>
                <input
                  id="employee-edit-name"
                  className="input"
                  name="displayName"
                  type="text"
                  maxLength={EMPLOYEE_NAME_MAX_LENGTH}
                  value={displayName}
                  aria-invalid={
                    fieldProblem('displayName') ? 'true' : undefined
                  }
                  aria-describedby={
                    fieldProblem('displayName')
                      ? 'employee-edit-name-error'
                      : 'employee-edit-name-hint'
                  }
                  onChange={(event) => setDisplayName(event.target.value)}
                />
                {fieldProblem('displayName') ? (
                  <p
                    className="field-error"
                    id="employee-edit-name-error"
                    role="alert"
                  >
                    {problemMessage(fieldProblem('displayName')!)}
                  </p>
                ) : (
                  <p className="field-hint" id="employee-edit-name-hint">
                    {text.employeeProfileNameHint}
                  </p>
                )}
              </div>
              <div className="field">
                <label className="field-label" htmlFor="employee-edit-phone">
                  {text.employeePhone}
                </label>
                <input
                  id="employee-edit-phone"
                  className="input"
                  name="phone"
                  type="tel"
                  maxLength={EMPLOYEE_PHONE_MAX_LENGTH}
                  value={phone}
                  aria-invalid={fieldProblem('phone') ? 'true' : undefined}
                  aria-describedby={
                    fieldProblem('phone')
                      ? 'employee-edit-phone-error'
                      : 'employee-edit-phone-hint'
                  }
                  onChange={(event) => setPhone(event.target.value)}
                />
                {fieldProblem('phone') ? (
                  <p
                    className="field-error"
                    id="employee-edit-phone-error"
                    role="alert"
                  >
                    {problemMessage(fieldProblem('phone')!)}
                  </p>
                ) : (
                  <p className="field-hint" id="employee-edit-phone-hint">
                    {text.employeeEditPhoneHint}
                  </p>
                )}
              </div>
              <div className="field">
                <label className="field-label" htmlFor="employee-edit-role">
                  {text.employeeRole} <span className="field-req">*</span>
                </label>
                <select
                  id="employee-edit-role"
                  className="input"
                  name="role"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as EmployeeRole)
                  }
                >
                  {EMPLOYEE_ROLES.map((value) => (
                    <option key={value} value={value}>
                      {label(locale, value)}
                    </option>
                  ))}
                </select>
                <p className="field-hint">{text.employeeEditRoleHint}</p>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="employee-edit-bio">
                  {text.employeeBio}
                </label>
                <textarea
                  id="employee-edit-bio"
                  className="textarea"
                  name="bio"
                  rows={3}
                  maxLength={EMPLOYEE_BIO_MAX_LENGTH}
                  value={bio}
                  aria-invalid={fieldProblem('bio') ? 'true' : undefined}
                  aria-describedby={
                    fieldProblem('bio')
                      ? 'employee-edit-bio-error'
                      : 'employee-edit-bio-hint'
                  }
                  onChange={(event) => setBio(event.target.value)}
                />
                {fieldProblem('bio') ? (
                  <p
                    className="field-error"
                    id="employee-edit-bio-error"
                    role="alert"
                  >
                    {problemMessage(fieldProblem('bio')!)}
                  </p>
                ) : (
                  <p className="field-hint" id="employee-edit-bio-hint">
                    {text.employeeEditBioHint}
                  </p>
                )}
              </div>
            </fieldset>
            {problem ? (
              <p
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="field-error"
              >
                {problem}
              </p>
            ) : null}
            {notice ? (
              <p className="panel-note" role="status">
                {notice}
              </p>
            ) : null}
          </div>
          <div className="sgn-dialog-foot">
            <button
              className="btn btn-sm btn-primary"
              type="submit"
              disabled={busy}
            >
              {busy ? text.saving : text.employeeProfileSave}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={requestClose}
            >
              {text.cancel}
            </button>
          </div>
        </form>
      )}
    </EditDrawer>
  );
}
