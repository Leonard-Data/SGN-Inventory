'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { messages, type Locale } from '@/i18n/messages';
import { EditDrawer } from '@/features/edit-drawer';
import { api, RequestError } from '@/features/employees/api';
import { LoadingSkeleton } from '@/features/skeleton';
import { useToast } from '@/features/toasts/toast-host';
import type { ContactDetail } from '@/features/property-maintenance/data';
import { targetFields } from '@/features/property-maintenance/fields';
import {
  MutationForm,
  RecordFields,
} from '@/features/property-maintenance/forms';
import {
  maintenanceError,
  maintenanceText,
  optionLabel,
} from '@/features/property-maintenance/messages';
import { failureRoute } from '@/features/property-maintenance/refusal-rules';
import { loadPropertyDetail } from '@/features/properties/detail-loader';
import { readLinkedProperties } from './linked-properties';
import type { ContactSummary } from './types';

type Preview = {
  id: string;
  address: string | null;
  relation: string | null;
  failed: boolean;
};

export function ContactEditorDrawer({
  record,
  locale,
  opener,
  onClose,
  onDenied,
  onSaved,
}: {
  record: ContactSummary;
  locale: Locale;
  opener: HTMLElement | null;
  onClose: () => void;
  onDenied: (status: number) => void;
  onSaved: () => void;
}) {
  const text = messages[locale];
  const copy = maintenanceText(locale);
  const notify = useToast();
  const [editor, setEditor] = useState<ContactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState({ dirty: false, busy: false });
  useEffect(() => {
    const abort = new AbortController();
    void api<ContactDetail>(
      '/api/contacts/' + record.id,
      undefined,
      abort.signal,
    )
      .then((result) => {
        if (!abort.signal.aborted) setEditor(result);
      })
      .catch((failure) => {
        if (abort.signal.aborted) return;
        if (
          failure instanceof RequestError &&
          failureRoute(failure.status, failure.code) === 'denied'
        )
          onDenied(failure.status);
        else
          setError(
            failure instanceof RequestError ? failure.code : 'unavailable',
          );
      });
    return () => abort.abort();
  }, [record.id, attempt, onDenied]);
  return (
    <EditDrawer
      title={text.contactEditorTitle + ' · ' + record.displayName}
      locale={locale}
      dirty={draft.dirty}
      busy={draft.busy}
      opener={opener}
      onClose={onClose}
    >
      {(requestClose) =>
        editor ? (
          <MutationForm
            locale={locale}
            target="contact"
            values={editor.contact}
            onCancel={requestClose}
            onStateChange={setDraft}
            saveContext={
              <>
                <p className="field-hint">{text.contactSharedIdentityNote}</p>
                <label className="check">
                  <input type="checkbox" required />
                  {copy.confirmImpact}
                </label>
              </>
            }
            save={(changes) =>
              api('/api/contacts/' + record.id, {
                revision: editor.impact.revision,
                changes,
              })
            }
            onSaved={() => {
              notify({ saved: true, message: copy.contactSaved });
              onClose();
              onSaved();
            }}
            onDenied={onDenied}
          >
            <p className="field-hint">{text.contactOptional}</p>
            <div className="contact-editor-fields">
              <RecordFields
                locale={locale}
                names={targetFields.contact}
                values={editor.contact}
              />
            </div>
            <LinkedProperties
              record={record}
              properties={editor.impact.properties}
              locale={locale}
              onDenied={onDenied}
            />
          </MutationForm>
        ) : (
          <div className="editor-scroll">
            {error ? (
              <div
                className="alert"
                role="alert"
                data-tone={error === 'contact-refusal' ? 'neutral' : 'danger'}
              >
                <span>{maintenanceError(locale, error)}</span>
                {error !== 'contact-refusal' ? (
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => {
                      setError(null);
                      setAttempt((value) => value + 1);
                    }}
                  >
                    {text.retry}
                  </button>
                ) : null}
              </div>
            ) : (
              <LoadingSkeleton label={text.loading} shape="rows" rows={4} />
            )}
          </div>
        )
      }
    </EditDrawer>
  );
}

function LinkedProperties({
  record,
  properties,
  locale,
  onDenied,
}: {
  record: ContactSummary;
  properties: ContactDetail['impact']['properties'];
  locale: Locale;
  onDenied: (status: number) => void;
}) {
  const text = messages[locale];
  const [previews, setPreviews] = useState<ReadonlyMap<string, Preview>>(
    new Map(),
  );
  useEffect(() => {
    const abort = new AbortController();
    void readLinkedProperties(
      properties.map((property) => property.id),
      async (id): Promise<Preview> => {
        try {
          const detail = await loadPropertyDetail(id, abort.signal);
          return {
            id,
            address: detail.addresses[0]?.address_text ?? null,
            relation:
              detail.contacts.find((link) => link.contact_id === record.id)
                ?.relation ?? null,
            failed: false,
          };
        } catch (failure) {
          if (
            !abort.signal.aborted &&
            failure instanceof RequestError &&
            (failure.status === 401 || failure.status === 403)
          ) {
            abort.abort();
            onDenied(failure.status);
          }
          return { id, address: null, relation: null, failed: true };
        }
      },
      (batch) =>
        setPreviews(
          (current) =>
            new Map([
              ...current,
              ...batch.map((row) => [row.id, row] as const),
            ]),
        ),
      abort.signal,
    );
    return () => abort.abort();
  }, [properties, record.id, onDenied]);
  return (
    <section className="contact-linked-properties">
      <h3>{text.contactLinkedProperties}</h3>
      <p className="field-hint">{text.contactLinkedPropertiesNote}</p>
      {properties.length ? (
        <div className="table-wrap">
          <table className="data-table stackable">
            <thead>
              <tr>
                <th scope="col">{text.columnPropertyId}</th>
                <th scope="col">{text.address}</th>
                <th scope="col">{text.contactColumnRelation}</th>
              </tr>
            </thead>
            <tbody>
              {properties.map((property) => {
                const preview = previews.get(property.id);
                const relation =
                  preview?.relation ??
                  record.links.find((link) => link.propertyId === property.id)
                    ?.relation;
                return (
                  <tr key={property.id}>
                    <th scope="row" data-label={text.columnPropertyId}>
                      <Link
                        className="link"
                        href={'/properties/' + property.id}
                        target="_blank"
                        rel="noopener noreferrer"
                        prefetch={false}
                        translate="no"
                      >
                        {property.property_code}
                      </Link>
                    </th>
                    <td data-label={text.address} translate="no">
                      {!preview
                        ? text.loading
                        : preview.failed
                          ? text.unavailable
                          : (preview.address ?? text.unknown)}
                    </td>
                    <td data-label={text.contactColumnRelation}>
                      {relation ? optionLabel(locale, relation) : text.unknown}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="field-hint">{text.contactNoProperties}</p>
      )}
    </section>
  );
}
