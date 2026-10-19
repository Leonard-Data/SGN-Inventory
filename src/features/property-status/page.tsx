'use client';
import { messages, type Locale } from '@/i18n/messages';
import { statusText } from './messages';
import { StatusRequestQueue } from './queue';

// Status change requests as its own destination (/reviews/status-requests). The queue keeps its own
// protected read, which refuses a non-reviewer, so this page adds no session state of its own.
export function StatusRequestsPage({ locale }: { locale: Locale }) {
  const text = messages[locale];
  const queue = statusText(locale);
  function denied(status: number) {
    window.location.replace(status === 401 ? '/login' : '/access-denied');
  }
  return (
    <>
      <div className="page-head">
        <div className="page-intro">
          <p className="example">{text.title}</p>
          <h1>{queue.queueTitle}</h1>
        </div>
      </div>

      <section className="page-section">
        <StatusRequestQueue locale={locale} onDenied={denied} />
      </section>
    </>
  );
}
