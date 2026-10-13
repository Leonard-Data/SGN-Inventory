'use client';
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { api, RequestError } from '@/features/employees/api';
import type { Locale } from '@/i18n/messages';
import { fields, formChanges, type Target, type Changes } from './fields';
import { maintenanceText, optionLabel } from './messages';
import type { Unit } from './data';

export function MutationForm({
  locale,
  target,
  values = {},
  save,
  onSaved,
  onDenied,
  explanation = false,
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
  children: ReactNode;
}) {
  const text = maintenanceText(locale);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const changes = formChanges(target, form, values);
      if (Object.keys(changes).length === 0) {
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
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      setError(
        failure instanceof RequestError ? failure.code : 'invalid-input',
      );
    } finally {
      setBusy(false);
    }
  }
  const message =
    error === 'noChange'
      ? text.noChange
      : error === 'stale-edit'
        ? text.stale
        : error === 'conflict'
          ? text.conflict
          : error === 'explanation-without-price'
            ? text.correctionExplanationNeedsPrice
            : error === 'invalid-input'
              ? text.invalid
              : text.unavailable;
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy}>{children}</fieldset>
      {error ? <p role="alert">{message}</p> : null}
      <button className="btn btn-sm btn-primary" disabled={busy}>
        {busy ? text.saving : text.save}
      </button>
    </form>
  );
}
export function RecordFields({
  names,
  values = {},
  locale,
}: {
  names: readonly string[];
  values?: Record<string, unknown>;
  locale: Locale;
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
    return (
      <div className="field" key={name}>
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
        ) : ['phones'].includes(field.kind ?? '') ||
          [
            'notes',
            'address_text',
            'construction_text',
            'area_raw',
            'mapping_evidence',
          ].includes(name) ? (
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
  value,
  onChange,
  locale,
  onDenied,
}: {
  name: string;
  level: string;
  parent?: string;
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
  onDenied: (status: number) => void;
}) {
  const id = useId(),
    [units, setUnits] = useState<Unit[]>([]),
    [error, setError] = useState(false);
  useEffect(() => {
    if (level !== 'province' && !parent) return;
    const abort = new AbortController();
    void api<{ units: Unit[] }>(
      '/api/admin-units?' +
        new URLSearchParams({ level, ...(parent ? { parent } : {}) }),
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted) setUnits(result.units);
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
  }, [level, parent, onDenied]);
  const text = maintenanceText(locale);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {fields[name]![locale]}
      </label>
      <select
        id={id}
        className="select"
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{text.catalogEmpty}</option>
        {value && !units.some((u) => u.id === value) ? (
          <option value={value}>{value}</option>
        ) : null}
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.name_vi} ({unit.valid_from} – {unit.valid_to ?? ''})
          </option>
        ))}
      </select>
      {error ? <span role="alert">{text.unavailable}</span> : null}
    </div>
  );
}
export function AddressFields({
  values = {},
  locale,
  onDenied,
  variant = 'address',
}: {
  values?: Record<string, unknown>;
  locale: Locale;
  onDenied: (status: number) => void;
  variant?: 'address' | 'mapping';
}) {
  const id = useId(),
    [format, setFormat] = useState(String(values.format ?? '')),
    [province, setProvince] = useState(String(values.province_unit_id ?? '')),
    [district, setDistrict] = useState(String(values.district_unit_id ?? '')),
    [commune, setCommune] = useState(String(values.commune_unit_id ?? ''));
  const text = maintenanceText(locale),
    current = variant === 'mapping' || format === 'current';
  return (
    <>
      {variant === 'address' ? (
        <>
          <p>{text.preserveSource}</p>
          <div className="field">
            <label className="field-label" htmlFor={id}>
              {fields.format![locale]}
            </label>
            <select
              id={id}
              className="select"
              name="format"
              required
              value={format}
              onChange={(event) => {
                setFormat(event.target.value);
                setDistrict('');
                setCommune('');
              }}
              disabled={!!values.id}
            >
              <option value="">{text.unknown}</option>
              {values.format === 'alternate' ? (
                <option value="alternate">
                  {optionLabel(locale, 'alternate')}
                </option>
              ) : null}
              <option value="legacy">{optionLabel(locale, 'legacy')}</option>
              <option value="current">{optionLabel(locale, 'current')}</option>
            </select>
          </div>
          <p>{text.rawCurrent}</p>
          <RecordFields
            locale={locale}
            values={values}
            names={[
              'address_text',
              'house_number',
              'street',
              'province_text',
              ...(!current ? ['district_text'] : []),
              'commune_text',
              'is_primary',
            ]}
          />
        </>
      ) : (
        <>
          <p>{text.mappingHint}</p>
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
      <UnitPicker
        name="province_unit_id"
        level="province"
        value={province}
        onChange={(value) => {
          setProvince(value);
          setDistrict('');
          setCommune('');
        }}
        locale={locale}
        onDenied={onDenied}
      />
      {!current ? (
        <UnitPicker
          key={'district' + province}
          name="district_unit_id"
          level="district"
          parent={province}
          value={district}
          onChange={(value) => {
            setDistrict(value);
            setCommune('');
          }}
          locale={locale}
          onDenied={onDenied}
        />
      ) : null}
      <UnitPicker
        key={'commune' + province + district + current}
        name="commune_unit_id"
        level="commune"
        parent={current ? province : district || province}
        value={commune}
        onChange={setCommune}
        locale={locale}
        onDenied={onDenied}
      />
    </>
  );
}
