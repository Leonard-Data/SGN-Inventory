// A contact pair the screen cannot record as written: half of one, an unreadable value, or a
// value wider than the record could hold.
export class ContactInputError extends Error {}

// Creating a property can carry the owner's contact details in the same submission, because the
// moment someone creates the record is the moment they know who to call. Only the name and the
// number are asked for here: the request is built in the shape the property record's own capture
// form already sends, so both surfaces record a contact through one guarded operation and the
// name/number rules cannot drift between them.
export type ContactDraft = { display_name: string; phone: string };
export type ContactRequest = {
  display_name: string;
  phones: string[];
  raw_phone_text: string;
  contact_type: 'unknown';
};

// The submitted contact details, or null when the form asked for none. A half-filled pair is
// refused before anything is committed, so no property is created for a contact that cannot be
// recorded. The database still owns what a valid name and number are; this only refuses the
// shapes the form itself can produce.
export function contactDraft(value: unknown): ContactDraft | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value))
    throw new ContactInputError();
  const draft = value as Record<string, unknown>;
  if (
    Object.keys(draft).some(
      (key) => key !== 'display_name' && key !== 'phone',
    ) ||
    typeof draft.display_name !== 'string' ||
    typeof draft.phone !== 'string'
  )
    throw new ContactInputError();
  const display_name = draft.display_name.trim(),
    phone = draft.phone.trim();
  if (!display_name && !phone) return null;
  // The same bounds the capture form's own inputs hold, so a typed value that reaches the
  // database is one the record could have held anyway.
  if (
    !display_name ||
    !phone ||
    display_name.length > 200 ||
    phone.length > 100
  )
    throw new ContactInputError();
  return { display_name, phone };
}

export function contactRequest(draft: ContactDraft): ContactRequest {
  return {
    display_name: draft.display_name,
    phones: [draft.phone],
    raw_phone_text: draft.phone,
    contact_type: 'unknown',
  };
}

export type ContactRecord = { id: string } | { error: string };

// The record commits first and its owner contact follows. A contact the database refuses stays a
// stated failure beside the created record rather than undoing it or passing silently, so the
// person finishes it on the record they now have.
export async function createWithContact<Created extends { id: string }>(
  create: () => Promise<Created>,
  capture: (propertyId: string) => Promise<string | null>,
): Promise<{ created: Created; contact: ContactRecord }> {
  const created = await create();
  try {
    const id = await capture(created.id);
    // A recorded contact comes back identified; anything else is not a confirmation.
    return { created, contact: id ? { id } : { error: 'unavailable' } };
  } catch (failure) {
    const code = (failure as { code?: unknown } | null)?.code;
    return {
      created,
      contact: { error: typeof code === 'string' ? code : 'unavailable' },
    };
  }
}
