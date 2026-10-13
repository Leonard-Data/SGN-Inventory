'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, RequestError } from '@/features/employees/api';
import type { Locale } from '@/i18n/messages';
import { messages } from '@/i18n/messages';
import {
  VENDOR_CONTACT_NAME_MAX_LENGTH,
  VENDOR_NAME_MAX_LENGTH,
  VENDOR_NOTES_MAX_LENGTH,
  VENDOR_SOURCE_ADDRESS_MAX_LENGTH,
} from './draft';
import type { Vendor } from './types';

// One bounded create of one company with one optional contact block. The submission key
// is created once per draft so an interrupted or ambiguous send retries the same vendor
// identity instead of recording a second company; a confirmed key conflict retires the
// key so a deliberately changed draft can be submitted as a new vendor.
export function VendorCreateForm({
  locale,
  onDenied,
}: {
  locale: Locale;
  onDenied: (status: number) => void;
}) {
  const router = useRouter();
  const text = messages[locale];
  const submissionKey = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '');
    submissionKey.current ??= crypto.randomUUID();
    try {
      const result = await api<{ vendor: Vendor }>('/api/vendors', {
        key: submissionKey.current,
        displayName: value('displayName'),
        contactName: value('contactName'),
        phones: value('phones'),
        email: value('email'),
        sourceAddress: value('sourceAddress'),
        notes: value('notes'),
      });
      router.push('/people/vendors/' + result.vendor.id);
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      const code =
        failure instanceof RequestError ? failure.code : 'invalid-input';
      // The key was already used for different details: retire it so the corrected
      // draft can be recorded, rather than trapping the user on one failed identity.
      if (code === 'vendor-conflict') submissionKey.current = null;
      setError(code);
      setBusy(false);
    }
  }
  const message =
    error === 'invalid-input'
      ? text.vendorCreateInvalid
      : error === 'vendor-conflict'
        ? text.vendorCreateConflict
        : text.vendorCreateFailed;
  return (
    <form onSubmit={submit}>
      <fieldset disabled={busy} className="stack-4">
        <p className="panel-note">{text.vendorOptionalHint}</p>
        <div className="field">
          <label className="field-label" htmlFor="vendor-display-name">
            {text.vendorCompanyName} <span className="field-req">*</span>
          </label>
          <input
            id="vendor-display-name"
            className="input"
            name="displayName"
            maxLength={VENDOR_NAME_MAX_LENGTH}
            required
            autoComplete="organization"
          />
          <p className="field-hint">{text.vendorCompanyNameHint}</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="vendor-contact-name">
            {text.vendorContactName}
          </label>
          <input
            id="vendor-contact-name"
            className="input"
            name="contactName"
            maxLength={VENDOR_CONTACT_NAME_MAX_LENGTH}
            autoComplete="name"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="vendor-phones">
            {text.vendorPhones}
          </label>
          <textarea
            id="vendor-phones"
            className="textarea"
            name="phones"
            rows={3}
            inputMode="tel"
          />
          <p className="field-hint">{text.vendorPhonesHint}</p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="vendor-email">
            {text.email}
          </label>
          <input
            id="vendor-email"
            className="input"
            name="email"
            type="email"
            autoComplete="email"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="vendor-source-address">
            {text.vendorSourceAddress}
          </label>
          <input
            id="vendor-source-address"
            className="input"
            name="sourceAddress"
            maxLength={VENDOR_SOURCE_ADDRESS_MAX_LENGTH}
            autoComplete="street-address"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="vendor-notes">
            {text.notes}
          </label>
          <textarea
            id="vendor-notes"
            className="textarea"
            name="notes"
            rows={3}
            maxLength={VENDOR_NOTES_MAX_LENGTH}
          />
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="field-error">
          {message}
        </p>
      ) : null}
      <div className="form-foot">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? text.saving : text.vendorCreateSubmit}
        </button>
      </div>
    </form>
  );
}
