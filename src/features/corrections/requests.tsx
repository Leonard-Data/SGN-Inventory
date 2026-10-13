'use client';
import { messages, type Locale } from '@/i18n/messages';
import { CorrectionQueue } from './queue';

// Correction requests as its own destination (/reviews/corrections). The queue keeps its
// own protected read, so this page adds no session state of its own.
export function CorrectionRequests({ locale }: { locale: Locale }) {
  const text = messages[locale];
  function denied(status: number) {
    window.location.replace(status === 401 ? '/login' : '/access-denied');
  }
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.navCorrections}</h1>
        </div>
      </div>

      <section className="page-section">
        <CorrectionQueue locale={locale} onDenied={denied} />
      </section>
    </>
  );
}
