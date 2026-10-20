'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/messages';
import { label, messages } from '@/i18n/messages';
import { formatDecimal, formatVnd } from './format';
import { api, RequestError } from '@/features/employees/api';
import { contactName } from '@/features/contacts/directory';
import { ContactPicker } from '@/features/property-maintenance/contact-picker';
import {
  unitOptionLabels,
  type UnitOption,
} from '@/features/property-maintenance/units';
import {
  INVENTORY_FILTER_KEYS,
  INVENTORY_LISTING_MODES,
  INVENTORY_PROPERTY_TYPES,
  INVENTORY_STATUSES,
  noInventoryFilters,
  parseInventoryFilters,
  squareMetres,
  wholeVnd,
  type InventoryFilterKey,
  type InventoryFilters,
} from './filters';
import { inventoryHref, type InventoryView } from './view';
import { isInventoryOrder } from './stream';
import { resultMode } from './catalogue-results';

// The official catalog rows the province/ward pickers read. Names are source data and are never
// translated, so a language switch keeps the same unit name.
type AdminUnit = UnitOption & { id: string };

// The search island: the same inventory filters in a compact panel opened from the list. It is
// an addition to the free-text search box, not a replacement, and it applies filters by
// navigating to the filtered address, so the address stays the single source of truth and the
// results stay the read's.
export function SearchIsland({
  locale,
  query,
  sort,
  view,
  filters,
  open,
  onOpen,
  onDenied,
}: {
  locale: Locale;
  query: string;
  sort: string | null;
  // The view the address states: applying or removing a filter keeps the person's chosen view.
  view: InventoryView;
  filters: InventoryFilters;
  open: boolean;
  onOpen: (open: boolean) => void;
  onDenied: (status: number) => void;
}) {
  const router = useRouter();
  const text = messages[locale];
  const appliedMode = filters.mode ?? '';
  const appliedProvince = filters.province ?? '';
  const appliedWard = filters.ward ?? '';
  const appliedContact = filters.contact ?? '';
  // The stated ordering, when the address carries one. A chronological ordering is an advanced
  // criterion: it names the eligible-status database view, which the loaded catalogue cannot
  // state, so it is submitted from this panel rather than run as soon as a control changes.
  const appliedOrder = isInventoryOrder(sort) ? sort : '';
  const appliedStateKey = JSON.stringify([
    query,
    sort,
    ...INVENTORY_FILTER_KEYS.map((key) => filters[key]),
  ]);
  const [invalid, setInvalid] = useState(false);
  const [mode, setMode] = useState(appliedMode);
  const [order, setOrder] = useState(appliedOrder);
  // The dialog's live province selection drives the dependent ward list; applying or dismissing
  // returns both to the filter set the address currently states. The contact selection is the
  // same shape: it starts at the applied value and returns to it on dismiss.
  const [province, setProvince] = useState(appliedProvince);
  const [ward, setWard] = useState(appliedWard);
  const [contact, setContact] = useState(appliedContact);
  const [contactLabel, setContactLabel] = useState<string | null>(null);
  const [provinces, setProvinces] = useState<AdminUnit[]>([]);
  const [wards, setWards] = useState<AdminUnit[]>([]);
  const [provinceFailed, setProvinceFailed] = useState(false);
  const [wardFailed, setWardFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  function dismiss() {
    onOpen(false);
    setInvalid(false);
    setMode(appliedMode);
    setOrder(appliedOrder);
    setProvince(appliedProvince);
    setWard(appliedWard);
    setContact(appliedContact);
  }
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // The panel opens on its first control so a keyboard user lands inside it.
      dialog.querySelector<HTMLElement>('[data-filter-first]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    setMode(appliedMode);
    setOrder(appliedOrder);
    setInvalid(false);
    setProvince(appliedProvince);
    setWard(appliedWard);
    setContact(appliedContact);
  }, [
    appliedMode,
    appliedOrder,
    appliedProvince,
    appliedWard,
    appliedContact,
    appliedStateKey,
  ]);
  // The catalog is the same official list the address form reads. A denial clears the protected
  // surface through the handler the inventory list already uses.
  useEffect(() => {
    const abort = new AbortController();
    void api<{ units: AdminUnit[] }>(
      '/api/admin-units?' + new URLSearchParams({ level: 'province' }),
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setProvinces(result.units);
        setProvinceFailed(false);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        )
          onDenied(failure.status);
        else setProvinceFailed(true);
      });
    return () => abort.abort();
  }, [onDenied]);
  useEffect(() => {
    setWards([]);
    setWardFailed(false);
    if (!province) return;
    const abort = new AbortController();
    void api<{ units: AdminUnit[] }>(
      '/api/admin-units?' +
        new URLSearchParams({ level: 'commune', parent: province }),
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setWards(result.units);
        setWardFailed(false);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        )
          onDenied(failure.status);
        else setWardFailed(true);
      });
    return () => abort.abort();
  }, [province, onDenied]);
  // The contact filter lists only identities the caller may read, through the bounded name
  // search and paging the property maintenance picker already uses: a page at a time on
  // request, never a walk over the whole directory. The applied filter's label is the one
  // bounded name-only read below, so a reloaded or shared address still names the person even
  // when the guarded affected-property detail would refuse.
  useEffect(() => {
    setContactLabel(null);
    if (!appliedContact) return;
    const abort = new AbortController();
    void api<unknown>(
      '/api/contacts/' + appliedContact + '/name',
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        try {
          setContactLabel(contactName(result));
        } catch {
          setContactLabel(null);
        }
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        // A genuine miss keeps the neutral label; only a lost session or membership clears the
        // protected surface.
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        )
          onDenied(failure.status);
      });
    return () => abort.abort();
  }, [appliedContact, onDenied]);
  // Applying starts the stream over with the stated filters, so a window of the previous result
  // set can never be replayed against this one.
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget))
      if (typeof value === 'string') submitted.set(key, value);
    const parsed = parseInventoryFilters(submitted);
    if (!parsed.ok) {
      setInvalid(true);
      return;
    }
    dismiss();
    router.push(
      inventoryHref({
        query,
        sort: isInventoryOrder(order) ? order : null,
        view,
        filters: parsed.filters,
      }),
    );
  }
  const vnd = (value: string) =>
    wholeVnd(value) ? formatVnd(value, locale) : value;
  const m2 = (value: string) =>
    squareMetres(value) ? `${formatDecimal(value, locale)} m²` : value;
  const priceLabel = (selectedMode: string | null, range: 'from' | 'to') => {
    if (selectedMode === 'rent')
      return range === 'from' ? text.rentPriceFrom : text.rentPriceTo;
    if (selectedMode)
      return range === 'from' ? text.salePriceFrom : text.salePriceTo;
    return range === 'from' ? text.priceRangeFrom : text.priceRangeTo;
  };
  const priceUnits = (selectedMode: string | null) =>
    selectedMode === 'rent'
      ? [text.priceUnitMonthly]
      : selectedMode
        ? [text.priceUnitVnd]
        : [text.priceUnitVnd, text.priceUnitMonthly];
  // Whether this run reads the database, judged by the same function the list uses on the address it
  // is handed: a run carries the address's submitted query and the draft's own criteria, so the
  // action and its hint can never promise a local filter the run does not answer locally. Asking
  // here is still only asking, so an edit runs nothing until the panel is run.
  const advancedDraft =
    resultMode({
      query,
      filters: {
        ...noInventoryFilters,
        province: province || null,
        ward: ward || null,
        contact: contact || null,
      },
      sort: order || null,
    }) === 'advanced';
  // The current filter set stays visible as removable chips, and each chip removes exactly its
  // own condition, so the address is still the only place a filter lives.
  const applied: { key: InventoryFilterKey; label: string }[] = [];
  if (filters.status)
    applied.push({
      key: 'status',
      label: `${text.status}: ${label(locale, filters.status)}`,
    });
  if (filters.mode)
    applied.push({
      key: 'mode',
      label: `${text.listingMode}: ${label(locale, filters.mode)}`,
    });
  if (filters.type)
    applied.push({
      key: 'type',
      label: `${text.propertyType}: ${label(locale, filters.type)}`,
    });
  const unitName = (units: readonly AdminUnit[], id: string) =>
    units.find((unit) => unit.id === id)?.name_vi ?? id;
  if (filters.province)
    applied.push({
      key: 'province',
      label: `${text.province}: ${unitName(provinces, filters.province)}`,
    });
  if (filters.ward)
    applied.push({
      key: 'ward',
      label: `${text.ward}: ${unitName(wards, filters.ward)}`,
    });
  if (filters.contact)
    applied.push({
      key: 'contact',
      label: `${text.contactFilter}: ${contactLabel ?? text.unknown}`,
    });
  if (filters.priceMin)
    applied.push({
      key: 'priceMin',
      label: `${priceLabel(filters.mode, 'from')}: ${vnd(filters.priceMin)}`,
    });
  if (filters.priceMax)
    applied.push({
      key: 'priceMax',
      label: `${priceLabel(filters.mode, 'to')}: ${vnd(filters.priceMax)}`,
    });
  if (filters.areaMin)
    applied.push({
      key: 'areaMin',
      label: `${text.areaRangeFrom}: ${m2(filters.areaMin)}`,
    });
  if (filters.areaMax)
    applied.push({
      key: 'areaMax',
      label: `${text.areaRangeTo}: ${m2(filters.areaMax)}`,
    });
  function remove(key: InventoryFilterKey) {
    // The ward narrows its province, so removing the province removes the dependent ward too.
    const next =
      key === 'province'
        ? { ...filters, province: null, ward: null }
        : { ...filters, [key]: null };
    router.push(inventoryHref({ query, sort, view, filters: next }));
  }
  const clearHref = inventoryHref({
    query,
    sort,
    view,
    filters: noInventoryFilters,
  });
  const provinceLabels = unitOptionLabels(provinces);
  const wardLabels = unitOptionLabels(wards);
  const select = (
    name: keyof InventoryFilters,
    heading: string,
    options: readonly string[],
    first = false,
  ) => {
    const isMode = name === 'mode';
    return (
      <div className="field" key={`${name}=${filters[name] ?? ''}`}>
        <label className="field-label" htmlFor={'filter-' + name}>
          {heading}
        </label>
        <select
          id={'filter-' + name}
          className="select"
          name={name}
          value={isMode ? mode : undefined}
          defaultValue={isMode ? undefined : (filters[name] ?? '')}
          onChange={
            isMode ? (event) => setMode(event.currentTarget.value) : undefined
          }
          data-filter-first={first ? '' : undefined}
        >
          <option value="">{text.filtersAny}</option>
          {options.map((value) => (
            <option key={value} value={value}>
              {label(locale, value)}
            </option>
          ))}
        </select>
      </div>
    );
  };
  // A field is keyed by its applied value so a soft navigation that changes the address
  // rebuilds the control with the filter set the address now states.
  const bound = (
    name: keyof InventoryFilters,
    heading: string,
    units: readonly string[],
  ) => (
    <div className="field" key={`${name}=${filters[name] ?? ''}`}>
      <label className="field-label" htmlFor={'filter-' + name}>
        {heading}
      </label>
      <span className="field-unit">
        <input
          className="input"
          id={'filter-' + name}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          defaultValue={filters[name] ?? ''}
          aria-invalid={invalid}
          aria-label={`${heading}, ${units.join(', ')}`}
        />
        <span className="field-unit-label" aria-hidden="true">
          {units.map((unit) => (
            <span key={unit}>{unit}</span>
          ))}
        </span>
      </span>
    </div>
  );
  return (
    <>
      {applied.length ? (
        <div className="chips">
          <Link className="link" href={clearHref} prefetch={false}>
            {text.filtersClear}
          </Link>
          {applied.map((condition) => (
            <span className="chip" key={condition.key}>
              {condition.label}
              <button
                type="button"
                onClick={() => remove(condition.key)}
                aria-label={`${text.filtersRemove}: ${condition.label}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <dialog
        id="inventory-filters"
        ref={dialogRef}
        className="sgn-dialog"
        aria-labelledby="inventory-filters-title"
        onClose={dismiss}
        onCancel={dismiss}
      >
        <form
          key={`${open}:${appliedStateKey}`}
          className="sgn-dialog-panel"
          method="get"
          action="/properties"
          onSubmit={apply}
        >
          <div className="sgn-dialog-head">
            <h2 id="inventory-filters-title">{text.filters}</h2>
            <button
              className="sgn-dialog-close"
              type="button"
              onClick={dismiss}
              aria-label={text.close}
            >
              ×
            </button>
          </div>
          <div className="sgn-dialog-body">
            {/* The two groups are what the local/advanced split means at the controls: the first
                group names filters the loaded catalogue answers, the second criteria it has no
                field for. The hint under the first states which of the two actually answers the
                run: a whole-inventory criterion anywhere in the panel, or a submitted address
                search, makes the run one database read that applies both groups. */}
            <div className="form-section">
              <div className="form-section-head">
                <h3>{text.catalogueFiltersHeading}</h3>
              </div>
              <div className="form-grid-3">
                {select('status', text.status, INVENTORY_STATUSES, true)}
                {select('mode', text.listingMode, INVENTORY_LISTING_MODES)}
                {select('type', text.propertyType, INVENTORY_PROPERTY_TYPES)}
              </div>
              <div className="filter-range">
                <div className="form-grid">
                  {bound(
                    'priceMin',
                    priceLabel(mode, 'from'),
                    priceUnits(mode),
                  )}
                  {bound('priceMax', priceLabel(mode, 'to'), priceUnits(mode))}
                </div>
                <p className="field-hint">{text.priceFilterHint}</p>
              </div>
              <div className="filter-range">
                <div className="form-grid">
                  {bound('areaMin', text.areaRangeFrom, ['m²'])}
                  {bound('areaMax', text.areaRangeTo, ['m²'])}
                </div>
                <p className="field-hint">{text.areaFilterHint}</p>
              </div>
              <p className="field-hint">
                {advancedDraft
                  ? text.catalogueFiltersAdvancedHint
                  : text.catalogueFiltersHint}
              </p>
            </div>
            <div className="form-section">
              <div className="form-section-head">
                <h3>{text.advancedSearchHeading}</h3>
              </div>
              <div className="form-grid">
                <ContactPicker
                  locale={locale}
                  selected={contact}
                  selectedName={
                    contact === appliedContact ? contactLabel : null
                  }
                  onSelected={setContact}
                  onDenied={onDenied}
                />
              </div>
              <input type="hidden" name="contact" value={contact} />
              <p className="field-hint">{text.contactFilterHint}</p>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" htmlFor="filter-province">
                    {text.province}
                  </label>
                  <select
                    id="filter-province"
                    className="select"
                    name="province"
                    value={province}
                    onChange={(event) => {
                      setProvince(event.currentTarget.value);
                      setWard('');
                    }}
                  >
                    <option value="">{text.filtersAny}</option>
                    {province &&
                    !provinces.some((unit) => unit.id === province) ? (
                      <option value={province}>{province}</option>
                    ) : null}
                    {provinces.map((unit, index) => (
                      <option key={unit.id} value={unit.id}>
                        {provinceLabels[index]}
                      </option>
                    ))}
                  </select>
                </div>
                {province ? (
                  <div className="field">
                    <label className="field-label" htmlFor="filter-ward">
                      {text.ward}
                    </label>
                    <select
                      id="filter-ward"
                      className="select"
                      name="ward"
                      value={ward}
                      onChange={(event) => setWard(event.currentTarget.value)}
                    >
                      <option value="">{text.filtersAny}</option>
                      {ward && !wards.some((unit) => unit.id === ward) ? (
                        <option value={ward}>{ward}</option>
                      ) : null}
                      {wards.map((unit, index) => (
                        <option key={unit.id} value={unit.id}>
                          {wardLabels[index]}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </div>
              <p className="field-hint">{text.areaAdminHint}</p>
              {provinceFailed || wardFailed ? (
                <p className="field-error" role="alert">
                  {text.areaFilterUnavailable}
                </p>
              ) : null}
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" htmlFor="filter-sort">
                    {text.sortLabel}
                  </label>
                  <select
                    id="filter-sort"
                    className="select"
                    name="sort"
                    value={order}
                    onChange={(event) => setOrder(event.currentTarget.value)}
                  >
                    <option value="">{text.sortDefault}</option>
                    <option value="oldest">{text.sortOldest}</option>
                    {/* Reflected for an address that already states it, never offered as a
                        choice: the chronological orderings are submitted here, not browsed. */}
                    <option value="newest" hidden>
                      {text.sortNewest}
                    </option>
                  </select>
                </div>
              </div>
              {order ? <p className="field-hint">{text.ageHint}</p> : null}
              <p className="field-hint">{text.advancedSearchHint}</p>
            </div>
            {invalid ? (
              <p className="field-error" role="alert">
                {text.filtersInvalid}
              </p>
            ) : null}
          </div>
          <div className="sgn-dialog-foot filter-dialog-foot">
            <Link
              className="btn btn-ghost btn-sm"
              href={clearHref}
              onClick={dismiss}
            >
              {text.filtersClear}
            </Link>
            <button className="btn btn-primary" type="submit">
              {advancedDraft ? text.advancedSearchRun : text.filtersApply}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
