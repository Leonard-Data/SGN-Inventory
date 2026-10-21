'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Link from 'next/link';
import { label, messages, type Locale } from '@/i18n/messages';
import { useProtectedData } from '@/features/employees/use-protected-data';
import { LoadingSkeleton, Skeleton } from '@/features/skeleton';
import { RequestError } from '@/features/employees/api';
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
import { crosswalkMessage } from '@/features/property-maintenance/crosswalk';
import { History } from '@/features/property-maintenance/history';
import { PriceHistory } from '@/features/property-maintenance/price-history';
import { StatusControl, StatusTrail } from '@/features/property-status/status';
import { statusText } from '@/features/property-status/messages';
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
import { PropertyLocation } from './location';
import { DetailActionDialog } from './detail-dialog';
import { SharedAddress } from './duplicates';
import { contactRows } from './contact-rows';
import { AddContactNumber } from './add-contact-number';
import { mayLinkPropertyVendors } from '@/features/vendors/directory';
import { mayEditProperty } from './edit-permission';
import { PropertyVendors } from '@/features/vendors/property-vendors';
// The record screen groups its content the way the design package does: the record's own
// facts, its documents and its discussion.
const RECORD_TABS = ['overview', 'docs', 'comments'] as const;
type RecordTab = (typeof RECORD_TABS)[number];
type RecordAction = {
  id: 'sale' | 'reservation' | 'edit' | 'correction' | 'requests' | 'status';
  label: string;
};

// The record toolbar is one menu, not a row of buttons. The trigger keeps
// aria-haspopup/aria-expanded, the items are a roving menu, Escape closes and returns
// focus to the trigger, and an outside pointer press closes without stealing focus.
function RecordActionsMenu({
  label,
  items,
  onPick,
}: {
  label: string;
  items: RecordAction[];
  onPick: (id: RecordAction['id']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLButtonElement>('button');
    first?.focus();
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);
  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const buttons = [...(menu.current?.querySelectorAll('button') ?? [])];
    if (!buttons.length) return;
    const focusedIndex = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    const index = focusedIndex >= 0 ? focusedIndex : activeIndex;
    const nextIndex =
      event.key === 'ArrowDown'
        ? (index + 1) % buttons.length
        : event.key === 'ArrowUp'
          ? (index - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : null;
    if (nextIndex === null) return;
    event.preventDefault();
    setActiveIndex(nextIndex);
    buttons[nextIndex]?.focus();
  }
  return (
    <div className="detail-actions" ref={root}>
      <button
        ref={trigger}
        className="btn btn-sm btn-secondary"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(0);
          setOpen(open ? false : true);
        }}
      >
        {label}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          className="actions-menu"
          role="menu"
          aria-label={label}
          ref={menu}
          onKeyDown={onMenuKeyDown}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setOpen(false);
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={index === activeIndex ? 0 : -1}
              className="actions-menu-item"
              onFocus={() => setActiveIndex(index)}
              onClick={() => {
                setOpen(false);
                onPick(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  const { employee, data, error, busy, surface, logout, clear, reload } =
    useProtectedData(loadDetail);
  // The server layout and page both derive this from the sgn-locale cookie, which
  // set_my_locale, login and the request proxy keep equal to the saved preference, so
  // a language switch re-renders the body instead of leaving it on the fetched value.
  const locale = initialLocale;
  const text = messages[locale];
  const [tab, setTab] = useState<RecordTab>('overview');
  const [actionDialog, setActionDialog] = useState<
    | 'sale'
    | 'reservation'
    | 'edit'
    | 'correction'
    | 'requests'
    | 'status'
    | null
  >(null);
  // Roving tabindex: the arrow keys move both focus and selection across the three tabs.
  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
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
  // A committed save closes the dialog it was recorded from, so the confirmation follows the
  // person onto the record instead of staying inside the surface they are leaving.
  async function savedAndClosed() {
    setActionDialog(null);
    await changed();
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
      // A committed credit re-reads today's report through the same abortable load, so the
      // post-credit read always wins over an in-flight pre-credit one.
      if (result.credited) setCreditTick((value) => value + 1);
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
  }, [data, id, clear, creditTick]);
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
  const property = data?.property;
  const canEdit = mayEditProperty(employee, {
    createdBy: property?.created_by ?? null,
    archived: !!property?.archived_at,
  });
  useEffect(() => {
    if (canEdit && window.location.hash === '#edit-property') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- an authorized quick-view edit link opens the existing editor
      setActionDialog('edit');
    }
  }, [canEdit]);
  const coverFileId = property?.cover_file_id ?? null;
  const canLinkVendor =
    !!employee &&
    !!property &&
    !property.archived_at &&
    mayLinkPropertyVendors(employee.role);
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
  const st = statusText(locale);
  return (
    <div lang={locale}>
      <p>
        <Link className="link-quiet" href={returnTo} prefetch={false}>
          {dt.back}
        </Link>
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
          <RecordActionsMenu
            label={dt.recordActions}
            onPick={setActionDialog}
            items={[
              ...(employee.role === 'manager' || employee.role === 'admin'
                ? [
                    {
                      id: 'sale' as const,
                      label: text.completedSaleTitle,
                    },
                  ]
                : []),
              { id: 'status' as const, label: st.changeStatus },
              { id: 'reservation' as const, label: text.reservations },
              { id: 'edit' as const, label: mt.editFacts },
              { id: 'correction' as const, label: text.navCorrections },
              { id: 'requests' as const, label: dt.myRequests },
            ]}
          />
        ) : null}
      </div>

      {busy && !property ? (
        <LoadingSkeleton label={text.loading}>
          <div className="detail-body">
            <div className="skeleton-stack">
              <Skeleton className="sk-plate" />
              <Skeleton h={240} />
            </div>
            <div className="skeleton-stack">
              <Skeleton h={150} />
              <Skeleton h={120} />
            </div>
          </div>
        </LoadingSkeleton>
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
            {error === 'not-found'
              ? text.notFound
              : error === 'sign-out-failed'
                ? text.signOutFailed
                : error === 'invalid-input'
                  ? text.invalidInput
                  : error === 'access-changed'
                    ? text.accessChanged
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
                        {data.creatorName ? (
                          <div className="fact">
                            <dt>{text.createdBy}</dt>
                            <dd translate="no">{data.creatorName}</dd>
                          </div>
                        ) : null}
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
                  />

                  {/* recorded status changes, separate from the price series */}
                  <StatusTrail
                    key={
                      'status' + property.id + property.revision + refreshTick
                    }
                    propertyId={property.id}
                    locale={locale}
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
                            {/* The hierarchy the address was recorded in, in the catalog's own
                                names, beside the untouched source text. */}
                            {address.hierarchy ? (
                              <p className="record-meta" translate="no">
                                {address.hierarchy}
                              </p>
                            ) : null}
                            {address.crosswalk ? (
                              <p className="field-hint">
                                {crosswalkMessage(locale, address.crosswalk)}
                              </p>
                            ) : null}
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
                      {/* A shared address is stated here; the comparison and the deliberate
                          merge live behind it. */}
                      <SharedAddress
                        key={
                          'shared' +
                          property.id +
                          property.revision +
                          refreshTick
                        }
                        propertyId={property.id}
                        locale={locale}
                        canMerge={
                          employee?.role === 'manager' ||
                          employee?.role === 'admin'
                        }
                        onDenied={denyFiles}
                        onMerged={changed}
                      />
                    </div>
                  </div>

                  {/* location */}
                  <div className="panel" data-od-id="panel-location">
                    <div className="panel-head">
                      <h2>{dt.location}</h2>
                    </div>
                    <div className="panel-body">
                      <PropertyLocation
                        key={
                          'location' +
                          property.id +
                          property.revision +
                          refreshTick
                        }
                        latitude={property.latitude}
                        longitude={property.longitude}
                        locale={locale}
                      />
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

                      {/* Recording a number is not a property-fact edit: any active employee
                          may add one to an unarchived record, and the newest shows first. */}
                      {employee && !property.archived_at ? (
                        <AddContactNumber
                          propertyId={property.id}
                          locale={locale}
                          onAdded={changed}
                          onDenied={denyFiles}
                        />
                      ) : null}

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

                  {/* vendors: supplier companies, separate from owners and brokers */}
                  <PropertyVendors
                    key={
                      'vendors' + property.id + property.revision + refreshTick
                    }
                    propertyId={property.id}
                    propertyRevision={property.revision}
                    canLink={canLinkVendor}
                    locale={locale}
                    onChanged={changed}
                    onDenied={denyFiles}
                  />
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
                  />
                </section>
              </div>

              <aside className="detail-rail">
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
                      <LoadingSkeleton
                        label={text.loading}
                        shape="table"
                        rows={4}
                        columns={2}
                      />
                    )}
                  </div>
                </section>
              </aside>
            </div>

            {employee ? (
              <>
                {employee.role === 'manager' || employee.role === 'admin' ? (
                  <DetailActionDialog
                    open={actionDialog === 'sale'}
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
                      onSaved={savedAndClosed}
                    />
                  </DetailActionDialog>
                ) : null}
                <DetailActionDialog
                  open={actionDialog === 'status'}
                  onClose={() => setActionDialog(null)}
                  title={st.changeStatus}
                  closeLabel={text.close}
                >
                  <StatusControl
                    key={'status' + property.id}
                    propertyId={property.id}
                    status={property.status}
                    locale={locale}
                    onDenied={denyFiles}
                    onChanged={() => void savedAndClosed()}
                  />
                </DetailActionDialog>
                <DetailActionDialog
                  open={actionDialog === 'reservation'}
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
                    onCommitted={() => void savedAndClosed()}
                  />
                </DetailActionDialog>
                <DetailActionDialog
                  open={actionDialog === 'edit'}
                  onClose={() => setActionDialog(null)}
                  title={mt.editFacts}
                  closeLabel={text.close}
                >
                  <Maintenance
                    key={'maintenance' + property.id}
                    detail={data}
                    employee={employee}
                    locale={locale}
                    onSaved={savedAndClosed}
                    onRefresh={changed}
                    onDenied={denyFiles}
                  />
                </DetailActionDialog>
                <DetailActionDialog
                  open={actionDialog === 'correction'}
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
                    onSaved={savedAndClosed}
                  />
                </DetailActionDialog>
                <DetailActionDialog
                  open={actionDialog === 'requests'}
                  onClose={() => setActionDialog(null)}
                  title={mt.queue}
                  closeLabel={text.close}
                >
                  <CorrectionQueue
                    key={'requests' + property.id + refreshTick}
                    propertyId={property.id}
                    locale={locale}
                    onDenied={denyFiles}
                    onChanged={() => void savedAndClosed()}
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
