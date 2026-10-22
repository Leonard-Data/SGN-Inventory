'use client';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { api, RequestError } from '@/features/employees/api';
import type { Locale } from '@/i18n/messages';
import { fields, formChanges, type Target, type Changes } from './fields';
import { maintenanceError, maintenanceText, optionLabel } from './messages';
import { failureRoute } from './refusal-rules';
import { UnitCombobox, type UnitChoice } from './unit-combobox';
import {
  LEGACY_CATALOG_DAY,
  clearedUnits,
  filledDistrictText,
  pickedDistrict,
  pickedProvince,
  unitParent,
  type AddressUnits,
} from './units';
import type { Unit } from './data';

export function MutationForm({
  locale,
  target,
  values = {},
  save,
  onSaved,
  onDenied,
  explanation = false,
  onCancel,
  onStateChange,
  saveContext,
  children,
}: {
  locale: Locale;
  target: Target;
  values?: Record<string, unknown>;
  save: (changes: Changes, explanation?: string) => Promise<unknown>;
  onSaved: () => void | Promise<void>;
  onDenied: (status: number) => void;
  // The optional correction note only reaches the API when the form offers it.
  explanation?: boolean;
  onCancel?: () => void;
  onStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
  saveContext?: ReactNode;
  children: ReactNode;
}) {
  const text = maintenanceText(locale);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    onStateChange?.({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  function draftChanged(event: FormEvent<HTMLFormElement>) {
    try {
      setDirty(
        Object.keys(
          formChanges(target, new FormData(event.currentTarget), values),
        ).length > 0,
      );
    } catch {
      setDirty(true);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const changes = formChanges(target, form, values);
      if (Object.keys(changes).length === 0) {
        requestAnimationFrame(() => errorRef.current?.focus());
        setError('noChange');
        return;
      }
      const note = explanation
        ? String(form.get('explanation') ?? '').trim()
        : '';
      await save(changes, note || undefined);
      await onSaved();
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        failureRoute(failure.status, failure.code) === 'denied'
      ) {
        onDenied(failure.status);
        return;
      }
      requestAnimationFrame(() => errorRef.current?.focus());
      setError(
        failure instanceof RequestError ? failure.code : 'invalid-input',
      );
    } finally {
      setBusy(false);
    }
  }
  const message = maintenanceError(locale, error);
  return (
    <form
      className={onCancel ? 'editor-form' : undefined}
      onSubmit={submit}
      onChange={draftChanged}
      // The unit picker commits its identifier by writing the field it submits, which raises no
      // change event of its own, so the unsaved state also follows plain input events.
      onInput={draftChanged}
    >
      <div className={onCancel ? 'editor-scroll' : undefined}>
        <fieldset disabled={busy}>{children}</fieldset>
        {error ? (
          <p className="field-error" ref={errorRef} tabIndex={-1} role="alert">
            {message}
          </p>
        ) : null}
      </div>
      <div className={onCancel ? 'sgn-dialog-foot' : undefined}>
        {saveContext ? (
          <fieldset className="editor-save-context" disabled={busy}>
            {saveContext}
          </fieldset>
        ) : null}
        <button className="btn btn-sm btn-primary" disabled={busy}>
          {busy ? text.saving : text.save}
        </button>
        {onCancel ? (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={onCancel}
          >
            {text.cancel}
          </button>
        ) : null}
      </div>
    </form>
  );
}
export function RecordFields({
  names,
  values = {},
  locale,
  refs,
}: {
  names: readonly string[];
  values?: Record<string, unknown>;
  locale: Locale;
  // A caller that needs to write into one of these fields while it stays uncontrolled.
  refs?: Record<string, Ref<HTMLInputElement>>;
}) {
  const prefix = useId(),
    copy = maintenanceText(locale);
  return names.map((name) => {
    const field = fields[name]!,
      id = prefix + '-' + name,
      value = values[name],
      text = field[locale];
    const initial = Array.isArray(value)
      ? value.join('\n')
      : value == null
        ? ''
        : String(value);
    // The district text is written by the legacy district picker and never typed here: a recorded
    // value travels with the form on every other save and reads back as the text it holds.
    if (name === 'district_text')
      return initial ? (
        <div className="field" key={name}>
          <span className="field-label">{text}</span>
          <p translate="no">{initial}</p>
          <input
            type="hidden"
            name={name}
            ref={refs?.[name]}
            defaultValue={initial}
          />
        </div>
      ) : (
        <input
          key={name}
          type="hidden"
          name={name}
          ref={refs?.[name]}
          defaultValue=""
        />
      );
    const wide =
      ['phones'].includes(field.kind ?? '') ||
      [
        'notes',
        'address_text',
        'construction_text',
        'area_raw',
        'mapping_evidence',
      ].includes(name);
    return (
      <div className={'field' + (wide ? ' span-all' : '')} key={name}>
        <label className="field-label" htmlFor={id}>
          {text}
        </label>
        {field.kind === 'boolean' ? (
          <select
            id={id}
            className="select"
            name={name}
            defaultValue={value === true ? 'true' : 'false'}
          >
            <option value="false">{copy.no}</option>
            <option value="true">{copy.yes}</option>
          </select>
        ) : field.options ? (
          <select
            id={id}
            className="select"
            name={name}
            defaultValue={initial}
            required={field.required}
          >
            <option value="">{copy.unknown}</option>
            {field.options
              .filter(
                (value) =>
                  name !== 'status' ||
                  !['sold', 'rented'].includes(value) ||
                  value === initial,
              )
              .map((value) => (
                <option key={value} value={value}>
                  {optionLabel(locale, value)}
                </option>
              ))}
          </select>
        ) : wide ? (
          // A multi-line field is as wide as the grid it stands in: source text is read, not
          // scanned in a column beside the other facts.
          <textarea
            id={id}
            className="textarea"
            name={name}
            rows={3}
            defaultValue={initial}
            maxLength={field.kind === 'phones' ? 2020 : 2000}
            required={field.required}
          />
        ) : (
          <input
            id={id}
            className="input"
            name={name}
            ref={refs?.[name]}
            type={field.kind === 'date' ? 'date' : 'text'}
            inputMode={
              field.kind === 'money' || field.kind === 'count'
                ? 'numeric'
                : field.kind === 'decimal'
                  ? 'decimal'
                  : undefined
            }
            defaultValue={initial}
            maxLength={2000}
            required={field.required}
          />
        )}
      </div>
    );
  });
}
function UnitPicker({
  name,
  level,
  parent,
  day,
  value,
  onChange,
  locale,
  onDenied,
}: {
  name: string;
  level: string;
  parent?: string;
  // The catalog day this level reads; no day reads the current generation.
  day?: string;
  value: string;
  onChange: (value: string, unit?: UnitChoice) => void;
  locale: Locale;
  onDenied: (status: number) => void;
}) {
  const id = useId(),
    [units, setUnits] = useState<Unit[]>([]),
    [error, setError] = useState(false);
  useEffect(() => {
    // A level whose parent is not chosen yet lists nothing, but the recorded unit's own row still
    // resolves to its official name.
    if (level !== 'province' && !parent && !value) return;
    const abort = new AbortController();
    void api<{ units: Unit[] }>(
      '/api/admin-units?' +
        new URLSearchParams({
          level,
          ...(parent ? { parent } : {}),
          ...(day ? { on: day } : {}),
          ...(value ? { include: value } : {}),
        }),
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (abort.signal.aborted) return;
        setUnits(result.units);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          (failure.status === 401 || failure.status === 403)
        )
          onDenied(failure.status);
        else setError(true);
      });
    return () => abort.abort();
  }, [level, parent, day, value, onDenied]);
  const text = maintenanceText(locale);
  return (
    <UnitCombobox
      id={id}
      name={name}
      label={fields[name]![locale]}
      units={units}
      value={value}
      onChange={onChange}
      anyLabel={text.catalogEmpty}
      noMatch={text.comboboxNoMatch}
      error={error ? text.unavailable : undefined}
    />
  );
}
export function AddressFields({
  values = {},
  names,
  locale,
  onDenied,
  variant = 'address',
}: {
  values?: Record<string, unknown>;
  names?: readonly string[];
  locale: Locale;
  onDenied: (status: number) => void;
  variant?: 'address' | 'mapping';
}) {
  const selected = names ? new Set(names) : null,
    includes = (name: string) => selected === null || selected.has(name),
    id = useId(),
    // A new address starts in the legacy format; a recorded one opens on the format it holds.
    [format, setFormat] = useState(String(values.format ?? 'legacy')),
    [units, setUnits] = useState<AddressUnits>({
      province: String(values.province_unit_id ?? ''),
      district: String(values.district_unit_id ?? ''),
      commune: String(values.commune_unit_id ?? ''),
    }),
    districtText = useRef<HTMLInputElement>(null),
    // The text the picker has written, which is what a save submits and what reads back beside it.
    [districtTextValue, setDistrictTextValue] = useState(
      String(values.district_text ?? ''),
    );
  const text = maintenanceText(locale),
    current = variant === 'mapping' || format === 'current',
    // A legacy address is the only one with a district level, and its pickers read the closed
    // pre-2025 three-tier list, where a ward hangs off its district rather than the province.
    legacy = variant === 'address' && format === 'legacy',
    generation = legacy ? 'legacy' : 'current',
    day = legacy ? LEGACY_CATALOG_DAY : undefined;
  // The legacy district picker is the only writer of the district text, so every write lands in
  // the field a save submits and in the text that reads back beside it.
  function setDistrictText(next: string) {
    const value = filledDistrictText(districtTextValue, next);
    if (value === null) return;
    setDistrictTextValue(value);
    const field = districtText.current;
    if (!field) return;
    field.value = value;
    // The surrounding form tracks its unsaved state from input events, which a value written this
    // way raises none of.
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return (
    <>
      {variant === 'address' ? (
        <>
          {includes('format') ? (
            <>
              <p className="span-all">{text.preserveSource}</p>
              <div className="field">
                <label className="field-label" htmlFor={id}>
                  {fields.format![locale]}
                </label>
                {/* Two formats are offered. A row an earlier import recorded as neither reads back
                    as what it holds: its own format is stated here but never offered. */}
                <select
                  id={id}
                  className="select"
                  name="format"
                  required
                  value={format}
                  onChange={(event) => {
                    setFormat(event.target.value);
                    // The two formats read different catalog generations, so no recorded unit is
                    // carried into a list that may not hold it.
                    setUnits(clearedUnits());
                  }}
                  disabled={!!values.id}
                >
                  {values.format === 'alternate' ? (
                    <option value="alternate">
                      {optionLabel(locale, 'alternate')}
                    </option>
                  ) : null}
                  <option value="legacy">
                    {optionLabel(locale, 'legacy')}
                  </option>
                  <option value="current">
                    {optionLabel(locale, 'current')}
                  </option>
                </select>
              </div>
            </>
          ) : null}
          <p className="span-all">
            {legacy ? text.legacyHint : text.rawCurrent}
          </p>
          <RecordFields
            locale={locale}
            values={{ ...values, district_text: districtTextValue }}
            refs={{ district_text: districtText }}
            names={[
              'address_text',
              'house_number',
              'street',
              ...(!current ? ['district_text'] : []),
              'is_primary',
            ].filter(includes)}
          />
        </>
      ) : (
        <>
          <p className="span-all">{text.mappingHint}</p>
          <RecordFields
            locale={locale}
            values={{ ...values, mapping_status: 'verified' }}
            names={[
              'mapping_status',
              'verification_method',
              'source_url',
              'effective_on',
              'mapping_evidence',
            ]}
          />
        </>
      )}
      {variant === 'mapping' || includes('province_unit_id') ? (
        <UnitPicker
          name="province_unit_id"
          level="province"
          day={day}
          value={units.province}
          onChange={(value) => {
            // A district id from the previous province is cleared with it, so the text the picker
            // wrote for that district has nothing left to describe.
            if (value !== units.province) setDistrictText('');
            setUnits(pickedProvince(units, value));
          }}
          locale={locale}
          onDenied={onDenied}
        />
      ) : null}
      {legacy && includes('district_unit_id') ? (
        <UnitPicker
          key={'district' + units.province}
          name="district_unit_id"
          level="district"
          parent={unitParent('legacy', 'district', units)}
          day={LEGACY_CATALOG_DAY}
          value={units.district}
          onChange={(value, unit) => {
            setUnits(pickedDistrict(units, value));
            if (unit) setDistrictText(unit.name_vi);
          }}
          locale={locale}
          onDenied={onDenied}
        />
      ) : null}
      {variant === 'mapping' || includes('commune_unit_id') ? (
        <UnitPicker
          key={'commune' + units.province + units.district}
          name="commune_unit_id"
          level="commune"
          parent={unitParent(generation, 'commune', units)}
          day={day}
          value={units.commune}
          onChange={(value) => setUnits({ ...units, commune: value })}
          locale={locale}
          onDenied={onDenied}
        />
      ) : null}
    </>
  );
}
