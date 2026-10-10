'use client';
import { useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import type { Employee } from './types';
import { api, RequestError } from './api';
export function SessionHeader({
  employee,
  locale,
  busy,
  logout,
  applyLocale,
  clear,
}: {
  employee: Employee | null;
  locale: Locale;
  busy: boolean;
  logout: () => Promise<void>;
  applyLocale: (locale: Locale, employeeId: string) => void;
  clear: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = messages[locale];
  async function change(next: Locale) {
    if (!employee || saving || next === locale) return;
    setSaving(true);
    setFailed(false);
    try {
      await api('/api/locale', { locale: next });
      applyLocale(next, employee.id);
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        clear();
        window.location.replace(
          failure.status === 403 ? '/access-denied' : '/login',
        );
      } else setFailed(true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <header>
        <p className="brand" translate="no">
          {text.title}
        </p>
        <nav aria-label={text.language}>
          <button
            type="button"
            disabled={busy || saving || !employee}
            aria-pressed={locale === 'vi'}
            onClick={() => change('vi')}
          >
            {text.viLanguage}
          </button>
          <button
            type="button"
            disabled={busy || saving || !employee}
            aria-pressed={locale === 'en'}
            onClick={() => change('en')}
          >
            {text.enLanguage}
          </button>
          <button type="button" onClick={logout}>
            {text.logout}
          </button>
        </nav>
      </header>
      {saving ? <p role="status">{text.loading}</p> : null}
      {failed ? <p role="alert">{text.savedLocaleFailed}</p> : null}
    </>
  );
}
