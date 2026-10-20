'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestError } from '@/features/employees/api';
import { applyServerSummary } from '@/features/properties/catalogue-changes';
import { useCatalogueChange } from '@/features/properties/catalogue-provider';
import type { PropertySummary } from '@/features/properties/types';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import { formChanges, targetFields } from './fields';
import { AddressFields, RecordFields } from './forms';
import { maintenanceText, optionLabel } from './messages';
import { useToast } from '@/features/toasts/toast-host';
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
    notify = useToast(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget),
        facts = formChanges('property', form),
        address = formChanges('address', form);
      const mode = facts.listing_mode;
      delete facts.listing_mode;
      const result = await api<{
        id: string;
        summary?: PropertySummary | null;
      }>('/api/properties', {
        mode,
        facts,
        address,
      });
      // The new record enters the browser's catalogue from the server's own answer, so the list
      // already holds it when the person returns from the record they just created.
      applyServerSummary(applyChange, result, result.id);
      // The record is committed and the new page opens with its confirmation.
      notify({ saved: true, message: text.propertyCreated });
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
      setBusy(false);
    }
  }
  return (
    <section className="panel maintenance">
      <div className="panel-body">
        <p>{text.immediate}</p>
        <form onSubmit={submit}>
          <fieldset
            disabled={busy}
            className="stack-4"
            aria-label={optionLabel(locale, 'property')}
          >
            <p>{text.optional}</p>
            <RecordFields
              locale={locale}
              values={{
                listing_mode: 'sale',
                property_type: 'unclassified',
                access_type: 'unknown',
              }}
              names={targetFields.property.filter(
                (k) => k !== 'status' && k !== 'latitude' && k !== 'longitude',
              )}
            />
            <AddressFields
              locale={locale}
              values={{ is_primary: true }}
              onDenied={onDenied}
            />
          </fieldset>
          {error ? (
            <p role="alert" className="field-error">
              {error === 'invalid-input' ? text.invalid : text.unavailable}
            </p>
          ) : null}
          <div className="form-foot">
            <button className="btn btn-primary" disabled={busy}>
              {busy ? text.saving : text.create}
            </button>
          </div>
        </form>
        <p className="search-hint">{messages[locale].legalNote}</p>
      </div>
    </section>
  );
}
