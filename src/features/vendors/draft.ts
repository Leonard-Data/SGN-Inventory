// The bounded company/contact shape of one create, validated at the application boundary
// with the same limits the database enforces. Optional details are trimmed and a blank
// one becomes null (unknown); a malformed create is refused before any RPC runs, so it
// cannot leave a partial vendor.
export const VENDOR_NAME_MAX_LENGTH = 200;
export const VENDOR_CONTACT_NAME_MAX_LENGTH = 200;
export const VENDOR_PHONE_MAX_LENGTH = 40;
export const VENDOR_PHONE_MAX_COUNT = 5;
export const VENDOR_EMAIL_MAX_LENGTH = 254;
export const VENDOR_SOURCE_ADDRESS_MAX_LENGTH = 500;
export const VENDOR_NOTES_MAX_LENGTH = 2000;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const draftKeys = [
  'key',
  'displayName',
  'contactName',
  'phones',
  'email',
  'sourceAddress',
  'notes',
] as const;

export class VendorDraftError extends Error {
  readonly code: 'invalid-input';

  constructor(code: 'invalid-input') {
    super(code);
    this.code = code;
  }
}

export type VendorDraft = {
  key: string;
  displayName: string;
  contactName: string | null;
  phones: string[] | null;
  email: string | null;
  sourceAddress: string | null;
  notes: string | null;
};

function invalid(): never {
  throw new VendorDraftError('invalid-input');
}

function optionalText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') invalid();
  const text = value.trim();
  if (text === '') return null;
  if ([...text].length > max) invalid();
  return text;
}

// The create form sends the phone entry list from a one-per-line control; a plain string
// is read as that same one-entry-per-line list. An empty line is not a recorded phone, so
// it is dropped rather than stored; a blank element that reaches the database directly is
// rejected there.
function phoneEntries(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  const entries =
    typeof value === 'string'
      ? value.split(/\r?\n/)
      : Array.isArray(value)
        ? value
        : invalid();
  const phones: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== 'string') invalid();
    const text = entry.trim();
    if (text === '') continue;
    if ([...text].length > VENDOR_PHONE_MAX_LENGTH) invalid();
    phones.push(text);
  }
  if (phones.length === 0) return null;
  if (phones.length > VENDOR_PHONE_MAX_COUNT) invalid();
  return phones;
}

export function vendorDraft(body: Record<string, unknown>): VendorDraft {
  if (Object.keys(body).some((key) => !draftKeys.includes(key as never)))
    invalid();
  if (typeof body.key !== 'string' || !uuidPattern.test(body.key)) invalid();
  if (typeof body.displayName !== 'string') invalid();
  const displayName = body.displayName.trim();
  if (
    [...displayName].length < 1 ||
    [...displayName].length > VENDOR_NAME_MAX_LENGTH
  )
    invalid();
  const email = optionalText(body.email, VENDOR_EMAIL_MAX_LENGTH);
  if (email !== null && !emailPattern.test(email)) invalid();
  return {
    key: body.key,
    displayName,
    contactName: optionalText(body.contactName, VENDOR_CONTACT_NAME_MAX_LENGTH),
    phones: phoneEntries(body.phones),
    email,
    sourceAddress: optionalText(
      body.sourceAddress,
      VENDOR_SOURCE_ADDRESS_MAX_LENGTH,
    ),
    notes: optionalText(body.notes, VENDOR_NOTES_MAX_LENGTH),
  };
}
