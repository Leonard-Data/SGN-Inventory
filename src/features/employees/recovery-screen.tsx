'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from './api';
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
  const [error, setError] = useState(invalid ? 'invalid-recovery' : '');
  const text = messages[locale];
  const errorSurface = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorSurface.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setError('');
    try {
      if (mode === 'request')
        await api('/api/auth/recover', { email: values.get('email'), locale });
      else {
        const password = values.get('password');
        if (
          typeof password !== 'string' ||
          [...password].length < 8 ||
          [...password].length > 128 ||
          password !== values.get('confirmPassword')
        )
          throw new RequestError(400, 'invalid-password');
        await api('/api/auth/password', {
          password,
          confirmPassword: values.get('confirmPassword'),
        });
        const channel = new BroadcastChannel('sgn-session');
        channel.postMessage('signed-out');
        channel.close();
      }
      setDone(true);
      form.reset();
    } catch (failure) {
      setError(failure instanceof RequestError ? failure.code : 'unavailable');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell" lang={locale}>
      <a className="skip-link" href="#main-content">
        {text.skipToContent}
      </a>
      <p className="brand" translate="no">
        {text.title}
      </p>
      <nav aria-label={text.language}>
        <button
          type="button"
          aria-pressed={locale === 'vi'}
          onClick={() => setLocale('vi')}
        >
          {text.viLanguage}
        </button>
        <button
          type="button"
          aria-pressed={locale === 'en'}
          onClick={() => setLocale('en')}
        >
          {text.enLanguage}
        </button>
      </nav>
      <h1 id="main-content" tabIndex={-1}>
        {mode === 'request' ? text.recoveryTitle : text.resetTitle}
      </h1>
      <p>{text.recoveryInstructions}</p>
      {done ? (
        <p role="status">
          {mode === 'request' ? text.recoverySent : text.passwordUpdated}
        </p>
      ) : (
        <form
          method="post"
          action={
            mode === 'request' ? '/api/auth/recover' : '/api/auth/password'
          }
          onSubmit={submit}
          noValidate
        >
          {mode === 'request' ? (
            <>
              <label htmlFor="email">{text.email}</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                maxLength={254}
                required
              />
            </>
          ) : (
            <>
              <label htmlFor="password">{text.newPassword}</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
              />
              <label htmlFor="confirmPassword">{text.confirmPassword}</label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
              />
              <p>{text.passwordRule}</p>
            </>
          )}
          <button disabled={busy}>
            {busy
              ? text.loading
              : mode === 'request'
                ? text.sendRecovery
                : text.updatePassword}
          </button>
        </form>
      )}
      {error ? (
        <p role="alert" ref={errorSurface} tabIndex={-1}>
          {error === 'invalid-recovery'
            ? text.recoveryInvalid
            : error === 'invalid-password'
              ? text.passwordRule
              : error === 'invalid-input'
                ? text.invalidInput
                : text.unavailable}
        </p>
      ) : null}
      <p>
        <a href={'/login?lang=' + locale}>{text.login}</a>
      </p>
    </main>
  );
}
