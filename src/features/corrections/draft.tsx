'use client';
import { useId, useState, type FormEvent } from 'react';
import type { Locale } from '@/i18n/messages';
import type { Json } from '@/types/database';
import type { Employee } from '@/features/employees/types';
import { ContactPicker } from '@/features/property-maintenance/contact-picker';
import { api, RequestError } from '@/features/employees/api';
import type { PropertyDetail } from '@/features/properties/detail-data';
import {
  AddressFields,
  RecordFields,
} from '@/features/property-maintenance/forms';
import {
  formChanges,
  fields,
  targetFields,
  type Target,
} from '@/features/property-maintenance/fields';
import {
  maintenanceText,
  optionLabel,
} from '@/features/property-maintenance/messages';
import type { Correction } from './data';
export function observation(
  detail: PropertyDetail,
  target: Target,
  id: string | null,
) {
  const property = detail.property;
  if (target === 'property')
    return { values: property, revision: property.revision };
  if (id === null) return { values: {}, revision: property.revision };
  if (target === 'address') {
    const row = detail.addresses.find((a) => a.id === id);
    if (row) return { values: row, revision: row.revision };
  }
  if (target === 'contact') {
    const row = detail.contacts.find((l) => l.contact_id === id)?.contacts;
    if (row) return { values: row, revision: row.revision };
  }
  if (target === 'link') {
    const row = detail.contacts.find((l) => l.contact_id === id);
    if (row) return { values: row, revision: row.revision };
  }
  return null;
}
export function CorrectionDraft({
  detail: incomingDetail,
  locale,
  role,
  request: incomingRequest,
  proposal: incomingProposal = {},
  onSaved,
  onDenied,
}: {
  detail: PropertyDetail;
  locale: Locale;
  role: Employee['role'];
  request?: Correction;
  proposal?: Json;
  onSaved: () => void | Promise<void>;
  onDenied: (status: number) => void;
}) {
  const [initial] = useState({
    detail: incomingDetail,
    request: incomingRequest,
    proposal: incomingProposal,
  });
  const { detail, request, proposal } = initial;
  const text = maintenanceText(locale),
    id = useId(),
    property = detail.property;
  const [token, setToken] = useState(
    request
      ? request.target + ':' + (request.target_id ?? 'new')
      : 'property:' + property.id,
  );
  const [selected, setSelected] = useState<string[]>(
      proposal && typeof proposal === 'object' && !Array.isArray(proposal)
        ? Object.keys(proposal)
        : [],
    ),
    [contactId, setContactId] = useState(
      proposal &&
        typeof proposal === 'object' &&
        !Array.isArray(proposal) &&
        typeof proposal.contact_id === 'string'
        ? proposal.contact_id
        : '',
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [success, setSuccess] = useState(false);
  const [kind, rawId = 'new'] = token.split(':'),
    target = kind as Target,
    targetId = rawId === 'new' ? null : rawId,
    observed = observation(detail, target, targetId);
  const staff = ['staff', 'manager', 'admin'].includes(role);
  const available = targetFields[target].filter(
    (name) =>
      (staff || !['contact_id', 'remove'].includes(name)) &&
      !(name === 'status' && ['sold', 'rented'].includes(property.status)) &&
      !(
        target === 'address' &&
        ['province_text', 'commune_text', 'district_unit_id'].includes(name)
      ) &&
      !(
        target === 'address' &&
        (observed?.values as Record<string, unknown>)?.format === 'current' &&
        name.startsWith('district_')
      ),
  );
  const starting = observed
    ? {
        ...observed.values,
        ...(proposal && typeof proposal === 'object' && !Array.isArray(proposal)
          ? proposal
          : {}),
      }
    : {};
  const replacementNames = selected.filter(
    (name) => name !== 'contact_id' && available.includes(name),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !observed) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const changes = formChanges(target, form, observed.values);
      if (request)
        await api('/api/corrections/' + request.id, {
          action: 'amend',
          requestRevision: request.revision,
          explanation: form.get('explanation'),
          changes,
          revision: observed.revision,
          propertyRevision: property.revision,
        });
      else
        await api('/api/corrections', {
          propertyId: property.id,
          target,
          targetId,
          category: form.get('category'),
          explanation: form.get('explanation'),
          changes,
          revision: observed.revision,
          propertyRevision: property.revision,
        });
      setSuccess(true);
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
  if (success) return <p role="status">{text.saved}</p>;
  return (
    <div>
      {target === 'link' && selected.includes('contact_id') && staff ? (
        <ContactPicker
          locale={locale}
          selected={contactId}
          onSelected={setContactId}
          onDenied={onDenied}
        />
      ) : null}
      <form onSubmit={submit}>
        <p>{request ? text.amendHint : text.unknownReplacement}</p>
        <fieldset disabled={busy}>
          <legend>{request ? text.amend : text.submit}</legend>
          {request ? (
            <p>{optionLabel(locale, target)}</p>
          ) : (
            <div className="field">
              <label className="field-label" htmlFor={id + '-target'}>
                {text.target}
              </label>
              <select
                id={id + '-target'}
                className="select"
                value={token}
                onChange={(event) => {
                  setToken(event.target.value);
                  setSelected([]);
                  setContactId('');
                }}
              >
                <option value={'property:' + property.id}>
                  {optionLabel(locale, 'property')}
                </option>
                {detail.addresses.map((a) => (
                  <option key={a.id} value={'address:' + a.id}>
                    {optionLabel(locale, 'address')}: {a.address_text}
                  </option>
                ))}
                <option value="address:new">
                  {text.newTarget} ({optionLabel(locale, 'address')})
                </option>
                {detail.contacts.map((l) => (
                  <optgroup
                    key={l.contact_id}
                    label={l.contacts?.display_name ?? text.unknown}
                  >
                    <option value={'contact:' + l.contact_id}>
                      {optionLabel(locale, 'contact')}:{' '}
                      {l.contacts?.display_name}
                    </option>
                    <option value={'link:' + l.contact_id}>
                      {optionLabel(locale, 'link')}:{' '}
                      {optionLabel(locale, l.relation)}
                    </option>
                  </optgroup>
                ))}
                <option value="link:new">
                  {text.newTarget} ({optionLabel(locale, 'link')})
                </option>
              </select>
            </div>
          )}
          {!request ? (
            <div className="field">
              <label className="field-label" htmlFor={id + '-category'}>
                {text.issueCategory}
              </label>
              <select
                id={id + '-category'}
                className="select"
                name="category"
                defaultValue="incorrect"
              >
                {['incorrect', 'missing', 'other'].map((c) => (
                  <option key={c} value={c}>
                    {optionLabel(locale, c)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field">
            <label className="field-label" htmlFor={id + '-explanation'}>
              {text.issueExplanation}
            </label>
            <textarea
              id={id + '-explanation'}
              className="textarea"
              name="explanation"
              minLength={10}
              maxLength={2000}
              rows={3}
              required
            />
          </div>
          <details className="maintenance">
            <summary>{text.replacement}</summary>
            <div className="proposal-choices">
              {available.map((name) => (
                <label key={name} className="check">
                  <input
                    type="checkbox"
                    checked={selected.includes(name)}
                    onChange={(event) =>
                      setSelected((previous) =>
                        event.target.checked
                          ? [...previous, name]
                          : previous.filter((n) => n !== name),
                      )
                    }
                  />
                  {fields[name]![locale]}
                </label>
              ))}
            </div>
            <div key={token}>
              {target === 'address' ? (
                <AddressFields
                  names={replacementNames}
                  locale={locale}
                  values={starting}
                  onDenied={onDenied}
                />
              ) : (
                <RecordFields
                  names={replacementNames}
                  locale={locale}
                  values={starting}
                />
              )}
            </div>
          </details>
        </fieldset>
        {!observed ? <p role="alert">{text.stale}</p> : null}
        {error ? (
          <p role="alert">
            {error === 'stale-edit'
              ? text.stale
              : error === 'invalid-input'
                ? text.invalid
                : text.unavailable}
          </p>
        ) : null}
        <a
          href={'/properties/' + property.id}
          target="_blank"
          rel="noopener noreferrer"
          className="link"
        >
          {text.current}
        </a>
        <button className="btn btn-sm btn-primary" disabled={busy || !observed}>
          {busy ? text.saving : request ? text.amend : text.submit}
        </button>
        {target === 'link' && selected.includes('contact_id') ? (
          <input type="hidden" name="contact_id" value={contactId} />
        ) : null}
      </form>
    </div>
  );
}
