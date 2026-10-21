'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Locale } from '@/i18n/messages';
import type { Employee } from '@/features/employees/types';
import { api, RequestError } from '@/features/employees/api';
import { LoadingSkeleton } from '@/features/skeleton';
import { applyServerSummary } from '@/features/properties/catalogue-changes';
import { supersededAddressIds } from '@/features/properties/catalogue';
import { useCatalogueChange } from '@/features/properties/catalogue-provider';
import type { PropertyDetail } from '@/features/properties/detail-data';
import type { PropertySummary } from '@/features/properties/types';
import { mayEditProperty } from '@/features/properties/edit-permission';
import type { ContactDetail } from './data';
import { MutationForm, RecordFields, AddressFields } from './forms';
import { CrosswalkOffer } from './crosswalk-offer';
import { AddressConversion } from './convert-address';
import type { AddressCrosswalk } from './crosswalk';
import { LocationEditor } from '@/features/properties/location';
import { targetFields, type Target, type Changes } from './fields';
import { maintenanceError, maintenanceText, optionLabel } from './messages';
import { ContactPicker } from './contact-picker';
import { failureRoute } from './refusal-rules';
import { useToast } from '@/features/toasts/toast-host';
import { useNarrowSections } from './narrow-view';
import {
  SECTIONS,
  DEFAULT_SECTION,
  nextSection,
  type Section,
} from './sections';
import { shouldAdoptFactsSnapshot } from './facts-snapshot';
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
  onRefresh,
  onDenied,
}: {
  detail: PropertyDetail;
  employee: Employee;
  locale: Locale;
  onSaved: () => void | Promise<void>;
  onRefresh: () => void | Promise<void>;
  onDenied: (status: number) => void;
}) {
  const text = maintenanceText(locale),
    property = detail.property,
    staff = ['staff', 'manager', 'admin'].includes(employee.role),
    reviewer = ['manager', 'admin'].includes(employee.role),
    canEdit = mayEditProperty(employee, {
      createdBy: property.created_by,
      archived: !!property.archived_at,
    }),
    // Shared-contact detail correction is its own permission: any live employee on a readable
    // property, independent of property-fact authority. Links, creation and unlink stay staff-only.
    canEditContact = !property.archived_at || reviewer;
  const [section, setSection] = useState<Section>(DEFAULT_SECTION),
    narrow = useNarrowSections(),
    [editor, setEditor] = useState<Editor | null>(null),
    // A saved legacy address reports what the crosswalk says about its ward, so the current address
    // it names can be recorded from here rather than written on the person's behalf.
    [crosswalk, setCrosswalk] = useState<AddressCrosswalk | null>(null),
    // A save whose answer carries a crosswalk offer holds the editor open on that report instead of
    // closing it before the person can read the outcome or use the one action it offers.
    offerSaved = useRef(false),
    [selected, setSelected] = useState(''),
    [contactBusy, setContactBusy] = useState(false),
    [contactError, setContactError] = useState<string | null>(null);
  const notify = useToast();
  // A correction inserts a successor and leaves the row it replaced in the list, so the format
  // switch is offered on the rows the property is still recorded at, never on superseded history.
  const superseded = supersededAddressIds(detail.addresses);
  // Every committed edit reports what the server now holds for this property, so the browser's
  // catalogue follows a changed address or fact instead of keeping the record it had.
  const applyChange = useCatalogueChange();
  // The dialog closes on a committed save, so the confirmation names the target it recorded.
  const targetSaved: Record<Target, string> = {
    property: text.propertySaved,
    address: text.addressSaved,
    mapping: text.addressSaved,
    contact: text.contactSaved,
    link: text.linkSaved,
  };
  const controller = useRef<AbortController | null>(null),
    [facts, setFacts] = useState(property),
    [factsSavedRevision, setFactsSavedRevision] = useState<string | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (
      shouldAdoptFactsSnapshot(
        factsSavedRevision,
        facts.revision,
        property.revision,
      )
    ) {
      // Adopt a new snapshot only after this dialog's own save; external reloads keep the draft.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional draft snapshot sync
      setFacts(property);
      setFactsSavedRevision(null);
    }
  }, [facts, factsSavedRevision, property]);
  // Roving tabindex: the arrow keys move both focus and selection across the three tabs.
  function onSectionKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const next = nextSection(section, event.key);
    if (!next) return;
    event.preventDefault();
    setSection(next);
    document.getElementById('maintenance-tab-' + next)?.focus();
  }
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
    const result = await api<{
      summary?: PropertySummary | null;
      address?: AddressCrosswalk;
    }>('/api/properties/' + property.id + '/maintenance', {
      target: editor.target,
      targetId: editor.targetId,
      revision: editor.revision,
      propertyRevision: editor.propertyRevision,
      changes,
      ...(explanation ? { explanation } : {}),
    });
    applyServerSummary(applyChange, result, property.id);
    setCrosswalk(result.address ?? null);
    offerSaved.current = !!result.address;
    return result;
  }
  async function candidateRecorded(result: {
    summary?: PropertySummary | null;
  }) {
    applyServerSummary(applyChange, result, property.id);
    setCrosswalk(null);
    notify({ saved: true, message: text.crosswalkRecorded });
    await onSaved();
  }
  // The other format's row is written by the database from the official crosswalk; the surface then
  // re-reads the property so both rows appear with their own format labels.
  async function converted(result: { summary?: PropertySummary | null }) {
    applyServerSummary(applyChange, result, property.id);
    setCrosswalk(null);
    notify({ saved: true, message: text.converted });
    await onSaved();
  }
  async function saved() {
    if (!editor) return;
    setEditor((current) => (current === editor ? null : current));
    notify({ saved: true, message: targetSaved[editor.target] });
    // The offer is the point of this save, so the surface that reports it stays open readable
    // while the record itself is still re-read behind it.
    if (offerSaved.current) {
      offerSaved.current = false;
      await onRefresh();
      return;
    }
    await onSaved();
  }
  async function saveFacts(changes: Changes, explanation?: string) {
    const result = await api<{ summary?: PropertySummary | null }>(
      '/api/properties/' + facts.id + '/maintenance',
      {
        target: 'property',
        targetId: facts.id,
        revision: facts.revision,
        propertyRevision: facts.revision,
        changes,
        ...(explanation ? { explanation } : {}),
      },
    );
    applyServerSummary(applyChange, result, facts.id);
    setCrosswalk(null);
    setFactsSavedRevision(facts.revision);
    return result;
  }
  async function savedFacts() {
    notify({ saved: true, message: text.propertySaved });
    await onSaved();
  }
  const sectionLabel: Record<Section, string> = {
    property: text.tabFacts,
    address: text.tabAddresses,
    contact: text.tabContacts,
  };
  return (
    <section className="panel" aria-label={text.editFacts}>
      <div className="panel-body">
        <p>{text.immediate}</p>
        {narrow ? (
          <div className="field">
            <label className="field-label" htmlFor="maintenance-section">
              {text.section}
            </label>
            <select
              id="maintenance-section"
              className="select"
              value={section}
              onChange={(event) => setSection(event.target.value as Section)}
            >
              {SECTIONS.map((id) => (
                <option key={id} value={id}>
                  {sectionLabel[id]}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="tabs" role="tablist" aria-label={text.editFacts}>
            {SECTIONS.map((id) => (
              <button
                key={id}
                className="tab"
                type="button"
                role="tab"
                id={'maintenance-tab-' + id}
                aria-controls={'maintenance-panel-' + id}
                aria-selected={section === id}
                tabIndex={section === id ? 0 : -1}
                onClick={() => setSection(id)}
                onKeyDown={onSectionKeyDown}
              >
                {sectionLabel[id]}
              </button>
            ))}
          </div>
        )}

        <section
          className="tabpanel"
          id="maintenance-panel-property"
          role={narrow ? undefined : 'tabpanel'}
          aria-labelledby={narrow ? undefined : 'maintenance-tab-property'}
          aria-label={narrow ? sectionLabel.property : undefined}
          hidden={section !== 'property'}
        >
          {canEdit ? (
            <>
              <p>{text.optional}</p>
              <a
                href={'/properties/' + property.id}
                target="_blank"
                rel="noopener noreferrer"
                className="link"
              >
                {text.current}
              </a>
              <MutationForm
                key={'facts' + facts.revision}
                locale={locale}
                target="property"
                values={facts}
                save={saveFacts}
                onSaved={savedFacts}
                onDenied={onDenied}
                explanation
              >
                <RecordFields
                  locale={locale}
                  values={facts}
                  names={targetFields.property.filter(
                    (k) =>
                      (k !== 'status' ||
                        !['sold', 'rented'].includes(String(facts.status))) &&
                      k !== 'latitude' &&
                      k !== 'longitude',
                  )}
                />
                {/* The point is set by clicking the map; typed coordinates are the keyboard alternative. */}
                <LocationEditor values={facts} locale={locale} />
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
                  <p className="field-hint">{text.correctionExplanationHint}</p>
                </div>
              </MutationForm>
            </>
          ) : (
            <p>{text.notEditable}</p>
          )}
        </section>

        <section
          className="tabpanel"
          id="maintenance-panel-address"
          role={narrow ? undefined : 'tabpanel'}
          aria-labelledby={narrow ? undefined : 'maintenance-tab-address'}
          aria-label={narrow ? sectionLabel.address : undefined}
          hidden={section !== 'address'}
        >
          {canEdit ? (
            <>
              <div className="maintenance-actions">
                <button
                  className="btn btn-sm"
                  onClick={() =>
                    open('address', null, property.revision, {
                      is_primary: true,
                    })
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
                  {/* Format is fixed on an ordinary save; this is the one deliberate switch, offered
                      on the row the property is recorded at now rather than one a correction
                      replaced. */}
                  {superseded.has(address.id) ? null : (
                    <AddressConversion
                      locale={locale}
                      propertyId={property.id}
                      address={{
                        id: address.id,
                        revision: address.revision,
                        propertyRevision: property.revision,
                      }}
                      format={address.format}
                      onDenied={onDenied}
                      onConverted={converted}
                    />
                  )}
                </div>
              ))}
              {crosswalk ? (
                <CrosswalkOffer
                  locale={locale}
                  propertyId={property.id}
                  address={crosswalk}
                  onDenied={onDenied}
                  onRecorded={candidateRecorded}
                />
              ) : null}
              {editor &&
              (editor.target === 'address' || editor.target === 'mapping') &&
              (editor.target !== 'mapping' || reviewer) ? (
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
                  <MutationForm
                    locale={locale}
                    target={editor.target}
                    values={editor.values}
                    save={save}
                    onSaved={saved}
                    onDenied={onDenied}
                  >
                    <AddressFields
                      locale={locale}
                      values={editor.values}
                      onDenied={onDenied}
                      variant={editor.target}
                    />
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
            </>
          ) : (
            <p>{text.notEditable}</p>
          )}
        </section>

        <section
          className="tabpanel"
          id="maintenance-panel-contact"
          role={narrow ? undefined : 'tabpanel'}
          aria-labelledby={narrow ? undefined : 'maintenance-tab-contact'}
          aria-label={narrow ? sectionLabel.contact : undefined}
          hidden={section !== 'contact'}
        >
          {canEditContact || staff ? (
            <>
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
                      notify({ saved: true, message: text.contactSaved });
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
              {contactBusy ? (
                <LoadingSkeleton label={text.loading} shape="rows" rows={2} />
              ) : null}
              {contactError ? (
                <p role="alert">{maintenanceError(locale, contactError)}</p>
              ) : null}
              {editor &&
              (editor.target === 'contact'
                ? canEditContact
                : editor.target === 'link'
                  ? staff && canEdit
                  : false) ? (
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
                  >
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
                          <input
                            type="hidden"
                            name="contact_id"
                            value={selected}
                          />
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
            </>
          ) : (
            <p>{text.notEditable}</p>
          )}
        </section>
      </div>
    </section>
  );
}
