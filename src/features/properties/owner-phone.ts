import type { OwnerContactDisclosure } from './types';

// What a hidden owner phone reads as. While hidden this mask is the whole value the surface
// holds: the number is not read on open and not kept aside, so no renderer, screen reader or
// copy-paste can recover it.
export const HIDDEN_PHONE = '••• ••• •••';

// What the quick view may present of the owner phone: nothing at all until a deliberate
// disclosure has answered, then the recorded name and the phone exactly as returned. Hiding it
// again drops back to no value, so a hidden number never stays behind in the page text.
export type OwnerPhone =
  { shown: false } | { shown: true; name: string; phone: string };

export function ownerPhoneView(
  disclosure: OwnerContactDisclosure | null,
): OwnerPhone {
  const contact = disclosure?.contact;
  if (!contact || contact.phone.trim() === '') return { shown: false };
  return { shown: true, name: contact.displayName, phone: contact.phone };
}
