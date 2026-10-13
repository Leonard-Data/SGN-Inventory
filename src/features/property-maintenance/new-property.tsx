'use client';
import { messages, type Locale } from '@/i18n/messages';
import { CreateProperty } from './create';

// Create property as its own destination (/properties/new). The form renders as a
// plain panel there: the page holds nothing else to collapse it among.
export function NewProperty({ locale }: { locale: Locale }) {
  const text = messages[locale];
  function denied(status: number) {
    window.location.replace(status === 401 ? '/login' : '/access-denied');
  }
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{text.navNewProperty}</h1>
        </div>
      </div>

      <section className="page-section">
        <CreateProperty locale={locale} onDenied={denied} />
      </section>
    </>
  );
}
