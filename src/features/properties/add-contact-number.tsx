'use client';
import { useId, useState, type FormEvent } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { api, RequestError } from '@/features/employees/api';
import { useToast } from '@/features/toasts/toast-host';

// The capture form the property record offers: one surface submits this name and number to the
// endpoint, so the validation and the refusal wording stay in one place. The recorded number is a
// new contact beside the earlier ones.
export function AddContactNumber({
  propertyId,
  locale,
  onAdded,
  onDenied,
}: {
  propertyId: string;
  locale: Locale;
  onAdded: () => void | Promise<void>;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale];
  const notify = useToast();
  const nameId = useId(),
    phoneId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = String(data.get('display_name') ?? '').trim();
    const phone = String(data.get('phone') ?? '').trim();
    if (!name || !phone) {
      setProblem(text.contactNumberInvalid);
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api('/api/properties/' + propertyId + '/contacts', {
        changes: {
          display_name: name,
          phones: [phone],
          raw_phone_text: phone,
          contact_type: 'unknown',
        },
      });
      form.reset();
      notify({ saved: true, message: text.contactNumberSaved });
      await onAdded();
    } catch (failure) {
      if (
        failure instanceof RequestError &&
        (failure.status === 401 || failure.status === 403)
      ) {
        onDenied(failure.status);
        return;
      }
      // A refusal is stated as it stands: nothing was recorded, and the entry stays for a
      // corrected retry rather than being cleared or resubmitted automatically.
      setProblem(
        failure instanceof RequestError && failure.status === 400
          ? text.contactNumberInvalid
          : failure instanceof RequestError && failure.code === 'access-denied'
            ? text.contactNumberDenied
            : text.contactNumberFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="maintenance">
      <summary>{text.addContactNumber}</summary>
      <form onSubmit={submit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={nameId}>
            {text.contactNumberName}
          </label>
          <input
            className="input"
            id={nameId}
            name="display_name"
            type="text"
            maxLength={200}
            autoComplete="off"
            required
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={phoneId}>
            {text.contactNumberPhone}
          </label>
          <input
            className="input"
            id={phoneId}
            name="phone"
            type="tel"
            maxLength={100}
            autoComplete="off"
            inputMode="tel"
            required
          />
        </div>
        <p className="field-hint">{text.contactNumberNote}</p>
        {problem ? (
          <p className="field-error" role="alert">
            {problem}
          </p>
        ) : null}
        <button className="btn btn-sm" type="submit" disabled={busy}>
          {text.contactNumberSave}
        </button>
      </form>
    </details>
  );
}
