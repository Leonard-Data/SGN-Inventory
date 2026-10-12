'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { label, messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { SessionHeader } from '@/features/employees/session-header';
import { RequestError } from '@/features/employees/api';
import { Workspace } from '@/features/property-files/workspace';
import {
  loadPropertyDetail,
  loadTodayActivity,
  loadTodayReport,
  revealOwnerContact,
} from './detail-loader';
import type { PropertyDetail } from './detail-data';
import type { OwnerContactDisclosure } from './types';
import { Maintenance } from '@/features/property-maintenance/workspace';
import { History } from '@/features/property-maintenance/history';
import {
  CorrectionQueue,
  CorrectionReport,
} from '@/features/corrections/queue';
import {
  formatVnd,
  formatDecimal,
  vietnamDate,
  dialableNumber,
} from './format';
import { Discussion } from '@/features/property-comments/discussion';

const directionKeys: Record<string, string> = {
  N: 'north',
  NE: 'northeast',
  E: 'east',
  SE: 'southeast',
  S: 'south',
  SW: 'southwest',
  W: 'west',
  NW: 'northwest',
};
export function Detail({
  id,
  initialLocale,
  returnTo,
}: {
  id: string;
  initialLocale: Locale;
  returnTo: string;
}) {
  const viewKey = useRef<string | null>(null);
  const loadDetail = useCallback(
    (signal: AbortSignal) => {
      viewKey.current ??= crypto.randomUUID();
      return loadPropertyDetail(id, signal);
    },
    [id],
  );
  const {
    employee,
    data,
    error,
    busy,
    surface,
    logout,
    applyLocale,
    clear,
    reload,
  } = useProtectedData(loadDetail);
  const locale = employee?.locale ?? initialLocale;
  const text = messages[locale];
  const [refreshTick, setRefreshTick] = useState(0);
  async function changed() {
    await reload();
    setRefreshTick((value) => value + 1);
  }
  const [activity, setActivity] = useState<{
    detail: PropertyDetail;
    viewError: boolean;
    today: Awaited<ReturnType<typeof loadTodayActivity>>['today'];
    todayError: boolean;
  } | null>(null);
  const [disclosure, setDisclosure] = useState<{
    propertyId: string;
    value: OwnerContactDisclosure;
  } | null>(null);
  const [disclosureFailure, setDisclosureFailure] = useState<{
    propertyId: string;
    code: string;
  } | null>(null);
  const [disclosureBusy, setDisclosureBusy] = useState<string | null>(null);
  // One retry reference per property mount: a lost response recovers the original access,
  // and a new property never reuses the previous key.
  const disclosureKey = useRef<{ propertyId: string; key: string } | null>(
    null,
  );
  // Disclosure is a deliberate action: no request runs on load, render or language switch.
  async function showOwnerContact() {
    if (disclosureBusy === id) return;
    if (!disclosureKey.current || disclosureKey.current.propertyId !== id)
      disclosureKey.current = { propertyId: id, key: crypto.randomUUID() };
    setDisclosureBusy(id);
    setDisclosureFailure(null);
    try {
      const result = await revealOwnerContact(id, disclosureKey.current.key);
      setDisclosure({ propertyId: id, value: result });
      if (result.credited) {
        try {
          const report = await loadTodayReport();
          setActivity((current) =>
            current
              ? { ...current, today: report, todayError: false }
              : current,
          );
        } catch {
          setActivity((current) =>
            current ? { ...current, todayError: true } : current,
          );
        }
      }
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        clear();
        window.location.replace(
          failure.status === 403 ? '/access-denied' : '/login',
        );
        return;
      }
      setDisclosureFailure({
        propertyId: id,
        code: failure instanceof RequestError ? failure.code : 'unavailable',
      });
    } finally {
      setDisclosureBusy((current) => (current === id ? null : current));
    }
  }
  useEffect(() => {
    if (!data) return;
    const abort = new AbortController();
    let current = true;
    void loadTodayActivity(id, viewKey.current ?? '', abort.signal)
      .then((result) => {
        if (current) setActivity({ detail: data, ...result });
      })
      .catch((failure) => {
        if (!current || abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          clear();
          window.location.replace(
            failure.status === 403 ? '/access-denied' : '/login',
          );
          return;
        }
        setActivity({
          detail: data,
          viewError: false,
          today: null,
          todayError: true,
        });
      });
    return () => {
      current = false;
      abort.abort();
    };
  }, [data, id, clear]);
  const own = activity?.detail === data ? activity : null;
  const viewError = own?.viewError ?? false;
  const today = own?.today ?? null;
  const todayError = own?.todayError ?? false;
  const ownerContact = disclosure?.propertyId === id ? disclosure.value : null;
  const ownerBusy = disclosureBusy === id;
  const disclosureError =
    disclosureFailure?.propertyId === id ? disclosureFailure.code : null;
  const disclosureMessage =
    disclosureError === 'owner-contact-missing'
      ? text.ownerContactMissing
      : disclosureError === 'owner-phone-missing'
        ? text.ownerPhoneMissing
        : disclosureError === 'disclosure-key-conflict'
          ? text.ownerContactKeyConflict
          : disclosureError === 'invalid-input'
            ? text.invalidInput
            : disclosureError === 'not-found'
              ? text.notFound
              : text.ownerContactFailed;
  const dial = ownerContact ? dialableNumber(ownerContact.contact.phone) : null;
  const employeeId = employee?.id;
  const denyFiles = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  const property = data?.property;
  const canEdit =
    !!employee &&
    !!property &&
    !property.archived_at &&
    (employee.id === property.created_by ||
      ['staff', 'manager', 'admin'].includes(employee.role));
  const coverFileId = property?.cover_file_id ?? null;
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );
  const number = (value: number | string | null, unit = '') =>
    value === null
      ? text.unknown
      : (typeof value === 'string'
          ? formatDecimal(value, locale)
          : numberFormat.format(value)) + unit;
  return (
    <main lang={locale}>
      <a className="skip-link" href="#main-content">
        {text.skipToContent}
      </a>
      <SessionHeader
        employee={employee}
        locale={locale}
        busy={busy}
        logout={logout}
        applyLocale={applyLocale}
        clear={clear}
      />
      <nav className="detail-breadcrumb" aria-label={text.back}>
        <a href={returnTo}>{text.back}</a>
        <span aria-hidden="true">/</span>
        <span>{text.details}</span>
      </nav>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">{text.details}</p>
          <h1 id="main-content" tabIndex={-1}>
            {property?.property_code ?? text.details}
          </h1>
        </div>
        {property ? (
          <span className="badge detail-status">
            {label(locale, property.status)}
          </span>
        ) : null}
      </div>
      {busy && !property ? <p role="status">{text.loading}</p> : null}
      {error ? (
        <p role="alert">
          {error === 'not-found'
            ? text.notFound
            : error === 'sign-out-failed'
              ? text.signOutFailed
              : error === 'invalid-input'
                ? text.invalidInput
                : text.unavailable}{' '}
          <button onClick={error === 'sign-out-failed' ? logout : reload}>
            {text.retry}
          </button>
        </p>
      ) : null}
      <div ref={surface} hidden={!property}>
        {property && data ? (
          <>
            {property.archived_at ? (
              <p className="badge">
                {text.archived} · {vietnamDate(property.archived_at)}
              </p>
            ) : null}
            <div className="details">
              <section className="panel">
                <dl>
                  <dt>{text.listingMode}</dt>
                  <dd>{label(locale, property.listing_mode)}</dd>
                  <dt>{text.propertyType}</dt>
                  <dd>{label(locale, property.property_type)}</dd>
                  <dt>{text.accessType}</dt>
                  <dd>{label(locale, property.access_type)}</dd>
                  <dt>{text.status}</dt>
                  <dd>{label(locale, property.status)}</dd>
                  <dt>{text.reviewStatus}</dt>
                  <dd>{label(locale, property.record_review_status)}</dd>
                  <dt>{text.legalStatus}</dt>
                  <dd>{label(locale, property.legal_status)}</dd>
                  <dt>{text.salePrice}</dt>
                  <dd>
                    {property.sale_price_vnd === null
                      ? text.unknown
                      : formatVnd(property.sale_price_vnd, locale)}
                  </dd>
                  <dt>{text.monthlyRent}</dt>
                  <dd>
                    {property.monthly_rent_vnd === null
                      ? text.unknown
                      : formatVnd(property.monthly_rent_vnd, locale)}
                  </dd>
                  <dt>{text.landArea}</dt>
                  <dd>{number(property.land_area_m2, ' m²')}</dd>
                  <dt>{text.floorArea}</dt>
                  <dd>{number(property.floor_area_m2, ' m²')}</dd>
                  <dt>{text.frontage}</dt>
                  <dd>{number(property.frontage_m, ' m')}</dd>
                  <dt>{text.depth}</dt>
                  <dd>{number(property.depth_m, ' m')}</dd>
                  <dt>{text.floors}</dt>
                  <dd>{number(property.floors)}</dd>
                  <dt>{text.bedrooms}</dt>
                  <dd>{number(property.bedrooms)}</dd>
                  <dt>{text.bathrooms}</dt>
                  <dd>{number(property.bathrooms)}</dd>
                  <dt>{text.direction}</dt>
                  <dd>
                    {label(
                      locale,
                      property.direction
                        ? directionKeys[property.direction]
                        : null,
                    )}
                  </dd>
                  <dt>{text.updated}</dt>
                  <dd>{vietnamDate(property.updated_at)}</dd>
                </dl>
                <p className="muted">{text.legalNote}</p>
              </section>
              <section className="panel">
                <h2>{text.address}</h2>
                {data.addresses.map((address) => (
                  <article key={address.id}>
                    <h3>
                      {label(locale, address.format)}{' '}
                      <span className="badge">
                        {label(locale, address.mapping_status)}
                      </span>
                    </h3>
                    <p translate="no">{address.address_text}</p>
                  </article>
                ))}
                {!data.addresses.some(
                  (address) => address.format === 'current',
                ) ? (
                  <p>{text.noCurrent}</p>
                ) : null}
                {data.addresses.length === 0 ? <p>{text.unknown}</p> : null}
              </section>
              <section className="panel">
                <h2>{text.contacts}</h2>
                {data.contacts.length ? (
                  data.contacts.map((link) => (
                    <article key={link.contacts?.id}>
                      <h3 translate="no">
                        {link.contacts?.display_name ?? text.unknown}
                      </h3>
                      <p>
                        {label(locale, link.relation)}{' '}
                        {link.is_primary ? (
                          <span className="badge">{text.primary}</span>
                        ) : null}
                      </p>
                    </article>
                  ))
                ) : (
                  <p>{text.noContacts}</p>
                )}
                <div className="owner-disclosure">
                  <h3>{text.owner}</h3>
                  {ownerContact ? (
                    <>
                      <p translate="no">
                        {ownerContact.contact.displayName}{' '}
                        <span className="badge">
                          {label(locale, ownerContact.contact.relation)}
                        </span>
                        {ownerContact.contact.isPrimary ? (
                          <span className="badge">{text.primary}</span>
                        ) : null}
                      </p>
                      <p className="owner-phone" translate="no">
                        {ownerContact.contact.phone}
                      </p>
                      {dial ? (
                        <a href={'tel:' + dial}>{text.call}</a>
                      ) : (
                        <p className="muted">{text.callUnavailable}</p>
                      )}
                    </>
                  ) : (
                    <>
                      {disclosureError ? (
                        <p role="alert">{disclosureMessage}</p>
                      ) : null}
                      <button
                        type="button"
                        onClick={showOwnerContact}
                        disabled={busy || ownerBusy}
                        aria-busy={ownerBusy}
                      >
                        {ownerBusy
                          ? text.loading
                          : disclosureError
                            ? text.retry
                            : text.showOwnerContact}
                      </button>
                    </>
                  )}
                  <p className="muted">{text.ownerContactNote}</p>
                </div>
              </section>
              <Workspace
                key={`${id}:${employeeId}`}
                propertyId={id}
                locale={locale}
                employeeId={employeeId ?? null}
                archived={!!property.archived_at}
                onDenied={denyFiles}
                canEdit={canEdit}
                coverFileId={coverFileId}
                onCoverChanged={reload}
              />
            </div>
            {employee ? (
              <>
                <Maintenance
                  key={property.id}
                  detail={data}
                  employee={employee}
                  locale={locale}
                  onSaved={changed}
                  onDenied={denyFiles}
                />
                <CorrectionReport
                  key={property.id}
                  detail={data}
                  locale={locale}
                  role={employee.role}
                  onDenied={denyFiles}
                  onSaved={changed}
                />
                <CorrectionQueue
                  key={'requests' + property.id + refreshTick}
                  propertyId={property.id}
                  employee={employee}
                  locale={locale}
                  onDenied={denyFiles}
                  onChanged={() => void changed()}
                />
                <History
                  key={
                    'history' + property.id + property.revision + refreshTick
                  }
                  propertyId={property.id}
                  locale={locale}
                />
              </>
            ) : null}
            <Discussion
              key={property.id}
              propertyId={property.id}
              locale={locale}
              archived={!!property.archived_at}
              onDenied={denyFiles}
            />
            <p className="muted">{text.pageViewNote}</p>
            {viewError ? (
              <p role="alert">
                {text.pageViewFailed}{' '}
                <button onClick={reload}>{text.retry}</button>
              </p>
            ) : null}
            <section className="panel" aria-labelledby="today-activity">
              <h2 id="today-activity">{text.todayActivity}</h2>
              {todayError ? (
                <p role="alert">
                  {text.todayActivityFailed}{' '}
                  <button onClick={reload}>{text.retry}</button>
                </p>
              ) : today ? (
                <dl>
                  <dt>{text.todayDay}</dt>
                  <dd>{vietnamDate(today.businessDay)}</dd>
                  <dt>{text.todayPageViews}</dt>
                  <dd>{numberFormat.format(today.pageViewEvents)}</dd>
                  <dt>{text.todayProperties}</dt>
                  <dd>{numberFormat.format(today.distinctPropertiesViewed)}</dd>
                  <dt>{text.todayOwnerContacts}</dt>
                  <dd>{numberFormat.format(today.ownerContactProperties)}</dd>
                </dl>
              ) : (
                <p role="status">{text.loading}</p>
              )}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
