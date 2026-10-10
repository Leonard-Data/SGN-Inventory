'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from './api';
export function AuthScreen({
  initialLocale,
  denied = false,
}: {
  initialLocale: Locale;
  denied?: boolean;
}) {
  const [locale, setLocale] = useState(initialLocale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const text = messages[locale];
  const errorSurface = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorSurface.current?.focus();
  }, [error]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await api('/api/auth/login', {
        email: values.get('email'),
        password: values.get('password'),
        locale,
      });
      window.location.replace('/properties');
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        failure.status === 403 &&
        failure.code === 'access-denied'
      )
        window.location.replace('/access-denied');
      else
        setError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await api('/api/auth/logout', {});
      window.location.replace('/login?lang=' + locale);
    } catch {
      setError('sign-out-failed');
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
          onClick={() => setLocale('vi')}
          aria-pressed={locale === 'vi'}
        >
          {text.viLanguage}
        </button>
        <button
          type="button"
          onClick={() => setLocale('en')}
          aria-pressed={locale === 'en'}
        >
          {text.enLanguage}
        </button>
      </nav>
      <h1 id="main-content" tabIndex={-1}>
        {denied ? text.denied : text.login}
      </h1>
      <p>{denied ? text.deniedHelp : text.signInHelp}</p>
      {denied ? (
        <button onClick={logout} disabled={busy}>
          {text.logout}
        </button>
      ) : (
        <>
          <form
            method="post"
            action="/api/auth/login"
            onSubmit={submit}
            noValidate
          >
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
            <label htmlFor="password">{text.password}</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={1024}
              required
            />
            <button disabled={busy}>{busy ? text.loading : text.login}</button>
          </form>
          <p>
            <a href={'/recover?lang=' + locale}>{text.recovery}</a>
          </p>
        </>
      )}
      {error ? (
        <p role="alert" ref={errorSurface} tabIndex={-1}>
          {error === 'invalid-credentials'
            ? text.invalidCredentials
            : error === 'invalid-input'
              ? text.invalidInput
              : error === 'sign-out-failed'
                ? text.signOutFailed
                : text.unavailable}
        </p>
      ) : null}
    </main>
  );
}
