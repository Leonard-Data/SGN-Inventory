'use client';

import { useState } from 'react';
import { AppShell } from '@/features/navigation/app-shell';
import { Plate } from '@/features/properties/plate';
import { PropertyCard } from '@/features/properties/property-card';
import { formatVnd, vietnamDate } from '@/features/properties/format';
import { label, messages } from '@/i18n/messages';
import { maintenanceText } from '@/features/property-maintenance/messages';
import type { Employee } from '@/features/employees/types';
import {
  changeFixtures,
  contactFixtures,
  employeeFixtures,
  plateFixtures,
  priceFixtures,
  summaryFixtures,
} from './fixtures';

// Review-only route. It renders the shared shell and the inventory and record
// vocabulary from fixtures: no session, no database, no customer data. It exists
// so the ported design can be inspected and compared against the design package
// (see scripts/auth-visual-compare.mjs, PROFILE=applied).
const locale = 'vi' as const;

// Copy for the two design surfaces the product does not render yet — the record rail's
// timelines and the people directory. It stays in this route rather than the message
// dictionaries so no product surface offers copy for a screen that has no data contract.
const reviewCopy = {
  vi: {
    timeline: 'Giá chào',
    timelineNote:
      'Giá chào chỉ đổi qua thao tác được ghi nhận; bản ghi cũ giữ nguyên.',
    peopleTitle: 'Nhân sự & liên hệ',
    peopleLead:
      'Tài khoản nhân viên và danh bạ liên hệ dùng chung một màn hình, tách bằng hai nhóm.',
    inviteEmployee: 'Mời nhân viên',
    newContact: 'Thêm liên hệ',
    tabsLabel: 'Nhóm danh bạ',
    employees: 'Nhân viên',
    contacts: 'Liên hệ',
    employeePanel: 'Tài khoản nhân viên',
    employeeNote:
      'Vai trò quyết định quyền; vô hiệu hóa không xóa lịch sử đã ghi nhận.',
    contactPanel: 'Danh bạ liên hệ',
    contactNote:
      'Liên hệ thuộc hồ sơ nào thì hiện ở hồ sơ đó; không suy đoán quan hệ.',
    filter: 'Tìm kiếm',
    all: 'Tất cả',
    colPerson: 'Nhân viên',
    colRole: 'Vai trò',
    colStatus: 'Trạng thái',
    colActive: 'Hoạt động gần nhất',
    colActions: 'Thao tác',
    colContact: 'Liên hệ',
    colRelation: 'Quan hệ',
    colPhone: 'Điện thoại',
    colProperties: 'Bất động sản liên kết',
    staff: 'nhân viên',
    contactCount: 'liên hệ',
    propertyCount: 'bất động sản',
    edit: 'Sửa',
    deactivate: 'Vô hiệu hóa',
    reactivate: 'Kích hoạt lại',
  },
  en: {
    timeline: 'Asking price',
    timelineNote:
      'The asking price only moves through a recorded action; earlier records are kept.',
    peopleTitle: 'People & contacts',
    peopleLead:
      'Employee accounts and the contact book share one screen, split into two groups.',
    inviteEmployee: 'Invite employee',
    newContact: 'New contact',
    tabsLabel: 'Directory group',
    employees: 'Employees',
    contacts: 'Contacts',
    employeePanel: 'Employee accounts',
    employeeNote:
      'The role decides permissions; deactivating keeps everything already recorded.',
    contactPanel: 'Contact book',
    contactNote:
      'A contact appears on the records it belongs to; relationships are not inferred.',
    filter: 'Search',
    all: 'All',
    colPerson: 'Employee',
    colRole: 'Role',
    colStatus: 'Status',
    colActive: 'Last active',
    colActions: 'Actions',
    colContact: 'Contact',
    colRelation: 'Relationship',
    colPhone: 'Phone',
    colProperties: 'Linked properties',
    staff: 'employees',
    contactCount: 'contacts',
    propertyCount: 'properties',
    edit: 'Edit',
    deactivate: 'Deactivate',
    reactivate: 'Reactivate',
  },
};

const reviewer: Employee = {
  id: '00000000-0000-4000-8000-000000000000',
  displayName: 'Nguyễn Thu Hà',
  role: 'admin',
  locale: 'vi',
};

export default function AppPreviewPage() {
  const text = messages[locale];
  const maintenance = maintenanceText(locale);
  const review = reviewCopy[locale];
  const [tab, setTab] = useState<'employees' | 'contacts'>('employees');
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
              showEntry={record.entryOn !== undefined}
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

      <section className="page-section">
        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{review.timeline}</h2>
            <p className="panel-note">SNH-0148</p>
          </div>
          <div className="panel-body">
            {priceFixtures.map((row) => (
              <div className="price-row" key={row.when + row.to}>
                <span className="price-when">{vietnamDate(row.when)}</span>
                <span className="price-change">
                  {row.from ? (
                    <>
                      <del>{formatVnd(row.from, locale)}</del> →{' '}
                    </>
                  ) : null}
                  <b>{formatVnd(row.to, locale)}</b>
                </span>
                <span className="price-who">{row.who}</span>
              </div>
            ))}
          </div>
          <div className="panel-foot">
            <span>{review.timelineNote}</span>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{maintenance.history}</h2>
            <p className="panel-note">SNH-0148</p>
          </div>
          <div className="panel-body">
            <ul className="timeline">
              {changeFixtures.map((change, index) => (
                <li
                  className="tl-item"
                  data-first={index === 0 ? 'true' : undefined}
                  key={change.when + change.time}
                >
                  <p className="tl-time">
                    {vietnamDate(change.when)} · {change.time}
                  </p>
                  <p className="tl-title">
                    {change.title[locale === 'vi' ? 0 : 1]}
                  </p>
                  <p className="tl-body">
                    {change.body[locale === 'vi' ? 0 : 1]}
                  </p>
                  <p className="tl-actor">{change.actor}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="page-section">
        <div className="page-head">
          <div>
            <p className="eyebrow">SAIGON NEW HOUSE · {review.peopleTitle}</p>
            <h1>{review.peopleTitle}</h1>
            <p className="intro-copy">{review.peopleLead}</p>
          </div>
          <div className="page-actions">
            <button type="button" className="btn btn-secondary">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="9.5" cy="8" r="3.2" />
                <path d="M3.5 20a6 6 0 0 1 12 0" />
                <path d="M18 8v6M15 11h6" />
              </svg>
              <span>{review.inviteEmployee}</span>
            </button>
            <button type="button" className="btn btn-primary">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>{review.newContact}</span>
            </button>
          </div>
        </div>

        <div
          className="tabs directory-tabs"
          role="tablist"
          aria-label={review.tabsLabel}
        >
          <button
            className="tab"
            type="button"
            role="tab"
            id="review-tab-employees"
            aria-controls="review-panel-employees"
            aria-selected={tab === 'employees'}
            tabIndex={tab === 'employees' ? 0 : -1}
            onClick={() => setTab('employees')}
          >
            <span>{review.employees}</span>
            <span className="num">{employeeFixtures.length}</span>
          </button>
          <button
            className="tab"
            type="button"
            role="tab"
            id="review-tab-contacts"
            aria-controls="review-panel-contacts"
            aria-selected={tab === 'contacts'}
            tabIndex={tab === 'contacts' ? 0 : -1}
            onClick={() => setTab('contacts')}
          >
            <span>{review.contacts}</span>
            <span className="num">{contactFixtures.length}</span>
          </button>
        </div>

        <div
          className="panel"
          role="tabpanel"
          id="review-panel-employees"
          aria-labelledby="review-tab-employees"
          hidden={tab !== 'employees'}
        >
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{review.employeePanel}</h2>
              <p className="panel-note">{review.employeeNote}</p>
            </div>
            <form className="toolbar toolbar-labelled">
              <div className="field filter-field">
                <label className="field-label" htmlFor="review-employee-query">
                  {review.filter}
                </label>
                <input
                  className="input"
                  id="review-employee-query"
                  type="search"
                  readOnly
                  value=""
                />
              </div>
              <div className="field field-sort">
                <label className="field-label" htmlFor="review-employee-status">
                  {review.colStatus}
                </label>
                <select
                  className="select select-sm"
                  id="review-employee-status"
                  value=""
                  disabled
                >
                  <option value="">{review.all}</option>
                </select>
              </div>
            </form>
          </div>
          <div className="panel-body">
            <div className="row-between">
              <p className="result-line">
                <b>{employeeFixtures.length}</b> {review.staff}
              </p>
            </div>
            <div className="table-wrap">
              <table
                className="data-table stackable"
                aria-labelledby="review-panel-employees"
              >
                <thead>
                  <tr>
                    <th scope="col">{review.colPerson}</th>
                    <th scope="col">{review.colRole}</th>
                    <th scope="col">{review.colStatus}</th>
                    <th scope="col">{review.colActive}</th>
                    <th className="cell-actions" scope="col">
                      {review.colActions}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {employeeFixtures.map((employee) => (
                    <tr key={employee.email}>
                      <td data-label={review.colPerson}>
                        <span className="cell-person">
                          <span
                            className="sgn-avatar sgn-avatar-sm"
                            aria-hidden="true"
                          >
                            {employee.initials}
                          </span>
                          <span>
                            <b translate="no">{employee.name}</b>
                            <small>{employee.email}</small>
                          </span>
                        </span>
                      </td>
                      <td data-label={review.colRole}>
                        {employee.role[locale === 'vi' ? 0 : 1]}
                      </td>
                      <td data-label={review.colStatus}>
                        <span className="badge" data-tone={employee.tone}>
                          {employee.status[locale === 'vi' ? 0 : 1]}
                        </span>
                      </td>
                      <td data-label={review.colActive}>
                        <span className="num cell-date">{employee.active}</span>
                      </td>
                      <td
                        className="cell-actions"
                        data-label={review.colActions}
                      >
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                        >
                          {review.edit}
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm">
                          {employee.tone === 'neutral'
                            ? review.reactivate
                            : review.deactivate}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div
          className="panel"
          role="tabpanel"
          id="review-panel-contacts"
          aria-labelledby="review-tab-contacts"
          hidden={tab !== 'contacts'}
        >
          <div className="panel-head">
            <div>
              <h2 className="panel-title">{review.contactPanel}</h2>
              <p className="panel-note">{review.contactNote}</p>
            </div>
            <form className="toolbar toolbar-labelled">
              <div className="field filter-field">
                <label className="field-label" htmlFor="review-contact-query">
                  {review.filter}
                </label>
                <input
                  className="input"
                  id="review-contact-query"
                  type="search"
                  readOnly
                  value=""
                />
              </div>
              <div className="field field-sort">
                <label
                  className="field-label"
                  htmlFor="review-contact-relation"
                >
                  {review.colRelation}
                </label>
                <select
                  className="select select-sm"
                  id="review-contact-relation"
                  value=""
                  disabled
                >
                  <option value="">{review.all}</option>
                </select>
              </div>
            </form>
          </div>
          <div className="panel-body">
            <div className="row-between">
              <p className="result-line">
                <b>{contactFixtures.length}</b> {review.contactCount}
              </p>
            </div>
            <div className="table-wrap">
              <table
                className="data-table stackable"
                aria-labelledby="review-panel-contacts"
              >
                <thead>
                  <tr>
                    <th scope="col">{review.colContact}</th>
                    <th scope="col">{review.colRelation}</th>
                    <th scope="col">{review.colPhone}</th>
                    <th scope="col">{review.colProperties}</th>
                    <th className="cell-actions" scope="col">
                      {review.colActions}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {contactFixtures.map((contact) => (
                    <tr key={contact.name}>
                      <td data-label={review.colContact}>
                        <span className="cell-person">
                          <span
                            className="sgn-avatar sgn-avatar-sm"
                            aria-hidden="true"
                          >
                            {contact.initials}
                          </span>
                          <span>
                            <b translate="no">{contact.name}</b>
                          </span>
                        </span>
                      </td>
                      <td data-label={review.colRelation}>
                        {contact.relation[locale === 'vi' ? 0 : 1]}
                      </td>
                      <td data-label={review.colPhone}>
                        <span className="num" translate="no">
                          {contact.phone}
                        </span>
                      </td>
                      <td data-label={review.colProperties}>
                        {contact.properties} {review.propertyCount}
                      </td>
                      <td
                        className="cell-actions"
                        data-label={review.colActions}
                      >
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                        >
                          {review.edit}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
