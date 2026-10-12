'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
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

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RULES = passwordRules.length;

type ErrorKey = keyof (typeof messages)['vi'];

const submitErrorKey: Record<string, ErrorKey> = {
  'invalid-password': 'passwordRulesUnmet',
  'invalid-recovery': 'recoveryInvalid',
  'invalid-input': 'invalidInput',
};

export function RecoveryScreen({
  initialLocale,
  mode,
  invalid,
}: {
  initialLocale: Locale;
  mode: 'request' | 'reset';
  invalid: boolean;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [sent, setSent] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<
    '' | 'emailRequired' | 'emailInvalid'
  >('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<'' | 'passwordRulesUnmet'>(
    '',
  );
  const [confirmError, setConfirmError] = useState<
    '' | 'confirmRequired' | 'passwordMismatch'
  >('');
  const [formError, setFormError] = useState<ErrorKey | ''>('');
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const errorSurface = useRef<HTMLParagraphElement>(null);
  const text = messages[locale];
  const evaluation = evaluatePassword(password);

  useEffect(() => {
    if (formError) errorSurface.current?.focus({ preventScroll: true });
  }, [formError]);

  const current =
    invalid && mode === 'reset' ? 1 : done ? 3 : mode === 'reset' ? 2 : 1;

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    const nextError = !trimmed
      ? 'emailRequired'
      : EMAIL.test(trimmed)
        ? ''
        : 'emailInvalid';
    setEmailError(nextError);
    setFormError('');
    if (nextError) {
      emailRef.current?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/recover', { email: trimmed, locale });
      setSent(true);
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

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextPassword: '' | 'passwordRulesUnmet' =
      evaluation.metCount === RULES ? '' : 'passwordRulesUnmet';
    const nextConfirm: '' | 'confirmRequired' | 'passwordMismatch' = !confirm
      ? 'confirmRequired'
      : confirm !== password
        ? 'passwordMismatch'
        : '';
    setPasswordError(nextPassword);
    setConfirmError(nextConfirm);
    setFormError('');
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
      await api('/api/auth/password', {
        password,
        confirmPassword: confirm,
      });
      const channel = new BroadcastChannel('sgn-session');
      channel.postMessage('signed-out');
      channel.close();
      setDone(true);
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

  return (
    <AuthShell locale={locale} onLocaleChange={setLocale}>
      <section className="sgn-card" aria-labelledby="recovery-title">
        <Stepper locale={locale} current={current as 1 | 2 | 3} />
        <p className="sgn-eyebrow">{text.recoveryEyebrow}</p>
        <h1 id="recovery-title">
          {done
            ? text.passwordDoneTitle
            : mode === 'request'
              ? text.recoveryTitle
              : text.resetTitle}
        </h1>
        <p className="sgn-lead">
          {done
            ? text.passwordUpdated
            : mode === 'request'
              ? text.recoveryInstructions
              : text.resetInstructions}
        </p>

        {mode === 'request' ? (
          sent ? (
            <div className="sgn-form">
              <StatusAlert tone="success">{text.recoverySent}</StatusAlert>
              <button
                type="button"
                className={buttonClass('secondary', { block: true })}
                onClick={() => setSent(false)}
              >
                <span className="sgn-btn-label">{text.stepBack}</span>
              </button>
              <a
                className={buttonClass('primary', { block: true })}
                href={'/login?lang=' + locale}
              >
                <span className="sgn-btn-label">{text.login}</span>
              </a>
            </div>
          ) : (
            <form
              className="sgn-form"
              method="post"
              action="/api/auth/recover"
              noValidate
              onSubmit={requestLink}
            >
              <TextField
                id="recovery-email"
                name="email"
                label={text.email}
                value={email}
                onChange={(value) => {
                  setEmail(value);
                  if (emailError) setEmailError('');
                }}
                onBlur={() => {
                  if (email && !EMAIL.test(email.trim()))
                    setEmailError('emailInvalid');
                }}
                inputRef={emailRef}
                error={emailError ? text[emailError] : ''}
                errorId="recovery-email-error"
                invalid={Boolean(emailError)}
                autoComplete="email"
                maxLength={254}
                placeholder={text.emailPlaceholder}
              />
              <button
                type="submit"
                className={buttonClass('primary', {
                  block: true,
                  loading: busy,
                })}
                aria-busy={busy}
                aria-disabled={busy}
              >
                <span className="sgn-btn-label">
                  {busy ? text.recoverySending : text.sendRecovery}
                </span>
              </button>
              <a
                className={buttonClass('secondary', { block: true })}
                href={'/login?lang=' + locale}
              >
                <span className="sgn-btn-label">{text.login}</span>
              </a>
              {formError ? (
                <StatusAlert tone="error" innerRef={errorSurface}>
                  {text[formError]}
                </StatusAlert>
              ) : null}
            </form>
          )
        ) : invalid ? (
          <div className="sgn-form">
            <StatusAlert tone="error" innerRef={errorSurface}>
              {text.recoveryInvalid}
            </StatusAlert>
            <a
              className={buttonClass('primary', { block: true })}
              href={'/recover?lang=' + locale}
            >
              <span className="sgn-btn-label">{text.sendRecovery}</span>
            </a>
            <a
              className={buttonClass('secondary', { block: true })}
              href={'/login?lang=' + locale}
            >
              <span className="sgn-btn-label">{text.login}</span>
            </a>
          </div>
        ) : done ? (
          <div className="sgn-form">
            <span className="sgn-done-mark">
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
            <div className="sgn-actions">
              <a
                className={buttonClass('primary', { block: true })}
                href={'/login?lang=' + locale}
              >
                <span className="sgn-btn-label">{text.login}</span>
              </a>
            </div>
          </div>
        ) : (
          <form
            className="sgn-form"
            method="post"
            action="/api/auth/password"
            noValidate
            onSubmit={updatePassword}
          >
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
              minLength={10}
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
              <span className="sgn-btn-label">
                {busy ? text.resetUpdating : text.updatePassword}
              </span>
            </button>
            <a
              className={buttonClass('secondary', { block: true })}
              href={'/recover?lang=' + locale}
            >
              <span className="sgn-btn-label">{text.stepBack}</span>
            </a>
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
