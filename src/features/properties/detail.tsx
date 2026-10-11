'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { label, messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { SessionHeader } from '@/features/employees/session-header';
import { api, RequestError } from '@/features/employees/api';
import { Workspace } from '@/features/property-files/workspace';
import type { TodayActivity } from '@/features/employees/activity';
import type { PropertyDetail } from './detail-data';
import { Maintenance } from '@/features/property-maintenance/workspace';
import { History } from '@/features/property-maintenance/history';
import {
  CorrectionQueue,
  CorrectionReport,
} from '@/features/corrections/queue';
import { formatVnd, formatDecimal, vietnamDate } from './format';

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
  } = useProtectedData<PropertyDetail>('/api/properties/' + id);
  const locale = employee?.locale ?? initialLocale;
  const text = messages[locale];
  const viewKey = useRef<string | null>(null);
  const viewRequest = useRef<Promise<void> | null>(null);
  const [viewError, setViewError] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  async function changed() {
    await reload();
    setRefreshTick((value) => value + 1);
  }
  const [today, setToday] = useState<TodayActivity | null>(null);
  const [todayError, setTodayError] = useState(false);
  const todayRequest = useRef<Promise<void> | null>(null);
  const employeeId = employee?.id;
  const denyFiles = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  const recordView = useCallback(async () => {
    if (viewRequest.current) return viewRequest.current;
    viewKey.current ??= crypto.randomUUID();
    const promise = api('/api/properties/' + id + '/page-view', {
      key: viewKey.current,
    })
      .then(() => {
        setViewError(false);
      })
      .catch((failure) => {
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          clear();
          window.location.replace(
            failure.status === 403 ? '/access-denied' : '/login',
          );
        } else setViewError(true);
      })
      .finally(() => {
        viewRequest.current = null;
      });
    viewRequest.current = promise;
    return promise;
  }, [clear, id]);
  const loadToday = useCallback(async () => {
    if (todayRequest.current) return todayRequest.current;
    const promise = api<TodayActivity>('/api/activity/today')
      .then((result) => {
        setToday(result);
        setTodayError(false);
      })
      .catch((failure) => {
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        ) {
          clear();
          window.location.replace(
            failure.status === 403 ? '/access-denied' : '/login',
          );
        } else {
          setToday(null);
          setTodayError(true);
        }
      })
      .finally(() => {
        todayRequest.current = null;
      });
    todayRequest.current = promise;
    return promise;
  }, [clear]);
  useEffect(() => {
    if (employeeId) {
      void recordView().then(loadToday);
    }
  }, [employeeId, recordView, loadToday]);
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
      {busy ? <p role="status">{text.loading}</p> : null}
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
      <div ref={surface} hidden={!property || busy}>
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
            <p className="muted">{text.pageViewNote}</p>
            {viewError ? (
              <p role="alert">
                {text.pageViewFailed}{' '}
                <button onClick={() => void recordView().then(loadToday)}>
                  {text.retry}
                </button>
              </p>
            ) : null}
            <section className="panel" aria-labelledby="today-activity">
              <h2 id="today-activity">{text.todayActivity}</h2>
              {todayError ? (
                <p role="alert">
                  {text.todayActivityFailed}{' '}
                  <button onClick={() => void loadToday()}>{text.retry}</button>
                </p>
              ) : today ? (
                <dl>
                  <dt>{text.todayDay}</dt>
                  <dd>{vietnamDate(today.businessDay)}</dd>
                  <dt>{text.todayPageViews}</dt>
                  <dd>{numberFormat.format(today.pageViewEvents)}</dd>
                  <dt>{text.todayProperties}</dt>
                  <dd>{numberFormat.format(today.distinctPropertiesViewed)}</dd>
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
