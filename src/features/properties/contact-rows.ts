import type { PropertyDetail } from './detail-data';

export type ContactLink = PropertyDetail['contacts'][number];

// What an ordinary contact row may present. A property's recorded owner phone is withheld on
// every automatic surface: it is shown only by the deliberate Show owner contact disclosure
// (issue #29), so opening, refocusing or switching language never presents it.
export type ContactPhone =
  { show: true; text: string | null } | { show: false };

export type ContactRow = {
  id: string;
  name: string | null;
  relation: string;
  isPrimary: boolean;
  phone: ContactPhone;
};

// One projection for every contact surface (the overview panel and the sticky card), so the
// owner rule cannot survive in one of them. Withheld rows carry no phone text at all, so no
// renderer can show the owner phone by accident, and a shared contact that is an owner here
// keeps the phone withheld even when another row of the same property names it as broker.
export function contactRows(links: readonly ContactLink[]): ContactRow[] {
  const owners = new Set(
    links
      .filter((link) => link.relation === 'owner')
      .map((link) => link.contact_id),
  );
  return links.map((link) => ({
    id: link.contacts?.id ?? link.contact_id,
    name: link.contacts?.display_name ?? null,
    relation: link.relation,
    isPrimary: link.is_primary,
    phone: owners.has(link.contact_id)
      ? { show: false }
      : { show: true, text: link.contacts?.raw_phone_text ?? null },
  }));
}
