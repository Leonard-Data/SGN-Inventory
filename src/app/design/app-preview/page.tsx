'use client';

import { AppShell } from '@/features/navigation/app-shell';
import { Plate } from '@/features/properties/plate';
import { PropertyCard } from '@/features/properties/property-card';
import { label, messages } from '@/i18n/messages';
import { maintenanceText } from '@/features/property-maintenance/messages';
import type { Employee } from '@/features/employees/types';
import { plateFixtures, summaryFixtures } from './fixtures';

// Review-only route. It renders the shared shell and the inventory and record
// vocabulary from fixtures: no session, no database, no customer data. It exists
// so the ported design can be inspected and compared against the design package
// (see scripts/auth-visual-compare.mjs, PROFILE=applied).
const locale = 'vi' as const;

const reviewer: Employee = {
  id: '00000000-0000-4000-8000-000000000000',
  displayName: 'Nguyễn Thu Hà',
  role: 'admin',
  locale: 'vi',
};

export default function AppPreviewPage() {
  const text = messages[locale];
  const maintenance = maintenanceText(locale);
  return (
    <AppShell locale={locale} employee={reviewer}>
      <p className="alert" data-tone="neutral">
        Trang xem thử thiết kế · hồ sơ hư cấu, không có phiên đăng nhập và không
        có dữ liệu khách hàng. / Design review route · fictional fixtures, no
        session, no customer data.
      </p>

      <section className="page-section">
        <div className="page-head">
          <div className="page-intro">
            <p className="example">{text.title}</p>
            <h1>{text.inventory}</h1>
            <p className="intro-copy">{text.searchHint}</p>
          </div>
          <div className="page-actions">
            <button type="button" className="btn btn-primary">
              {maintenance.create}
            </button>
          </div>
        </div>
        <div className="toolbar">
          <div className="search">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20.5 20.5 16.7 16.7" />
            </svg>
            <input
              className="input"
              type="search"
              defaultValue=""
              aria-label={text.search}
              readOnly
            />
            <button
              type="button"
              className="search-btn"
              aria-label={text.search}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20.5 20.5 16.7 16.7" />
              </svg>
            </button>
          </div>
          <p className="search-hint">{text.searchHint}</p>
        </div>
        <div className="chips">
          <span className="chip">
            {label(locale, 'current')}
            <button type="button" aria-label={text.close}>
              ×
            </button>
          </span>
          <span className="chip">
            {label(locale, 'available')}
            <button type="button" aria-label={text.close}>
              ×
            </button>
          </span>
        </div>
        <div className="row-between">
          <p className="result-line">
            <b>{summaryFixtures.length}</b> {text.inventory}
          </p>
        </div>
        <div className="property-list" data-view="cards">
          {summaryFixtures.map((record) => (
            <PropertyCard
              key={record.id}
              record={record}
              locale={locale}
              resultLocation=""
              onDenied={() => {}}
            />
          ))}
        </div>
      </section>

      <section className="page-section">
        <div className="plate-stage">
          <Plate variant="card" record={plateFixtures[0]!} locale={locale} />
          <Plate variant="bare" record={plateFixtures[1]!} locale={locale} />
        </div>
        <Plate variant="hero" record={plateFixtures[0]!} locale={locale} />
        <Plate variant="card" record={plateFixtures[2]!} locale={locale} />
      </section>

      <section className="page-section">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{text.details}</h2>
            <p className="panel-note">SNH-0148</p>
          </div>
          <div className="panel-body">
            <dl className="facts">
              <div className="fact">
                <dt>{text.propertyCode}</dt>
                <dd className="num">SNH-0148</dd>
              </div>
              <div className="fact">
                <dt>{text.landArea}</dt>
                <dd className="num">120 m²</dd>
              </div>
              <div className="fact">
                <dt>{text.frontage}</dt>
                <dd className="num">8 m</dd>
              </div>
              <div className="fact">
                <dt>{text.depth}</dt>
                <dd className="num">15 m</dd>
              </div>
              <div className="fact">
                <dt>{text.direction}</dt>
                <dd>{label(locale, 'south')}</dd>
              </div>
              <div className="fact">
                <dt>{text.floors}</dt>
                <dd className="num">3</dd>
              </div>
              <div className="fact">
                <dt>{text.reviewStatus}</dt>
                <dd className="is-unknown">{text.unknown}</dd>
              </div>
            </dl>
          </div>
          <div className="panel-foot">
            <span>{text.legalNote}</span>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="table-wrap">
          <table className="data-table stackable">
            <thead>
              <tr>
                <th scope="col">{text.propertyCode}</th>
                <th scope="col">{text.listingMode}</th>
                <th scope="col">{text.status}</th>
                <th scope="col">{text.landArea}</th>
              </tr>
            </thead>
            <tbody>
              {summaryFixtures.map((record) => (
                <tr key={record.id}>
                  <td data-label={text.propertyCode}>
                    <b className="num">{record.propertyCode}</b>
                  </td>
                  <td data-label={text.listingMode}>
                    {label(locale, record.listingMode)}
                  </td>
                  <td data-label={text.status}>
                    <span className="badge" data-tone="neutral">
                      {label(locale, record.status)}
                    </span>
                  </td>
                  <td data-num data-label={text.landArea}>
                    {record.landAreaM2 === null ? (
                      <span className="is-unknown">{text.unknown}</span>
                    ) : (
                      <span className="num">{record.landAreaM2} m²</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <nav className="pagination" aria-label={text.inventory}>
          <p className="page-info">{text.title}</p>
          <div className="page-buttons">
            <button type="button" className="pager-btn" disabled>
              {text.previous}
            </button>
            <button type="button" className="pager-btn">
              {text.next}
            </button>
          </div>
        </nav>
        <div className="panel">
          <div className="state-panel">
            <div className="state-mark">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M20.5 20.5 16.7 16.7" />
              </svg>
            </div>
            <h3>{text.empty}</h3>
            <p>{text.searchHint}</p>
            <button type="button" className="btn btn-secondary">
              {text.retry}
            </button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
