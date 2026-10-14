'use client';
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '@/i18n/messages';
import type { Employee } from '@/features/employees/types';
import { api, RequestError } from '@/features/employees/api';
import type { PropertyDetail } from '@/features/properties/detail-data';
import type { ContactDetail } from './data';
import { MutationForm, RecordFields, AddressFields } from './forms';
import { targetFields, type Target, type Changes } from './fields';
import { maintenanceError, maintenanceText, optionLabel } from './messages';
import { ContactPicker } from './contact-picker';
import { failureRoute } from './refusal-rules';
type Editor = {
  target: Target;
  targetId: string | null;
  revision: string;
  propertyRevision: string;
  values: Record<string, unknown>;
  impact?: ContactDetail['impact'];
};
export function Maintenance({
  detail,
  employee,
  locale,
  onSaved,
  onDenied,
}: {
  detail: PropertyDetail;
  employee: Employee;
  locale: Locale;
  onSaved: () => void | Promise<void>;
  onDenied: (status: number) => void;
}) {
  const text = maintenanceText(locale),
    property = detail.property,
    staff = ['staff', 'manager', 'admin'].includes(employee.role),
    reviewer = ['manager', 'admin'].includes(employee.role),
    canEdit =
      !property.archived_at && (staff || property.created_by === employee.id),
    // Shared-contact detail correction is its own permission: any live employee on a readable
    // property, independent of property-fact authority. Links, creation and unlink stay staff-only.
    canEditContact = !property.archived_at || reviewer;
  const [editor, setEditor] = useState<Editor | null>(null),
    [selected, setSelected] = useState(''),
    [contactBusy, setContactBusy] = useState(false),
    [contactError, setContactError] = useState<string | null>(null),
    [notice, setNotice] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  function open(
    target: Target,
    targetId: string | null,
    revision: string,
    values: Record<string, unknown>,
  ) {
    setEditor({
      target,
      targetId,
      revision,
      propertyRevision: property.revision,
      values,
    });
    setSelected(typeof values.contact_id === 'string' ? values.contact_id : '');
    setNotice(false);
  }
  async function contact(id: string) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setContactBusy(true);
    setContactError(null);
    try {
      const result = await api<ContactDetail>(
        '/api/contacts/' + id,
        undefined,
        abort.signal,
      );
      if (!abort.signal.aborted)
        setEditor({
          target: 'contact',
          targetId: id,
          revision: result.impact.revision,
          propertyRevision: property.revision,
          values: result.contact,
          impact: result.impact,
        });
    } catch (failure) {
      if (abort.signal.aborted) return;
      if (
        failure instanceof RequestError &&
        failureRoute(failure.status, failure.code) === 'denied'
      )
        onDenied(failure.status);
      else
        setContactError(
          failure instanceof RequestError ? failure.code : 'unavailable',
        );
    } finally {
      if (!abort.signal.aborted) setContactBusy(false);
    }
  }
  async function save(changes: Changes, explanation?: string) {
    if (!editor) return;
    return api('/api/properties/' + property.id + '/maintenance', {
      target: editor.target,
      targetId: editor.targetId,
      revision: editor.revision,
      propertyRevision: editor.propertyRevision,
      changes,
      ...(explanation ? { explanation } : {}),
    });
  }
  async function saved() {
    setEditor((current) => (current === editor ? null : current));
    setNotice(true);
    await onSaved();
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{text.editFacts}</h2>
      </div>
      <div className="panel-body">
        <p>{text.immediate}</p>
        {notice ? <p role="status">{text.saved}</p> : null}
        {canEdit ? (
          <>
            <div className="maintenance-actions">
              <button
                className="btn btn-sm"
                onClick={() =>
                  open('property', property.id, property.revision, property)
                }
              >
                {text.editFacts}
              </button>
              <button
                className="btn btn-sm"
                onClick={() =>
                  open('address', null, property.revision, { is_primary: true })
                }
              >
                {text.newAddress}
              </button>
            </div>
            {detail.addresses.map((address) => (
              <div className="record" key={address.id}>
                <p className="record-body" translate="no">
                  {address.address_text}
                </p>
                <p className="record-meta">
                  {optionLabel(locale, address.format)} ·{' '}
                  {optionLabel(locale, address.mapping_status)}
                  {address.is_primary ? ' · ' + text.primary : ''}
                </p>
                <span className="record-actions">
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      open('address', address.id, address.revision, address)
                    }
                  >
                    {text.correctAddress}
                  </button>
                  {reviewer && address.format === 'current' ? (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() =>
                        open('mapping', address.id, address.revision, address)
                      }
                    >
                      {text.mapping}
                    </button>
                  ) : null}
                </span>
              </div>
            ))}
          </>
        ) : null}
        <h3>{text.contacts}</h3>
        {staff ? <p>{text.wrongPerson}</p> : null}
        {staff && canEdit ? (
          <button
            className="btn btn-sm"
            onClick={() =>
              open('link', null, property.revision, {
                relation: 'unknown',
                is_primary: false,
              })
            }
          >
            {text.link}
          </button>
        ) : null}
        {detail.contacts.map((link) => (
          <div className="record" key={link.contact_id}>
            <h4 className="record-title" translate="no">
              {link.contacts?.display_name ?? text.unknown}
            </h4>
            <span className="record-actions">
              {canEditContact ? (
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => contact(link.contact_id)}
                  disabled={contactBusy}
                >
                  {text.contactEdit}
                </button>
              ) : null}
              {staff && canEdit ? (
                <>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      open('link', link.contact_id, link.revision, link)
                    }
                  >
                    {text.link}
                  </button>
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() =>
                      open('link', link.contact_id, link.revision, {
                        ...link,
                        remove: false,
                      })
                    }
                  >
                    {text.unlink}
                  </button>
                </>
              ) : null}
            </span>
          </div>
        ))}
        {staff ? (
          <details className="maintenance">
            <summary>{text.newContact}</summary>
            <MutationForm
              locale={locale}
              target="contact"
              save={(changes) =>
                api<{ id: string }>('/api/contacts', { changes })
              }
              onSaved={async () => {
                setNotice(true);
                await onSaved();
              }}
              onDenied={onDenied}
            >
              <p>{text.wrongPerson}</p>
              <RecordFields
                locale={locale}
                names={targetFields.contact}
                values={{ contact_type: 'unknown' }}
              />
            </MutationForm>
          </details>
        ) : null}
        {contactBusy ? <p role="status">{text.loading}</p> : null}
        {contactError ? (
          <p role="alert">{maintenanceError(locale, contactError)}</p>
        ) : null}
        {editor &&
        (editor.target === 'contact'
          ? canEditContact
          : canEdit &&
            (editor.target === 'mapping'
              ? reviewer
              : editor.target === 'link'
                ? staff
                : true)) ? (
          <div key={editor.target + editor.targetId + editor.revision}>
            <h3>{optionLabel(locale, editor.target)}</h3>
            <p>{text.optional}</p>
            <a
              href={'/properties/' + property.id}
              target="_blank"
              rel="noopener noreferrer"
              className="link"
            >
              {text.current}
            </a>
            {editor.target === 'link' &&
            !Object.hasOwn(editor.values, 'remove') ? (
              <ContactPicker
                locale={locale}
                selected={selected}
                onSelected={setSelected}
                onDenied={onDenied}
              />
            ) : null}
            <MutationForm
              locale={locale}
              target={editor.target}
              values={editor.values}
              save={save}
              onSaved={saved}
              onDenied={onDenied}
              explanation={editor.target === 'property'}
            >
              {editor.target === 'property' ? (
                <>
                  <RecordFields
                    locale={locale}
                    values={editor.values}
                    names={targetFields.property.filter(
                      (k) =>
                        k !== 'status' ||
                        !['sold', 'rented'].includes(
                          String(editor.values.status),
                        ),
                    )}
                  />
                  {/* A mistaken price keeps its own revision; this note is optional. */}
                  <div className="field">
                    <label
                      className="field-label"
                      htmlFor="maintenance-explanation"
                    >
                      {text.correctionExplanation}
                    </label>
                    <textarea
                      id="maintenance-explanation"
                      className="textarea"
                      name="explanation"
                      rows={2}
                      maxLength={2000}
                    />
                    <p className="field-hint">
                      {text.correctionExplanationHint}
                    </p>
                  </div>
                </>
              ) : null}
              {editor.target === 'address' || editor.target === 'mapping' ? (
                <AddressFields
                  locale={locale}
                  values={editor.values}
                  onDenied={onDenied}
                  variant={editor.target}
                />
              ) : null}
              {editor.target === 'contact' ? (
                <>
                  <h4>{text.contactImpact}</h4>
                  <ul>
                    {editor.impact?.properties.map((p) => (
                      <li key={p.id}>
                        <a
                          href={'/properties/' + p.id}
                          target="_blank"
                          rel="noopener noreferrer"
                          translate="no"
                          className="link"
                        >
                          {p.property_code}
                        </a>
                      </li>
                    ))}
                  </ul>
                  <label className="check">
                    <input type="checkbox" required />
                    {text.confirmImpact}
                  </label>
                  <RecordFields
                    locale={locale}
                    names={targetFields.contact}
                    values={editor.values}
                  />
                </>
              ) : null}
              {editor.target === 'link' ? (
                Object.hasOwn(editor.values, 'remove') ? (
                  <>
                    <p>{text.unlinkConfirm}</p>
                    <label className="check">
                      <input
                        name="remove"
                        type="checkbox"
                        value="true"
                        required
                      />
                      {text.unlink}
                    </label>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="contact_id" value={selected} />
                    <RecordFields
                      locale={locale}
                      names={['relation', 'is_primary']}
                      values={editor.values}
                    />
                  </>
                )
              ) : null}
            </MutationForm>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                controller.current?.abort();
                setContactBusy(false);
                setEditor(null);
              }}
            >
              {text.cancel}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
