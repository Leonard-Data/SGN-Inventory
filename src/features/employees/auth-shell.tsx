'use client';
import Image from 'next/image';
import { useEffect, type ReactNode } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { LanguageSwitch } from './auth-ui';

/**
 * Shared authentication shell from the canonical SGN design (ticket #50): the
 * deep-green brand rail (compact header below 1040px), the panel language
 * control, the centred form column and the panel footer. One lockup means the
 * mark lands in the same place on every authentication view.
 */
export function AuthShell({
  locale,
  onLocaleChange,
  languageDisabled = false,
  children,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  languageDisabled?: boolean;
  children: ReactNode;
}) {
  const text = messages[locale];
  // Keep the document language in step with the selected presentation language.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return (
    <div className="sgn-auth" lang={locale}>
      <a className="sgn-skip" href="#main-content">
        {text.skipToContent}
      </a>
      <aside className="sgn-rail">
        <div className="sgn-lockup">
          <span className="sgn-logo-tile">
            <Image
              src="/brand/logo.png"
              alt=""
              width={240}
              height={206}
              priority
            />
          </span>
          <span className="sgn-wordmark" translate="no">
            Saigon New House
            <span>{text.brandRole}</span>
          </span>
        </div>
        <div className="sgn-rail-body">
          <h2>{text.brandTitle}</h2>
          <p>{text.brandLede}</p>
        </div>
        <p className="sgn-rail-meta">{text.brandMeta}</p>
      </aside>
      <main className="sgn-panel" id="main-content">
        <div className="sgn-panel-bar">
          <LanguageSwitch
            locale={locale}
            onChange={onLocaleChange}
            disabled={languageDisabled}
            label={text.languageName}
          />
        </div>
        <div className="sgn-panel-main">{children}</div>
        <p className="sgn-panel-foot">{text.footNote}</p>
      </main>
    </div>
  );
}
