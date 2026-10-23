'use client';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestError } from '@/features/employees/api';
import { confirmsPrice } from '@/features/properties/price-input';
import { applyServerSummary } from '@/features/properties/catalogue-changes';
import { useCatalogueChange } from '@/features/properties/catalogue-provider';
import type {
  AddressMatch,
  PropertySummary,
} from '@/features/properties/types';
import { formatInteger } from '@/features/properties/format';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import {
  createPropertyFieldNames,
  formChanges,
  recordsAddressPart,
} from './fields';
import { AddressFields, RecordFields } from './forms';
import { createAfterWarning } from './create-duplicate';
import { DetailActionDialog } from '@/features/properties/detail-dialog';
import { CrosswalkOffer } from './crosswalk-offer';
import type { AddressCrosswalk } from './crosswalk';
import { maintenanceError, maintenanceText, optionLabel } from './messages';
import { useToast } from '@/features/toasts/toast-host';
import type { ContactRecord } from './create-contact';
export function CreateProperty({
  locale,
  onDenied,
}: {
  locale: Locale;
  onDenied: (status: number) => void;
}) {
  const router = useRouter();
  const applyChange = useCatalogueChange();
  const text = maintenanceText(locale),
    copy = messages[locale],
    notify = useToast(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    // A legacy save holds the page on its own confirmation, because the crosswalk outcome it reports
    // is the only place the current address can be recorded from.
    [created, setCreated] = useState<{
      id: string;
      address?: AddressCrosswalk;
    } | null>(null),
    [contactProblem, setContactProblem] = useState<string | null>(null),
    // The addresses the save is about to join, once the database has named them. A non-null list is
    // the warning: the same submit then creates anyway, and editing the address drops it so the
    // check runs again on what will actually be saved.
    [duplicates, setDuplicates] = useState<AddressMatch[] | null>(null),
    contactNameId = useId(),
    contactPhoneId = useId(),
    // The warning is a modal, so its own confirm submits the form the person already filled in.
    formRef = useRef<HTMLFormElement>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !confirmsPrice(event.currentTarget, locale)) return;
    const form = new FormData(event.currentTarget);
    // The owner's contact details are optional, but half a pair is not a contact: saying so here
    // keeps the record from being created for details that cannot be recorded.
    const contactName = String(form.get('contact_display_name') ?? '').trim(),
      contactPhone = String(form.get('contact_phone') ?? '').trim();
    if (!contactName !== !contactPhone) {
      setContactProblem(copy.contactNumberInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    setContactProblem(null);
    try {
      const facts = formChanges('property', form),
        address = formChanges('address', form);
      // The known address text is composed from the parts, so what a person supplies is the parts:
      // saying so here shows the refusal in the panel instead of after a round trip.
      if (!recordsAddressPart(address)) {
        setError('address-parts-required');
        setBusy(false);
        return;
      }
      // Before the record exists: the address this save stores may already be recorded. The
      // database composes the text from these parts and compares it with the one rule the
      // post-create group uses, so a match names exactly the properties that will share it.
      const outcome = await createAfterWarning(
        (parts) =>
          api<AddressMatch[]>('/api/properties/address-duplicates', {
            address: parts,
          }),
        address,
        duplicates,
        () => {
          const mode = facts.listing_mode;
          delete facts.listing_mode;
          return api<{
            id: string;
            summary?: PropertySummary | null;
            contact?: ContactRecord;
            address?: AddressCrosswalk;
          }>('/api/properties', {
            mode,
            facts,
            address,
            // Sent as the same pair the record's own capture form asks for; the server records it
            // through the one guarded contact operation.
            ...(contactName && contactPhone
              ? { contact: { display_name: contactName, phone: contactPhone } }
              : {}),
          });
        },
      );
      if ('denied' in outcome) {
        onDenied(outcome.denied);
        return;
      }
      if ('matches' in outcome) {
        setDuplicates(outcome.matches);
        setBusy(false);
        return;
      }
      const result = outcome.created;
      // The record exists, so the warning has nothing left to hold: it closes before the person is
      // taken to the record it produced.
      setDuplicates(null);
      // The new record enters the browser's catalogue from the server's own answer, so the list
      // already holds it when the person returns from the record they just created.
      applyServerSummary(applyChange, result, result.id);
      // The record is committed; a contact the database refused is stated beside it rather than
      // reported as a failed create, and the record page carries the form that finishes it.
      notify({ saved: true, message: text.propertyCreated });
      if (result.contact && 'error' in result.contact)
        notify({
          saved: true,
          tone: 'danger',
          message: copy.createContactFailed,
        });
      // The record is committed and the new page opens with its confirmation.
      if (result.address) {
        setCreated({ id: result.id, address: result.address });
        setBusy(false);
        return;
      }
      router.push('/properties/' + result.id);
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
      // The warning closes so the refusal is visible instead of hidden behind it.
      setDuplicates(null);
      setBusy(false);
    }
  }
  if (created)
    return (
      <section className="panel maintenance">
        <div className="panel-body">
          <p role="status">{text.propertyCreated}</p>
          {created.address ? (
            <CrosswalkOffer
              locale={locale}
              propertyId={created.id}
              address={created.address}
              onDenied={onDenied}
              onRecorded={(result) => {
                applyServerSummary(applyChange, result, created.id);
                notify({ saved: true, message: text.crosswalkRecorded });
                router.push('/properties/' + created.id);
              }}
            />
          ) : null}
          <div className="form-foot">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => router.push('/properties/' + created.id)}
            >
              {text.openRecord}
            </button>
          </div>
        </div>
      </section>
    );
  return (
    <section className="panel maintenance">
      <div className="panel-body">
        <p>{text.immediate}</p>
        <form
          ref={formRef}
          onSubmit={submit}
          // A draft that changes after the warning was read is a different address, so the next
          // submit asks again rather than confirming a stale match.
          onInput={() => setDuplicates(null)}
        >
          {/* One form, three stated sections: the sections carry the rhythm, and each one's
              fields sit on the shared two-column grid rather than on the inline editor's
              auto-fit arrangement. */}
          <fieldset
            disabled={busy}
            className="create-form"
            aria-label={optionLabel(locale, 'property')}
          >
            <div className="form-section">
              <div className="form-section-head">
                <h2>{text.formRecord}</h2>
              </div>
              <p className="field-hint">{text.optional}</p>
              <div className="form-grid">
                <RecordFields
                  locale={locale}
                  values={{
                    listing_mode: 'sale',
                    property_type: 'unclassified',
                    access_type: 'unknown',
                  }}
                  names={createPropertyFieldNames}
                />
              </div>
            </div>
            <div className="form-section">
              <div className="form-section-head">
                <h2>{text.formAddress}</h2>
              </div>
              <div className="form-grid">
                <AddressFields
                  locale={locale}
                  values={{ is_primary: true }}
                  onDenied={onDenied}
                />
              </div>
            </div>
            <div className="form-section">
              <div className="form-section-head">
                <h2>{text.formContact}</h2>
              </div>
              <p className="field-hint">{text.formContactHint}</p>
              <div className="form-grid">
                <div className="field">
                  <label className="field-label" htmlFor={contactNameId}>
                    {copy.contactNumberName}
                  </label>
                  <input
                    className="input"
                    id={contactNameId}
                    name="contact_display_name"
                    type="text"
                    maxLength={200}
                    autoComplete="off"
                  />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor={contactPhoneId}>
                    {copy.contactNumberPhone}
                  </label>
                  <input
                    className="input"
                    id={contactPhoneId}
                    name="contact_phone"
                    type="tel"
                    maxLength={100}
                    autoComplete="off"
                    inputMode="tel"
                  />
                </div>
              </div>
              {contactProblem ? (
                <p role="alert" className="field-error">
                  {contactProblem}
                </p>
              ) : null}
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="field-error">
              {maintenanceError(locale, error)}
            </p>
          ) : null}
          <div className="form-foot">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? text.saving : text.create}
            </button>
          </div>
        </form>
        {/* The warning is the highlight, not a line buried in the form: a modal the person has to
            answer, naming the records that already hold the address and still letting them create. */}
        <DetailActionDialog
          open={Boolean(duplicates?.length)}
          onClose={() => setDuplicates(null)}
          title={text.duplicateAddressTitle}
          closeLabel={copy.cancel}
          size="default"
          footer={
            <>
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => setDuplicates(null)}
              >
                {text.createBack}
              </button>
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => formRef.current?.requestSubmit()}
              >
                {busy ? text.saving : text.createAnyway}
              </button>
            </>
          }
        >
          <div className="alert" data-tone="neutral" role="alert">
            <div>
              <p>
                {text.duplicateAddressBefore.replace(
                  '{n}',
                  formatInteger(duplicates?.length ?? 0, locale),
                )}
              </p>
              <ul>
                {duplicates?.map((match) => (
                  <li key={match.id}>
                    <a
                      href={'/properties/' + match.id}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {match.propertyCode}
                    </a>
                  </li>
                ))}
              </ul>
              <p>{text.duplicateAddressHint}</p>
            </div>
          </div>
        </DetailActionDialog>
        <p className="search-hint">{copy.legalNote}</p>
      </div>
    </section>
  );
}
