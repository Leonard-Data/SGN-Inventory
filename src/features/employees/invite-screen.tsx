'use client';
import { useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { AuthShell } from './auth-shell';
import { buttonClass } from './auth-ui';

// Issue #68: the fixed destination an invitation email points at. It is shell-free until live
// active membership exists and it deliberately consumes nothing: the acceptance and setup
// journey belongs to the separate invitation ticket, so this surface only states what is
// recorded and offers the ordinary sign-in route. It never reads, verifies, displays or logs
// the invitation link's own token, and it claims no access, invitation acceptance or delivery.
export function InviteScreen({ initialLocale }: { initialLocale: Locale }) {
  const [locale, setLocale] = useState(initialLocale);
  const text = messages[locale];
  return (
    <AuthShell locale={locale} onLocaleChange={setLocale}>
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">{text.brandMeta}</p>
        <h1 id="auth-title">{text.inviteTitle}</h1>
        <p className="lead">{text.inviteLead}</p>
        <div className="auth-form">
          <a className={buttonClass('primary', { block: true })} href="/login">
            <span className="btn-label">{text.login}</span>
          </a>
        </div>
      </section>
    </AuthShell>
  );
}
