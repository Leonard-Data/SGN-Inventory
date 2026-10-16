'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { label, messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import {
  isPropertyAccessFailure,
  RequestError,
} from '@/features/employees/api';
import { Workspace } from '@/features/property-files/workspace';
import { CoverImage } from '@/features/property-files/cover-image';
import { Plate } from './plate';
import {
  loadPropertyDetail,
  loadTodayActivity,
  revealOwnerContact,
} from './detail-loader';
import type { PropertyDetail } from './detail-data';
import type { OwnerContactDisclosure } from './types';
import { Maintenance } from '@/features/property-maintenance/workspace';
import { maintenanceText } from '@/features/property-maintenance/messages';
import { History } from '@/features/property-maintenance/history';
import { PriceHistory } from '@/features/property-maintenance/price-history';
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
import { Reservation } from './reservation';
import { SaleCompletion } from '@/features/sales/completion';
import { detailMessages } from './messages';
import { contactRows } from './contact-rows';
import {
  activeDetailAction,
  activeDetailDisclosure,
  canEditDetail,
  canOpenEditDetail,
  type DetailAction,
} from './detail-actions';
// The record screen groups its content the way the design package does: the record's own
// facts, its documents and its discussion.
const RECORD_TABS = ['overview', 'docs', 'comments'] as const;
type RecordTab = (typeof RECORD_TABS)[number];
function DetailActionDialog({
  title,
  closeLabel,
  children,
  open,
  onClose,
  size = 'wide',
}: {
  title: string;
  closeLabel: string;
  children: ReactNode;
  open: boolean;
  onClose: () => void;
  size?: 'default' | 'wide';
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="sgn-dialog"
      data-size={size}
      onClose={onClose}
      onCancel={onClose}
      aria-label={title}
    >
      <div className="sgn-dialog-panel">
        <div className="sgn-dialog-head">
          <h2>{title}</h2>
          <button
            className="sgn-dialog-close"
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
          >
            ×
          </button>
        </div>
        <div className="sgn-dialog-body">{open ? children : null}</div>
      </div>
    </dialog>
  );
}

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
function statusTone(
  status: string | null,
): 'success' | 'danger' | 'warn' | 'neutral' {
  if (!status) return 'neutral';
  if (status === 'active' || status === 'listed' || status === 'available')
    return 'success';
  if (
    status === 'pending' ||
    status === 'negotiating' ||
    status === 'under-contract'
  )
    return 'warn';
  if (
    status === 'sold' ||
    status === 'leased' ||
    status === 'inactive' ||
    status === 'off-market'
  )
    return 'danger';
  return 'neutral';
}
function mappingTone(
  status: string | null,
): 'success' | 'danger' | 'warn' | 'neutral' {
  if (!status) return 'neutral';
  if (status === 'verified' || status === 'confirmed') return 'success';
  if (status === 'tentative' || status === 'approximate') return 'warn';
  if (status === 'conflicting' || status === 'invalid') return 'danger';
  return 'neutral';
}
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
  // The server layout and page both derive this from the sgn-locale cookie, which
  // set_my_locale, login and the request proxy keep equal to the saved preference, so
  // a language switch re-renders the body instead of leaving it on the fetched value.
  const locale = initialLocale;
  const text = messages[locale];
  const [tab, setTab] = useState<RecordTab>('overview');
  const [actionDialog, setActionDialog] = useState<DetailAction | null>(null);
  // Roving tabindex: the arrow keys move both focus and selection across the three tabs.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = RECORD_TABS.indexOf(tab);
    const next =
      event.key === 'ArrowRight'
        ? RECORD_TABS[(index + 1) % RECORD_TABS.length]
        : event.key === 'ArrowLeft'
          ? RECORD_TABS[(index + RECORD_TABS.length - 1) % RECORD_TABS.length]
          : event.key === 'Home'
            ? RECORD_TABS[0]
            : event.key === 'End'
              ? RECORD_TABS[RECORD_TABS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById('record-tab-' + next)?.focus();
  }
  const [refreshTick, setRefreshTick] = useState(0);
  const [creditTick, setCreditTick] = useState(0);
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
    employeeId: string;
    value: OwnerContactDisclosure;
  } | null>(null);
  const [disclosureFailure, setDisclosureFailure] = useState<{
    propertyId: string;
    code: string;
  } | null>(null);
  const [disclosureBusy, setDisclosureBusy] = useState<string | null>(null);
  // One retry reference per property mount: a lost response recovers the original access,
  // and a new property never reuses the previous key.
  const disclosureKey = useRef<{
    propertyId: string;
    employeeId: string;
    key: string;
  } | null>(null);
  const disclosureGeneration = useRef(0);
  const resetProtectedState = useCallback(() => {
    disclosureGeneration.current += 1;
    disclosureKey.current = null;
    setActionDialog(null);
    setActivity(null);
    setDisclosure(null);
    setDisclosureFailure(null);
    setDisclosureBusy(null);
  }, [
    setActionDialog,
    setActivity,
    setDisclosure,
    setDisclosureFailure,
    setDisclosureBusy,
  ]);
  const { employee, data, error, busy, surface, logout, clear, reload } =
    useProtectedData(loadDetail, resetProtectedState);
  const recoverChildAfterInvalidation = useCallback(() => {
    clear();
    void reload();
  }, [clear, reload]);
  // Disclosure is a deliberate action: no request runs on load, render or language switch.
  async function showOwnerContact() {
    const currentEmployeeId = employee?.id;
    if (!currentEmployeeId || disclosureBusy === id) return;
    const requestGeneration = disclosureGeneration.current;
    if (
      !disclosureKey.current ||
      disclosureKey.current.propertyId !== id ||
      disclosureKey.current.employeeId !== currentEmployeeId
    ) {
      disclosureKey.current = {
        propertyId: id,
        employeeId: currentEmployeeId,
        key: crypto.randomUUID(),
      };
    }
    const request = disclosureKey.current;
    if (!request) return;
    setDisclosureBusy(id);
    setDisclosureFailure(null);
    try {
      const result = await revealOwnerContact(id, request.key);
      if (requestGeneration !== disclosureGeneration.current) return;
      setDisclosure({
        propertyId: id,
        employeeId: currentEmployeeId,
        value: result,
      });
      // A committed credit re-reads today's report through the same abortable load, so the
      // post-credit read always wins over an in-flight pre-credit one.
      if (result.credited) setCreditTick((value) => value + 1);
    } catch (failure) {
      if (requestGeneration !== disclosureGeneration.current) return;
      if (isPropertyAccessFailure(failure)) {
        recoverChildAfterInvalidation();
        return;
      }
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
      if (requestGeneration === disclosureGeneration.current) {
        setDisclosureBusy((current) => (current === id ? null : current));
      }
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
  }, [data, id, clear, creditTick]);
  const own = activity?.detail === data ? activity : null;
  const viewError = own?.viewError ?? false;
  const today = own?.today ?? null;
  const todayError = own?.todayError ?? false;
  const ownerContact = activeDetailDisclosure(
    disclosure,
    id,
    employee?.id ?? null,
  );
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
  const dial = ownerContact?.contact
    ? dialableNumber(ownerContact.contact.phone)
    : null;
  const employeeId = employee?.id;
  const denyFiles = useCallback(
    (status: number) => {
      clear();
      window.location.replace(status === 401 ? '/login' : '/access-denied');
    },
    [clear],
  );
  const property = data?.property ?? null;
  const canEdit = canEditDetail(employee, property);
  const canOpenEdit = canOpenEditDetail(employee, property);
  const activeActionDialog =
    data && property
      ? activeDetailAction(actionDialog, employee, property)
      : null;
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
  // One projection for every contact surface: the recorded owner phone is withheld until the
  // deliberate Show owner contact disclosure, on the overview panel and the sticky card alike.
  const contacts = useMemo(
    () => contactRows(data?.contacts ?? []),
    [data?.contacts],
  );
  const dt = detailMessages[locale];
  const mt = maintenanceText(locale);
  return (
    <div lang={locale}>
      <p>
        <a className="link-quiet" href={returnTo}>
          {dt.back}
        </a>
      </p>

      <div className="detail-head">
        <div>
          <p className="example">{text.details}</p>
          <h1>{property?.property_code ?? text.details}</h1>
          {property ? (
            <div className="chips head-chips">
              <span className="badge" data-tone={statusTone(property.status)}>
                {label(locale, property.status)}
              </span>
              <span className="badge badge-plain" data-tone="neutral">
                {label(locale, property.record_review_status)}
              </span>
            </div>
          ) : null}
        </div>
        {property && employee ? (
          <div
            className="detail-actions"
            role="group"
            aria-label={dt.recordActions}
          >
            {employee.role === 'manager' || employee.role === 'admin' ? (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() =>
                  setActionDialog({
                    tool: 'sale',
                    forEmployee: employee,
                    propertyId: property.id,
                  })
                }
              >
                {text.completedSaleTitle}
              </button>
            ) : null}
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() =>
                setActionDialog({
                  tool: 'reservation',
                  forEmployee: employee,
                  propertyId: property.id,
                })
              }
            >
              {text.reservations}
            </button>
            {canOpenEdit ? (
              <button
                className="btn btn-sm btn-ghost"
                type="button"
                onClick={() =>
                  setActionDialog({
                    tool: 'edit',
                    forEmployee: employee,
                    propertyId: property.id,
                  })
                }
              >
                {mt.editFacts}
              </button>
            ) : null}
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() =>
                setActionDialog({
                  tool: 'correction',
                  forEmployee: employee,
                  propertyId: property.id,
                })
              }
            >
              {text.navCorrections}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              type="button"
              onClick={() =>
                setActionDialog({
                  tool: 'requests',
                  forEmployee: employee,
                  propertyId: property.id,
                })
              }
            >
              {dt.myRequests}
            </button>
          </div>
        ) : null}
      </div>

      {busy && !property ? (
        <p className="busy-line" role="status">
          <span className="spinner"></span>
          {text.loading}
        </p>
      ) : null}
      {error ? (
        <div className="state-panel" data-tone="danger" role="alert">
          <span className="state-mark">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </span>
          <h3 className="state-title">
            {['not-found', 'property-not-found'].includes(error)
              ? text.notFound
              : error === 'sign-out-failed'
                ? text.signOutFailed
                : error === 'invalid-input'
                  ? text.invalidInput
                  : text.unavailable}
          </h3>
          <p>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={error === 'sign-out-failed' ? logout : reload}
            >
              {text.retry}
            </button>
          </p>
        </div>
      ) : null}

      <div ref={surface} hidden={!property}>
        {property && data ? (
          <>
            {property.archived_at ? (
              <div className="alert" data-tone="neutral" role="status">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="7" width="18" height="14" rx="2" />
                  <path d="M5 7V5a2 2 0 012-2h10a2 2 0 012 2v2" />
                  <path d="M10 12h4" />
                </svg>
                <span>
                  {text.archived} · {vietnamDate(property.archived_at)}
                </span>
              </div>
            ) : null}

            <div className="detail-body">
              <div>
                <div
                  className="tabs"
                  role="tablist"
                  aria-label={dt.facts}
                  data-od-id="record-tabs"
                >
                  {RECORD_TABS.map((id) => (
                    <button
                      key={id}
                      className="tab"
                      type="button"
                      role="tab"
                      id={'record-tab-' + id}
                      aria-controls={'record-panel-' + id}
                      aria-selected={tab === id}
                      tabIndex={tab === id ? 0 : -1}
                      onClick={() => setTab(id)}
                      onKeyDown={onTabKeyDown}
                    >
                      {id === 'overview'
                        ? dt.tabOverview
                        : id === 'docs'
                          ? dt.tabDocs
                          : dt.tabComments}
                    </button>
                  ))}
                </div>

                <section
                  className="tabpanel"
                  role="tabpanel"
                  id="record-panel-overview"
                  aria-labelledby="record-tab-overview"
                  hidden={tab !== 'overview'}
                >
                  {/* plate hero — record cover */}
                  <div className="panel plate-hero" data-od-id="record-plate">
                    {coverFileId ? (
                      <CoverImage
                        propertyId={id}
                        fileId={coverFileId}
                        locale={locale}
                        onDenied={denyFiles}
                        onInvalidate={recoverChildAfterInvalidation}
                      />
                    ) : (
                      <Plate
                        variant="hero"
                        locale={locale}
                        record={{
                          property_code: property.property_code,
                          frontage_m: property.frontage_m,
                          depth_m: property.depth_m,
                          land_area_m2: property.land_area_m2,
                          floor_area_m2: property.floor_area_m2,
                          floors: property.floors,
                          direction: property.direction,
                          access_type: property.access_type,
                        }}
                      />
                    )}
                  </div>

                  {/* facts */}
                  <div className="panel" data-od-id="panel-facts">
                    <div className="panel-head">
                      <h2>{dt.facts}</h2>
                      <span className="panel-note num">
                        {property.property_code}
                      </span>
                    </div>
                    <div className="panel-body">
                      <dl className="facts">
                        <div className="fact">
                          <dt>{text.listingMode}</dt>
                          <dd
                            className={
                              property.listing_mode ? undefined : 'is-unknown'
                            }
                          >
                            {label(locale, property.listing_mode)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.propertyType}</dt>
                          <dd
                            className={
                              property.property_type ? undefined : 'is-unknown'
                            }
                          >
                            {label(locale, property.property_type)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.accessType}</dt>
                          <dd
                            className={
                              property.access_type ? undefined : 'is-unknown'
                            }
                          >
                            {label(locale, property.access_type)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.status}</dt>
                          <dd>{label(locale, property.status)}</dd>
                        </div>
                        <div className="fact">
                          <dt>{text.reviewStatus}</dt>
                          <dd>
                            {label(locale, property.record_review_status)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.legalStatus}</dt>
                          <dd
                            className={
                              property.legal_status ? undefined : 'is-unknown'
                            }
                          >
                            {label(locale, property.legal_status)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.salePrice}</dt>
                          <dd
                            className={
                              property.sale_price_vnd === null
                                ? 'is-unknown'
                                : 'num'
                            }
                          >
                            {property.sale_price_vnd === null
                              ? text.unknown
                              : formatVnd(property.sale_price_vnd, locale)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.monthlyRent}</dt>
                          <dd
                            className={
                              property.monthly_rent_vnd === null
                                ? 'is-unknown'
                                : 'num'
                            }
                          >
                            {property.monthly_rent_vnd === null
                              ? text.unknown
                              : formatVnd(property.monthly_rent_vnd, locale)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.landArea}</dt>
                          <dd
                            className={
                              property.land_area_m2 === null
                                ? 'is-unknown'
                                : 'num'
                            }
                          >
                            {number(property.land_area_m2, ' m²')}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.floorArea}</dt>
                          <dd
                            className={
                              property.floor_area_m2 === null
                                ? 'is-unknown'
                                : 'num'
                            }
                          >
                            {number(property.floor_area_m2, ' m²')}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.frontage}</dt>
                          <dd
                            className={
                              property.frontage_m === null
                                ? 'is-unknown'
                                : 'num'
                            }
                          >
                            {number(property.frontage_m, ' m')}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.depth}</dt>
                          <dd
                            className={
                              property.depth_m === null ? 'is-unknown' : 'num'
                            }
                          >
                            {number(property.depth_m, ' m')}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.floors}</dt>
                          <dd
                            className={
                              property.floors === null ? 'is-unknown' : 'num'
                            }
                          >
                            {number(property.floors)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.bedrooms}</dt>
                          <dd
                            className={
                              property.bedrooms === null ? 'is-unknown' : 'num'
                            }
                          >
                            {number(property.bedrooms)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.bathrooms}</dt>
                          <dd
                            className={
                              property.bathrooms === null ? 'is-unknown' : 'num'
                            }
                          >
                            {number(property.bathrooms)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.direction}</dt>
                          <dd
                            className={
                              !property.direction ? 'is-unknown' : undefined
                            }
                          >
                            {label(
                              locale,
                              property.direction
                                ? directionKeys[property.direction]
                                : null,
                            )}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.updated}</dt>
                          <dd className="num">
                            {vietnamDate(property.updated_at)}
                          </dd>
                        </div>
                      </dl>
                      <p className="field-hint">{text.legalNote}</p>
                    </div>
                  </div>

                  {/* recorded asking-price series */}
                  <PriceHistory
                    key={
                      'prices' + property.id + property.revision + refreshTick
                    }
                    propertyId={property.id}
                    locale={locale}
                    onInvalidate={recoverChildAfterInvalidation}
                  />

                  {/* addresses */}
                  <div className="panel" data-od-id="panel-addresses">
                    <div className="panel-head">
                      <h2>{dt.addresses}</h2>
                    </div>
                    <div className="panel-body">
                      {data.addresses.length ? (
                        data.addresses.map((address) => (
                          <div className="record" key={address.id}>
                            <div className="record-head">
                              <span className="record-title">
                                {label(locale, address.format)}
                              </span>
                              <span
                                className="badge"
                                data-tone={mappingTone(address.mapping_status)}
                              >
                                {label(locale, address.mapping_status)}
                              </span>
                            </div>
                            <p className="record-body" translate="no">
                              {address.address_text}
                            </p>
                            <p className="record-meta">
                              {vietnamDate(address.effective_on) ??
                                text.unknown}{' '}
                              · {address.verified_by ?? text.unknown}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p>{dt.noAddresses}</p>
                      )}
                      {!data.addresses.some(
                        (address) => address.format === 'current',
                      ) ? (
                        <p className="field-hint">{text.noCurrent}</p>
                      ) : null}
                      <p className="field-hint">{dt.addrNote}</p>
                    </div>
                  </div>

                  {/* contacts */}
                  <div className="panel" data-od-id="panel-contacts">
                    <div className="panel-head">
                      <h2>{dt.contacts}</h2>
                    </div>
                    <div className="panel-body">
                      {contacts.length ? (
                        contacts.map((row) => (
                          <div className="record" key={row.id}>
                            <div className="record-head">
                              <span className="record-title" translate="no">
                                {row.name ?? text.unknown}
                              </span>
                              <span
                                className="badge"
                                data-tone={
                                  row.relation === 'owner'
                                    ? 'accent'
                                    : 'neutral'
                                }
                              >
                                {row.relation === 'owner'
                                  ? dt.owner
                                  : row.relation === 'broker' ||
                                      row.relation === 'agent'
                                    ? dt.agent
                                    : row.relation === 'representative'
                                      ? dt.representative
                                      : label(locale, row.relation)}
                              </span>
                              {row.isPrimary ? (
                                <span
                                  className="badge badge-plain"
                                  data-tone="neutral"
                                >
                                  {dt.primary}
                                </span>
                              ) : null}
                            </div>
                            {row.phone.show ? (
                              <p className="record-body num" translate="no">
                                {row.phone.text ?? text.unknown}
                              </p>
                            ) : null}
                            <p className="record-meta">
                              {row.isPrimary
                                ? dt.contactConsent
                                : dt.contactSource}
                            </p>
                          </div>
                        ))
                      ) : (
                        <p>{dt.noContacts}</p>
                      )}

                      {/* owner-contact disclosure (#56) */}
                      <div className="owner-disclosure">
                        <div className="record-head">
                          <span className="record-title">{dt.owner}</span>
                        </div>
                        {ownerContact ? (
                          ownerContact.contact ? (
                            <>
                              <div className="record-body">
                                <p translate="no">
                                  {ownerContact.contact.displayName}
                                </p>
                                <p className="owner-phone" translate="no">
                                  {ownerContact.contact.phone}
                                </p>
                              </div>
                              <div className="record-meta">
                                {dial ? (
                                  <a
                                    className="btn btn-sm btn-primary"
                                    href={'tel:' + dial}
                                  >
                                    <span className="btn-label">
                                      {text.call}
                                    </span>
                                  </a>
                                ) : (
                                  <span className="field-hint">
                                    {text.callUnavailable}
                                  </span>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="field-hint">
                              {text.ownerContactUnavailable}
                            </p>
                          )
                        ) : (
                          <>
                            {disclosureError ? (
                              <div
                                className="alert"
                                data-tone="danger"
                                role="alert"
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  strokeLinecap="round"
                                  aria-hidden="true"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <path d="M12 8v4M12 16h.01" />
                                </svg>
                                <span>{disclosureMessage}</span>
                              </div>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
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
                        <p className="field-hint">{text.ownerContactNote}</p>
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  className="tabpanel"
                  role="tabpanel"
                  id="record-panel-docs"
                  aria-labelledby="record-tab-docs"
                  hidden={tab !== 'docs'}
                >
                  <Workspace
                    key={`${id}:${employeeId}`}
                    propertyId={id}
                    locale={locale}
                    employeeId={employeeId ?? null}
                    archived={!!property.archived_at}
                    onDenied={denyFiles}
                    onInvalidate={recoverChildAfterInvalidation}
                    canEdit={canEdit}
                    coverFileId={coverFileId}
                    onCoverChanged={reload}
                  />
                </section>

                <section
                  className="tabpanel"
                  role="tabpanel"
                  id="record-panel-comments"
                  aria-labelledby="record-tab-comments"
                  hidden={tab !== 'comments'}
                >
                  <Discussion
                    key={property.id}
                    propertyId={property.id}
                    locale={locale}
                    archived={!!property.archived_at}
                    employeeId={employeeId ?? null}
                    reviewer={
                      employee?.role === 'manager' || employee?.role === 'admin'
                    }
                    onDenied={denyFiles}
                    onInvalidate={recoverChildAfterInvalidation}
                  />
                </section>
              </div>

              <aside className="detail-rail">
                <section
                  className="panel contact-card"
                  aria-labelledby="detail-contacts"
                >
                  <div className="panel-head">
                    <h2 id="detail-contacts">{dt.contacts}</h2>
                  </div>
                  <div className="panel-body">
                    {contacts.length ? (
                      <div className="contact-card-list">
                        {contacts.map((row) => (
                          <article className="contact-card-item" key={row.id}>
                            <div className="record-head">
                              <strong className="record-title" translate="no">
                                {row.name ?? text.unknown}
                              </strong>
                              <span
                                className="badge badge-plain"
                                data-tone={
                                  row.relation === 'owner'
                                    ? 'accent'
                                    : 'neutral'
                                }
                              >
                                {row.relation === 'owner'
                                  ? dt.owner
                                  : row.relation === 'broker' ||
                                      row.relation === 'agent'
                                    ? dt.agent
                                    : row.relation === 'representative'
                                      ? dt.representative
                                      : label(locale, row.relation)}
                              </span>
                            </div>
                            {row.phone.show ? (
                              <p className="record-body num" translate="no">
                                {row.phone.text ?? text.unknown}
                              </p>
                            ) : null}
                            {row.isPrimary ? (
                              <p className="record-meta">{dt.primary}</p>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    ) : (
                      <p>{dt.noContacts}</p>
                    )}
                    <p className="field-hint">{text.ownerContactNote}</p>
                  </div>
                </section>

                {employee ? (
                  <>
                    <History
                      key={
                        'history' +
                        property.id +
                        property.revision +
                        refreshTick
                      }
                      propertyId={property.id}
                      locale={locale}
                      onInvalidate={recoverChildAfterInvalidation}
                    />
                  </>
                ) : null}

                <p className="field-hint">{text.pageViewNote}</p>

                {viewError ? (
                  <div className="alert" data-tone="danger" role="alert">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 8v4M12 16h.01" />
                    </svg>
                    <span>{text.pageViewFailed}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={reload}
                    >
                      {text.retry}
                    </button>
                  </div>
                ) : null}

                <section className="panel" aria-labelledby="today-activity">
                  <div className="panel-head">
                    <h2 id="today-activity">{text.todayActivity}</h2>
                  </div>
                  <div className="panel-body">
                    {todayError ? (
                      <div className="alert" data-tone="danger" role="alert">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 8v4M12 16h.01" />
                        </svg>
                        <span>{text.todayActivityFailed}</span>
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={reload}
                        >
                          {text.retry}
                        </button>
                      </div>
                    ) : today ? (
                      <dl className="facts">
                        <div className="fact">
                          <dt>{text.todayDay}</dt>
                          <dd className="num">
                            {vietnamDate(today.businessDay)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.todayPageViews}</dt>
                          <dd className="num">
                            {numberFormat.format(today.pageViewEvents)}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.todayProperties}</dt>
                          <dd className="num">
                            {numberFormat.format(
                              today.distinctPropertiesViewed,
                            )}
                          </dd>
                        </div>
                        <div className="fact">
                          <dt>{text.todayOwnerContacts}</dt>
                          <dd className="num">
                            {numberFormat.format(today.ownerContactProperties)}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p role="status">{text.loading}</p>
                    )}
                  </div>
                </section>
              </aside>
            </div>

            {employee ? (
              <>
                {employee.role === 'manager' || employee.role === 'admin' ? (
                  <DetailActionDialog
                    open={activeActionDialog === 'sale'}
                    onClose={() => setActionDialog(null)}
                    title={text.completedSaleTitle}
                    closeLabel={text.close}
                  >
                    <SaleCompletion
                      key={'sale' + property.id}
                      propertyId={property.id}
                      locale={locale}
                      employeeId={employee.id}
                      onDenied={denyFiles}
                      onInvalidate={recoverChildAfterInvalidation}
                      onSaved={changed}
                    />
                  </DetailActionDialog>
                ) : null}
                <DetailActionDialog
                  open={activeActionDialog === 'reservation'}
                  onClose={() => setActionDialog(null)}
                  title={text.reservations}
                  size="default"
                  closeLabel={text.close}
                >
                  <Reservation
                    key={'reservation' + property.id + refreshTick}
                    propertyId={property.id}
                    locale={locale}
                    status={property.status}
                    archived={!!property.archived_at}
                    employeeId={employee.id}
                    onDenied={denyFiles}
                    onInvalidate={recoverChildAfterInvalidation}
                  />
                </DetailActionDialog>
                <DetailActionDialog
                  open={activeActionDialog === 'edit'}
                  onClose={() => setActionDialog(null)}
                  title={mt.editFacts}
                  closeLabel={text.close}
                >
                  <Maintenance
                    key={'maintenance' + property.id}
                    detail={data}
                    employee={employee}
                    locale={locale}
                    onSaved={changed}
                    onDenied={denyFiles}
                    onInvalidate={recoverChildAfterInvalidation}
                  />
                </DetailActionDialog>
                <DetailActionDialog
                  open={activeActionDialog === 'correction'}
                  onClose={() => setActionDialog(null)}
                  title={text.navCorrections}
                  closeLabel={text.close}
                >
                  <CorrectionReport
                    key={'correction' + property.id}
                    detail={data}
                    locale={locale}
                    role={employee.role}
                    onDenied={denyFiles}
                    onInvalidate={recoverChildAfterInvalidation}
                    onSaved={changed}
                  />
                </DetailActionDialog>
                <DetailActionDialog
                  open={activeActionDialog === 'requests'}
                  onClose={() => setActionDialog(null)}
                  title={mt.queue}
                  closeLabel={text.close}
                >
                  <CorrectionQueue
                    key={'requests' + property.id + refreshTick}
                    propertyId={property.id}
                    locale={locale}
                    onDenied={denyFiles}
                    onChanged={() => void changed()}
                    onInvalidate={recoverChildAfterInvalidation}
                  />
                </DetailActionDialog>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
