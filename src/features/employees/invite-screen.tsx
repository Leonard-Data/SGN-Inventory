'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from './api';
import { AuthShell } from './auth-shell';
import {
  PasswordField,
  PasswordStrength,
  StatusAlert,
  Stepper,
  TextField,
  buttonClass,
} from './auth-ui';
import { evaluatePassword, passwordRules } from './password-policy';
import { EMPLOYEE_NAME_MAX_LENGTH } from './invitation-acceptance';

const RULES = passwordRules.length;

type NameError = '' | 'inviteNameRequired' | 'inviteNameTooLong';
type PasswordError = '' | 'passwordRulesUnmet';
type ConfirmError = '' | 'confirmRequired' | 'passwordMismatch';
type ErrorKey = keyof (typeof messages)['vi'];

const submitErrorKey: Record<string, ErrorKey> = {
  'invitation-invalid': 'inviteInvalid',
  'invitation-not-found': 'inviteNotFound',
  'invitation-not-accepted': 'inviteNotAccepted',
  'invitation-identity-mismatch': 'inviteMismatch',
  'invitation-changed': 'inviteChanged',
  'invitation-stale': 'inviteStale',
  'invalid-input': 'invalidInput',
  'access-denied': 'denied',
};

type Phase = 'verifying' | 'setup' | 'active' | 'done' | 'invalid';

// Issue #69: the delivered invitation destination is now a real acceptance journey. The link's
// fragment carries the invite session; it is read once, handed to the session endpoint and
// cleared from the URL so neither token persists in history or a referrer. The page stays
// shell-free until live active membership is established, and every refusal is localized with
// no employee authority.
export function InviteScreen({ initialLocale }: { initialLocale: Locale }) {
  const [locale, setLocale] = useState(initialLocale);
  const [phase, setPhase] = useState<Phase>('verifying');
  const [formError, setFormError] = useState<ErrorKey | ''>('');
  const [invitationId, setInvitationId] = useState('');
  const [revision, setRevision] = useState(0);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<NameError>('');
  const [passwordError, setPasswordError] = useState<PasswordError>('');
  const [confirmError, setConfirmError] = useState<ConfirmError>('');
  const nameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const errorSurface = useRef<HTMLParagraphElement>(null);
  const text = messages[locale];
  const evaluation = evaluatePassword(password);

  useEffect(() => {
    if (formError) errorSurface.current?.focus({ preventScroll: true });
  }, [formError]);

  useEffect(() => {
    let cancelled = false;
    async function open() {
      // The delivered invite session arrives in the fragment (implicit flow). Read it once,
      // then drop it from the URL so it never lingers in history or leaks through a referrer.
      let body: Record<string, unknown> = {};
      if (typeof window !== 'undefined' && window.location.hash) {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const accessToken = params.get('access_token');
        const refreshToken = params.get('refresh_token');
        if (accessToken && refreshToken) {
          body = { accessToken, refreshToken };
        }
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
      }
      try {
        const result = await api<{
          status: 'setup' | 'active';
          setup?: { invitationId: string; revision: number; email: string };
          employee?: { displayName: string };
        }>('/api/auth/invite/session', body);
        if (cancelled) return;
        if (result.status === 'active') {
          setPhase('active');
          return;
        }
        if (result.status === 'setup' && result.setup) {
          setInvitationId(result.setup.invitationId);
          setRevision(result.setup.revision);
          setEmail(result.setup.email);
          setPhase('setup');
          return;
        }
        setPhase('invalid');
      } catch (failure) {
        if (cancelled) return;
        setPhase('invalid');
        setFormError(
          submitErrorKey[
            failure instanceof RequestError ? failure.code : 'unavailable'
          ] ?? 'unavailable',
        );
      }
    }
    void open();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    const nextName: NameError = !trimmed
      ? 'inviteNameRequired'
      : [...trimmed].length > EMPLOYEE_NAME_MAX_LENGTH
        ? 'inviteNameTooLong'
        : '';
    const nextPassword: PasswordError =
      evaluation.metCount === RULES ? '' : 'passwordRulesUnmet';
    const nextConfirm: ConfirmError = !confirm
      ? 'confirmRequired'
      : confirm !== password
        ? 'passwordMismatch'
        : '';
    setNameError(nextName);
    setPasswordError(nextPassword);
    setConfirmError(nextConfirm);
    setFormError('');
    if (nextName) {
      nameRef.current?.focus({ preventScroll: true });
      return;
    }
    if (nextPassword) {
      passwordRef.current?.focus({ preventScroll: true });
      return;
    }
    if (nextConfirm) {
      confirmRef.current?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/invite/accept', {
        invitationId,
        revision,
        name: trimmed,
        password,
        confirmPassword: confirm,
        locale,
      });
      setPhase('done');
    } catch (failure) {
      setFormError(
        submitErrorKey[
          failure instanceof RequestError ? failure.code : 'unavailable'
        ] ?? 'unavailable',
      );
    } finally {
      setBusy(false);
    }
  }

  const current =
    phase === 'done' || phase === 'active' ? 3 : phase === 'setup' ? 2 : 1;

  return (
    <AuthShell locale={locale} onLocaleChange={setLocale}>
      <section className="auth-card" aria-labelledby="invite-title">
        <Stepper locale={locale} current={current as 1 | 2 | 3} />
        <p className="eyebrow">{text.recoveryEyebrow}</p>
        <h1 id="invite-title">
          {phase === 'done' || phase === 'active'
            ? text.inviteDoneTitle
            : text.inviteTitle}
        </h1>
        <p className="lead">
          {phase === 'done' || phase === 'active'
            ? text.inviteDoneLead
            : text.inviteLead}
        </p>

        {phase === 'verifying' ? (
          <div className="auth-form">
            <StatusAlert tone="status" live="polite">
              {text.inviteVerifying}
            </StatusAlert>
          </div>
        ) : phase === 'invalid' ? (
          <div className="auth-form">
            <StatusAlert tone="error" innerRef={errorSurface}>
              {formError ? text[formError] : text.inviteInvalid}
            </StatusAlert>
            <a
              className={buttonClass('primary', { block: true })}
              href={'/login?lang=' + locale}
            >
              <span className="btn-label">{text.login}</span>
            </a>
          </div>
        ) : phase === 'active' || phase === 'done' ? (
          <div className="auth-form">
            <span className="done-mark">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m5 12.5 4.5 4.5L19 7" />
              </svg>
            </span>
            <div className="actions">
              <Link
                className={buttonClass('primary', { block: true })}
                href="/properties"
              >
                <span className="btn-label">{text.inviteContinue}</span>
              </Link>
            </div>
          </div>
        ) : (
          <form
            className="auth-form"
            method="post"
            action="/api/auth/invite/accept"
            noValidate
            onSubmit={submit}
          >
            <div className="field">
              <label>{text.inviteEmailLabel}</label>
              <span className="input-wrap">
                <input
                  className="input"
                  type="email"
                  value={email}
                  readOnly
                  aria-readonly="true"
                />
              </span>
            </div>
            <TextField
              id="invite-name"
              name="name"
              label={text.employeeName}
              type="text"
              value={name}
              onChange={(value) => {
                setName(value);
                if (nameError) setNameError('');
              }}
              onBlur={() => {
                if (name && [...name.trim()].length > EMPLOYEE_NAME_MAX_LENGTH)
                  setNameError('inviteNameTooLong');
              }}
              inputRef={nameRef}
              error={nameError ? text[nameError] : ''}
              errorId="invite-name-error"
              invalid={Boolean(nameError)}
              autoComplete="name"
              maxLength={EMPLOYEE_NAME_MAX_LENGTH}
              placeholder={text.inviteNamePlaceholder}
            />
            <p className="form-note">{text.inviteNameHint}</p>
            <PasswordField
              id="new-password"
              name="new-password"
              label={text.newPassword}
              locale={locale}
              value={password}
              onChange={(value) => {
                setPassword(value);
                if (passwordError) setPasswordError('');
                if (confirmError && value === confirm) setConfirmError('');
              }}
              inputRef={passwordRef}
              error={passwordError ? text[passwordError] : ''}
              errorId="new-password-error"
              invalid={Boolean(passwordError)}
              autoComplete="new-password"
              maxLength={128}
              minLength={8}
              placeholder="••••••••••"
              describedBy="password-rules"
            >
              <PasswordStrength
                locale={locale}
                evaluation={evaluation}
                rulesId="password-rules"
              />
            </PasswordField>
            <PasswordField
              id="confirm-password"
              name="confirm-password"
              label={text.confirmPassword}
              locale={locale}
              value={confirm}
              onChange={(value) => {
                setConfirm(value);
                if (confirmError) setConfirmError('');
              }}
              inputRef={confirmRef}
              error={confirmError ? text[confirmError] : ''}
              errorId="confirm-password-error"
              invalid={Boolean(confirmError)}
              autoComplete="new-password"
              maxLength={128}
              placeholder="••••••••••"
            />
            <button
              type="submit"
              className={buttonClass('primary', { block: true, loading: busy })}
              aria-busy={busy}
              aria-disabled={busy}
            >
              <span className="btn-label">
                {busy ? text.inviteSubmitting : text.inviteSubmit}
              </span>
            </button>
            {formError ? (
              <StatusAlert tone="error" innerRef={errorSurface}>
                {text[formError]}
              </StatusAlert>
            ) : null}
          </form>
        )}
      </section>
    </AuthShell>
  );
}
