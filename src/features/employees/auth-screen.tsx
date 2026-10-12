'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from './api';
import { AuthShell } from './auth-shell';
import { PasswordField, StatusAlert, TextField, buttonClass } from './auth-ui';

// Contiguous, no-space address-shaped email guard (mirrors the API boundary).
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EmailError = '' | 'emailRequired' | 'emailInvalid';
type PasswordError = '' | 'passwordRequired';
type FormError =
  '' | 'invalidCredentials' | 'invalidInput' | 'unavailable' | 'signOutFailed';

const formErrorKey: Record<string, keyof (typeof messages)['vi']> = {
  'invalid-credentials': 'invalidCredentials',
  'invalid-input': 'invalidInput',
  'sign-out-failed': 'signOutFailed',
};

export function AuthScreen({
  initialLocale,
  denied = false,
}: {
  initialLocale: Locale;
  denied?: boolean;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<EmailError>('');
  const [passwordError, setPasswordError] = useState<PasswordError>('');
  const [formError, setFormError] = useState<FormError>('');
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const errorSurface = useRef<HTMLParagraphElement>(null);
  const text = messages[locale];

  useEffect(() => {
    if (formError) errorSurface.current?.focus({ preventScroll: true });
  }, [formError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    const nextEmailError: EmailError = !trimmed
      ? 'emailRequired'
      : EMAIL.test(trimmed)
        ? ''
        : 'emailInvalid';
    const nextPasswordError: PasswordError = password ? '' : 'passwordRequired';
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setFormError('');
    if (nextEmailError) {
      emailRef.current?.focus({ preventScroll: true });
      return;
    }
    if (nextPasswordError) {
      passwordRef.current?.focus({ preventScroll: true });
      return;
    }
    setBusy(true);
    try {
      await api('/api/auth/login', {
        email: trimmed,
        password,
        locale,
        remember,
      });
      window.location.replace('/properties');
      return;
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        failure.status === 403 &&
        failure.code === 'access-denied'
      ) {
        window.location.replace('/access-denied');
        return;
      }
      const code =
        failure instanceof RequestError ? failure.code : 'unavailable';
      setFormError((formErrorKey[code] ?? 'unavailable') as FormError);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy(true);
    setFormError('');
    try {
      await api('/api/auth/logout', {});
      window.location.replace('/login?lang=' + locale);
      return;
    } catch {
      setFormError('signOutFailed');
      setBusy(false);
    }
  }

  return (
    <AuthShell locale={locale} onLocaleChange={setLocale}>
      {denied ? (
        <section className="auth-card" aria-labelledby="auth-title">
          <p className="eyebrow">{text.brandMeta}</p>
          <h1 id="auth-title">{text.denied}</h1>
          <p className="lead">{text.deniedHelp}</p>
          <div className="auth-form">
            <button
              type="button"
              className={buttonClass('primary', { block: true, loading: busy })}
              aria-busy={busy}
              aria-disabled={busy}
              onClick={logout}
            >
              <span className="btn-label">{text.logout}</span>
            </button>
            {formError ? (
              <StatusAlert tone="error" innerRef={errorSurface}>
                {text[formError]}
              </StatusAlert>
            ) : null}
          </div>
        </section>
      ) : (
        <section className="auth-card" aria-labelledby="auth-title">
          <p className="eyebrow">{text.brandMeta}</p>
          <h1 id="auth-title">{text.login}</h1>
          <p className="lead">{text.signInHelp}</p>
          <form
            className="auth-form"
            method="post"
            action="/api/auth/login"
            noValidate
            onSubmit={submit}
          >
            <TextField
              id="email"
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
              errorId="email-error"
              invalid={Boolean(emailError)}
              autoComplete="username"
              maxLength={254}
              placeholder={text.emailPlaceholder}
            />
            <PasswordField
              id="password"
              name="password"
              label={text.password}
              locale={locale}
              value={password}
              onChange={(value) => {
                setPassword(value);
                if (passwordError) setPasswordError('');
              }}
              inputRef={passwordRef}
              error={passwordError ? text[passwordError] : ''}
              errorId="password-error"
              invalid={Boolean(passwordError)}
              autoComplete="current-password"
              maxLength={1024}
              placeholder="••••••••"
            />
            <div className="row-between">
              <label className="check" htmlFor="remember">
                <input
                  type="checkbox"
                  id="remember"
                  name="remember"
                  checked={remember}
                  disabled={busy}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                <span>{text.remember}</span>
              </label>
              <a className="link" href={'/recover?lang=' + locale}>
                {text.recovery}
              </a>
            </div>
            <button
              type="submit"
              className={buttonClass('primary', { block: true, loading: busy })}
              aria-busy={busy}
              aria-disabled={busy}
            >
              <span className="btn-label">
                {busy ? text.signingIn : text.login}
              </span>
            </button>
            {formError ? (
              <StatusAlert tone="error" innerRef={errorSurface}>
                {text[formError]}
              </StatusAlert>
            ) : null}
          </form>
          <p className="form-note">{text.accountNote}</p>
        </section>
      )}
    </AuthShell>
  );
}
