'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { label, messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { SessionHeader } from '@/features/employees/session-header';
import { api, RequestError } from '@/features/employees/api';
import { Workspace } from '@/features/property-files/workspace';
import type { PropertyDetail } from './detail-data';
import { formatVnd, vietnamDate } from './format';
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
  const employeeId = employee?.id;
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
  useEffect(() => {
    if (employeeId) {
      void recordView();
    }
  }, [employeeId, recordView]);
  const property = data?.property;
  const numberFormat = useMemo(
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB'),
    [locale],
  );
  const number = (value: number | null, unit = '') =>
    value === null ? text.unknown : numberFormat.format(value) + unit;
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
      <a href={returnTo}>{text.back}</a>
      <h1 id="main-content" tabIndex={-1}>
        {text.details}
      </h1>
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
            <h2 translate="no">{property.property_code}</h2>
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
                      <p>
                        {text.phone}:{' '}
                        {link.contacts?.raw_phone_text ||
                          link.contacts?.phones.join(' / ') ||
                          text.unknown}
                      </p>
                    </article>
                  ))
                ) : (
                  <p>{text.noContacts}</p>
                )}
              </section>
              <Workspace
                propertyId={id}
                locale={locale}
                employeeId={employeeId ?? null}
                archived={!!property.archived_at}
              />
            </div>
            <p className="muted">{text.pageViewNote}</p>
            {viewError ? (
              <p role="alert">
                {text.pageViewFailed}{' '}
                <button onClick={recordView}>{text.retry}</button>
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
