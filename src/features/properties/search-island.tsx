'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Locale } from '@/i18n/messages';
import { label, messages } from '@/i18n/messages';
import { formatDecimal, formatVnd } from './format';
import { PriceInput } from './price-input';
import { api, RequestError } from '@/features/employees/api';
import { contactName } from '@/features/contacts/directory';
import { ContactPicker } from '@/features/property-maintenance/contact-picker';
import { UnitCombobox } from '@/features/property-maintenance/unit-combobox';
import {
  FIXED_PROVINCE,
  LEGACY_CATALOG_DAY,
  type UnitOption,
} from '@/features/property-maintenance/units';
import {
  INVENTORY_ACCESS_TYPES,
  INVENTORY_ADDRESS_FORMAT_ANY,
  INVENTORY_ADDRESS_FORMATS,
  INVENTORY_FILTER_KEYS,
  INVENTORY_LISTING_MODES,
  INVENTORY_PROPERTY_TYPES,
  INVENTORY_STATUSES,
  communeIds,
  communeValue,
  noInventoryFilters,
  offeredAddressLevels,
  parseInventoryFilters,
  searchedAddressFormat,
  squareMetres,
  wholeVnd,
  withoutCommune,
  type InventoryFilterKey,
  type InventoryFilters,
} from './filters';
import { inventoryHref, type InventoryView } from './view';
import { isInventoryOrder } from './stream';
import { resultMode } from './catalogue-results';

// The official catalog rows the district and ward pickers read. Names are source data and are
// never translated, so a language switch keeps the same unit name.
type AdminUnit = UnitOption & { id: string };

// One applied condition as a removable chip: the summary's own chip and the communes chosen inside
// the panel are the same control, so removing one reads the same everywhere. A condition with no
// removal of its own is stated as the same chip without the control.
function Chip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string;
  removeLabel?: string;
  onRemove?: () => void;
}) {
  return (
    <span className="chip">
      {label}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={removeLabel}>
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
      ) : null}
    </span>
  );
}

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
  const appliedDistrict = filters.district ?? '';
  // The communes the address states, as the set they are: one value is the single commune an older
  // address carries, and several are the set the panel chose.
  const appliedCommunes = communeIds(filters.ward);
  // The stated value the set travels as, which is stable across renders and so the key the effects
  // below read the applied communes by.
  const appliedWard = filters.ward ?? '';
  const appliedContact = filters.contact ?? '';
  const appliedCreatedBy = filters.createdBy ?? '';
  // The format the search reads through: an address that states none is the legacy search the panel
  // opens on, and a cleared format filter states no format condition at all.
  const appliedFormat = searchedAddressFormat(filters);
  const formatLabel = (format: string) =>
    format === INVENTORY_ADDRESS_FORMAT_ANY
      ? text.filtersAny
      : label(locale, format);
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
  // The dialog's live district and ward selections drive the dependent lists beneath them;
  // applying or dismissing returns both to the filter set the address currently states. The contact
  // selection is the same shape: it starts at the applied value and returns to it on dismiss.
  const [district, setDistrict] = useState(appliedDistrict);
  const [selectedWards, setSelectedWards] = useState(appliedCommunes);
  const [contact, setContact] = useState(appliedContact);
  // The format the panel will apply: one of the two formats, or the cleared state it inherited from
  // the address, which the two-value control cannot display but a submission keeps.
  const [format, setFormat] = useState(appliedFormat);
  const [createdBy, setCreatedBy] = useState(appliedCreatedBy);
  const [contactLabel, setContactLabel] = useState<string | null>(null);
  const [districts, setDistricts] = useState<AdminUnit[]>([]);
  const [wards, setWards] = useState<AdminUnit[]>([]);
  const [districtFailed, setDistrictFailed] = useState(false);
  const [wardFailed, setWardFailed] = useState(false);
  const [appliedNames, setAppliedNames] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  function dismiss() {
    onOpen(false);
    setInvalid(false);
    setMode(appliedMode);
    setOrder(appliedOrder);
    setDistrict(appliedDistrict);
    setSelectedWards(communeIds(appliedWard));
    setContact(appliedContact);
    setCreatedBy(appliedCreatedBy);
    setFormat(appliedFormat);
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
    setDistrict(appliedDistrict);
    setSelectedWards(communeIds(appliedWard));
    setContact(appliedContact);
    setCreatedBy(appliedCreatedBy);
    setFormat(appliedFormat);
  }, [
    appliedFormat,
    appliedMode,
    appliedOrder,
    appliedDistrict,
    appliedWard,
    appliedContact,
    appliedCreatedBy,
    appliedStateKey,
  ]);
  // The catalog is the same official list the address form reads, for the generation the stated
  // format records: the closed pre-2025 three-tier list a legacy address names, the current
  // two-tier list a current one names. A cleared format filter states no condition, so it keeps the
  // legacy generation the panel opens on, where the district level exists at all.
  const legacyUnits = format !== 'current';
  const levels = offeredAddressLevels(format);
  // Every list narrows inside the one province the business records: a legacy ward hangs off its
  // district, and a current commune off the province itself. A dependent level waits for the level
  // above it, unless the address already states a ward the panel must keep visible and removable.
  const wardParent = legacyUnits ? district : FIXED_PROVINCE.id;
  const wardDisabled = legacyUnits && !district && !selectedWards.length;
  // A denial clears the protected surface through the handler the inventory list already uses.
  // The district level exists only in the legacy generation.
  useEffect(() => {
    setDistricts([]);
    setDistrictFailed(false);
    if (!legacyUnits) return;
    const abort = new AbortController();
    const params = new URLSearchParams({
      level: 'district',
      parent: FIXED_PROVINCE.id,
      on: LEGACY_CATALOG_DAY,
    });
    void api<{ units: AdminUnit[] }>(
      '/api/admin-units?' + params,
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setDistricts(result.units);
        setDistrictFailed(false);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        )
          onDenied(failure.status);
        else setDistrictFailed(true);
      });
    return () => abort.abort();
  }, [legacyUnits, onDenied]);
  // A legacy ward hangs off its district and a current commune off the stated province, so the ward
  // list narrows by the level the chosen generation has above it.
  useEffect(() => {
    setWards([]);
    setWardFailed(false);
    if (!wardParent) return;
    const abort = new AbortController();
    const params = new URLSearchParams({
      level: 'commune',
      parent: wardParent,
    });
    if (legacyUnits) params.set('on', LEGACY_CATALOG_DAY);
    void api<{ units: AdminUnit[] }>(
      '/api/admin-units?' + params,
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
  }, [legacyUnits, wardParent, onDenied]);
  // An applied unit is named from its own recorded row, so a chip and a field state the unit
  // without offering it as a choice. The read is keyed by the applied ids alone: an id the catalog
  // cannot answer stays named by itself rather than being asked for again on every render.
  useEffect(() => {
    const applied: [string, string][] = [];
    if (appliedDistrict) applied.push(['district', appliedDistrict]);
    for (const id of communeIds(appliedWard)) applied.push(['commune', id]);
    if (!applied.length) return;
    const abort = new AbortController();
    void Promise.all(
      applied.map(([level, id]) =>
        api<{ units: AdminUnit[] }>(
          '/api/admin-units?' + new URLSearchParams({ level, include: id }),
          undefined,
          abort.signal,
        )
          .then(
            (result) => result.units.find((unit) => unit.id === id)?.name_vi,
          )
          .catch((failure) => {
            if (
              failure instanceof RequestError &&
              (failure.status === 401 || failure.status === 403)
            )
              onDenied(failure.status);
            return undefined;
          }),
      ),
    ).then((names) => {
      if (abort.signal.aborted) return;
      const found: Record<string, string> = {};
      applied.forEach(([, id], index) => {
        const name = names[index];
        if (name) found[id] = name;
      });
      if (!Object.keys(found).length) return;
      setAppliedNames((current) => ({ ...current, ...found }));
    });
    return () => abort.abort();
  }, [appliedDistrict, appliedWard, onDenied]);
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
  const metres = (value: string) =>
    squareMetres(value) ? `${formatDecimal(value, locale)} m` : value;
  const priceLabel = (selectedMode: string | null, range: 'from' | 'to') => {
    if (selectedMode === 'rent')
      return range === 'from' ? text.rentPriceFrom : text.rentPriceTo;
    if (selectedMode)
      return range === 'from' ? text.salePriceFrom : text.salePriceTo;
    return range === 'from' ? text.priceRangeFrom : text.priceRangeTo;
  };
  // Whether this run reads the database, judged by the same function the list uses on the address it
  // is handed: a run carries the address's submitted query and the draft's own criteria, so the
  // action and its hint can never promise a local filter the run does not answer locally. Asking
  // here is still only asking, so an edit runs nothing until the panel is run.
  const advancedDraft =
    resultMode({
      query,
      filters: {
        ...noInventoryFilters,
        district: district || null,
        ward: communeValue(selectedWards),
        contact: contact || null,
      },
      sort: order || null,
    }) === 'advanced';
  // The current filter set stays visible as removable chips, and each chip removes exactly its
  // own condition, so the address is still the only place a filter lives.
  const applied: { key: InventoryFilterKey; id?: string; label: string }[] = [];
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
  // The recorded access state, named with the same words the record screen states for it.
  if (filters.accessType)
    applied.push({
      key: 'accessType',
      label: `${text.accessType}: ${label(locale, filters.accessType)}`,
    });
  // The creator selection is its own condition, so the chip states it directly rather than as a
  // heading with the same words repeated after it.
  if (filters.createdBy)
    applied.push({ key: 'createdBy', label: label(locale, filters.createdBy) });
  const unitName = (units: readonly AdminUnit[], id: string) =>
    units.find((unit) => unit.id === id)?.name_vi ?? appliedNames[id] ?? id;
  if (filters.district)
    applied.push({
      key: 'district',
      label: `${text.district}: ${unitName(districts, filters.district)}`,
    });
  // Each chosen commune is its own condition in the summary, so the set states how many are chosen
  // and which, and removing one narrows the set again rather than clearing it.
  for (const id of appliedCommunes)
    applied.push({
      key: 'ward',
      id: 'ward:' + id,
      label: `${text.ward}${
        appliedCommunes.length > 1 ? ` (${appliedCommunes.length})` : ''
      }: ${unitName(wards, id)}`,
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
  // Each dimension states its own two bounds, so a person can see which side of the range came from
  // the address.
  if (filters.frontageMin)
    applied.push({
      key: 'frontageMin',
      label: `${text.frontageRangeFrom}: ${metres(filters.frontageMin)}`,
    });
  if (filters.frontageMax)
    applied.push({
      key: 'frontageMax',
      label: `${text.frontageRangeTo}: ${metres(filters.frontageMax)}`,
    });
  if (filters.depthMin)
    applied.push({
      key: 'depthMin',
      label: `${text.depthRangeFrom}: ${metres(filters.depthMin)}`,
    });
  if (filters.depthMax)
    applied.push({
      key: 'depthMax',
      label: `${text.depthRangeTo}: ${metres(filters.depthMax)}`,
    });
  function remove(key: InventoryFilterKey, communeId?: string) {
    // Removing one commune of a set leaves the others in the address, so the criterion narrows
    // instead of disappearing; removing the last one removes the condition.
    if (key === 'ward' && communeId)
      return router.push(
        inventoryHref({
          query,
          sort,
          view,
          filters: withoutCommune(filters, communeId),
        }),
      );
    // Each level narrows the one above it, so removing a level removes the levels beneath it too.
    // The format is cleared rather than unstated, so the next load reads the cleared search back
    // instead of reopening the default legacy one.
    const next =
      key === 'district'
        ? { ...filters, district: null, ward: null }
        : key === 'addressFormat'
          ? { ...filters, addressFormat: INVENTORY_ADDRESS_FORMAT_ANY }
          : { ...filters, [key]: null };
    router.push(inventoryHref({ query, sort, view, filters: next }));
  }
  const clearHref = inventoryHref({
    query,
    sort,
    view,
    filters: noInventoryFilters,
  });
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
  // A price bound is typed in a unit and submitted as whole VND, through the same control the
  // record's own price fields use, so a search typed as 16 tỷ is the amount a record typed as
  // 16 tỷ holds. The bound a rental search states is a monthly rent, which opens on triệu.
  const priceBound = (
    name: 'priceMin' | 'priceMax',
    heading: string,
    selectedMode: string | null,
  ) => (
    <div
      className={invalid ? 'field is-invalid' : 'field'}
      key={`${name}=${filters[name] ?? ''}`}
    >
      <label className="field-label" htmlFor={'filter-' + name}>
        {heading}
      </label>
      <PriceInput
        id={'filter-' + name}
        name={name}
        value={filters[name]}
        locale={locale}
        unit={selectedMode === 'rent' ? 'trieu' : 'ty'}
        kind={selectedMode === 'rent' ? 'rent' : 'sale'}
        invalid={invalid}
      />
    </div>
  );
  // A field is keyed by its applied value so a soft navigation that changes the address
  // rebuilds the control with the filter set the address now states.
  const bound = (
    name: keyof InventoryFilters,
    heading: string,
    units: readonly string[],
  ) => (
    <div
      className={invalid ? 'field is-invalid' : 'field'}
      key={`${name}=${filters[name] ?? ''}`}
    >
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
      {/* The applied summary always names the address format: the legacy search is itself a
          narrowing, so it is stated rather than left for a person to wonder where a property
          recorded in the other format went. Its remove control clears it to the no-format search. */}
      <div className="chips">
        {applied.length ? (
          <Link className="link" href={clearHref} prefetch={false}>
            {text.filtersClear}
          </Link>
        ) : null}
        <Chip
          label={`${text.addressFormat}: ${formatLabel(appliedFormat)}`}
          removeLabel={`${text.filtersRemove}: ${text.addressFormat}`}
          onRemove={
            appliedFormat === INVENTORY_ADDRESS_FORMAT_ANY
              ? undefined
              : () => remove('addressFormat')
          }
        />
        {applied.map((condition) => (
          <Chip
            key={condition.id ?? condition.key}
            label={condition.label}
            removeLabel={`${text.filtersRemove}: ${condition.label}`}
            onRemove={() => remove(condition.key, condition.id)}
          />
        ))}
      </div>
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
                {/* The section's own note states which of the two groups actually answers the
                    run, so it sits with the heading rather than after the last control. */}
                <p className="field-hint">
                  {advancedDraft
                    ? text.catalogueFiltersAdvancedHint
                    : text.catalogueFiltersHint}
                </p>
              </div>
              <div className="form-grid-3">
                {select('status', text.status, INVENTORY_STATUSES, true)}
                {select('mode', text.listingMode, INVENTORY_LISTING_MODES)}
                {select('type', text.propertyType, INVENTORY_PROPERTY_TYPES)}
                {select('accessType', text.accessType, INVENTORY_ACCESS_TYPES)}
              </div>
              {/* The panel offers the two formats a search is matched through; the cleared state
                  that searches both is reached from the format chip above, not from here. */}
              <div className="field-group">
                <div className="form-grid">
                  <div className="field">
                    <label
                      className="field-label"
                      htmlFor="filter-addressFormat"
                    >
                      {text.addressFormat}
                    </label>
                    <select
                      id="filter-addressFormat"
                      className="select"
                      value={
                        format === INVENTORY_ADDRESS_FORMAT_ANY ? '' : format
                      }
                      onChange={(event) => {
                        const next = event.currentTarget.value;
                        if (next === format) return;
                        // The two generations hold their own units, so a switch leaves no selected
                        // unit that still applies: the district does not exist in the current
                        // generation, so keeping it would apply a filter the chosen address can
                        // never match.
                        setFormat(next);
                        setDistrict('');
                        setSelectedWards([]);
                      }}
                    >
                      {INVENTORY_ADDRESS_FORMATS.map((value) => (
                        <option key={value} value={value}>
                          {label(locale, value)}
                        </option>
                      ))}
                    </select>
                    <input type="hidden" name="addressFormat" value={format} />
                  </div>
                </div>
                <p className="field-hint">{text.addressFormatHint}</p>
              </div>
              {/* The creator selection is answered from the loaded catalogue alone, so it is
                  offered only for a run that stays in it. A whole-inventory search has no creator
                  criterion; a locked field the form cannot submit keeps that run from stating a
                  filter it will not apply. */}
              <div className="form-grid-3">
                <div className="field">
                  <label className="field-label" htmlFor="filter-createdBy">
                    {text.creatorFilter}
                  </label>
                  <select
                    id="filter-createdBy"
                    className="select"
                    name="createdBy"
                    value={createdBy}
                    onChange={(event) =>
                      setCreatedBy(event.currentTarget.value)
                    }
                    disabled={advancedDraft}
                    aria-describedby={
                      advancedDraft ? 'filter-createdBy-hint' : undefined
                    }
                  >
                    <option value="">{text.filtersAny}</option>
                    <option value="mine">{text.mine}</option>
                  </select>
                  {advancedDraft ? (
                    <p className="field-hint" id="filter-createdBy-hint">
                      {text.creatorFilterCatalogueOnly}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="field-group">
                <div className="form-grid">
                  {priceBound('priceMin', priceLabel(mode, 'from'), mode)}
                  {priceBound('priceMax', priceLabel(mode, 'to'), mode)}
                </div>
                <p className="field-hint">{text.priceFilterHint}</p>
              </div>
              <div className="field-group">
                <div className="form-grid">
                  {bound('areaMin', text.areaRangeFrom, ['m²'])}
                  {bound('areaMax', text.areaRangeTo, ['m²'])}
                </div>
                <p className="field-hint">{text.areaFilterHint}</p>
              </div>
              <div className="field-group">
                <div className="form-grid">
                  {bound('frontageMin', text.frontageRangeFrom, ['m'])}
                  {bound('frontageMax', text.frontageRangeTo, ['m'])}
                  {bound('depthMin', text.depthRangeFrom, ['m'])}
                  {bound('depthMax', text.depthRangeTo, ['m'])}
                </div>
                <p className="field-hint">{text.dimensionFilterHint}</p>
              </div>
            </div>
            <div className="form-section">
              <div className="form-section-head">
                <h3>{text.advancedSearchHeading}</h3>
                <p className="field-hint">{text.advancedSearchHint}</p>
              </div>
              {/* Each criterion is one group: its controls and the hint that explains them, so
                  every hint in the panel sits the same distance from what it explains. */}
              <div className="field-group">
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
              </div>
              <div className="field-group">
                {/* The province is stated rather than chosen: the business records one, so every
                    list below narrows inside it. */}
                <p className="field-hint">
                  {text.province}:{' '}
                  <span translate="no">{FIXED_PROVINCE.name}</span>
                </p>
                <div className="form-grid">
                  {/* The panel keeps every level the chosen address format has - a legacy
                    address adds the district above the ward - and a dependent
                    level waits, disabled with its hint, until the level above it is chosen. */}
                  {levels.includes('district') ? (
                    <UnitCombobox
                      id="filter-district"
                      name="district"
                      label={text.district}
                      units={districts}
                      value={district}
                      selectedLabel={appliedNames[district]}
                      onChange={(next) => {
                        if (next === district) return;
                        setDistrict(next);
                        setSelectedWards([]);
                      }}
                      anyLabel={text.filtersAny}
                      noMatch={text.comboboxNoMatch}
                    />
                  ) : null}
                  {/* The commune filter carries a set: the field adds one commune at a time and the
                      chips beside it state the communes chosen so far, each removable on its own. */}
                  <div>
                    <UnitCombobox
                      id="filter-ward"
                      name="ward-candidate"
                      label={text.ward}
                      units={wards.filter(
                        (unit) => !selectedWards.includes(unit.id),
                      )}
                      value=""
                      placeholder={text.wardAdd}
                      disabled={wardDisabled}
                      hint={wardDisabled ? text.areaLevelHint : undefined}
                      onChange={(next) => {
                        if (!next) return;
                        setSelectedWards((current) =>
                          current.includes(next) ? current : [...current, next],
                        );
                      }}
                      noMatch={text.comboboxNoMatch}
                    />
                    <input
                      type="hidden"
                      name="ward"
                      value={communeValue(selectedWards) ?? ''}
                    />
                    {selectedWards.length ? (
                      <div
                        className="chips"
                        role="group"
                        aria-label={text.ward}
                      >
                        {selectedWards.map((id) => (
                          <Chip
                            key={id}
                            label={unitName(wards, id)}
                            removeLabel={`${text.filtersRemove}: ${unitName(wards, id)}`}
                            onRemove={() =>
                              setSelectedWards((current) =>
                                current.filter((commune) => commune !== id),
                              )
                            }
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
                <p className="field-hint">{text.areaAdminHint}</p>
                {districtFailed || wardFailed ? (
                  <p className="field-error" role="alert">
                    {text.areaFilterUnavailable}
                  </p>
                ) : null}
              </div>
              <div className="field-group">
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
              </div>
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
