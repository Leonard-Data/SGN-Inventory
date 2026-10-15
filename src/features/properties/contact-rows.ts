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
// renderer can show the owner phone by accident.
export function contactRows(links: readonly ContactLink[]): ContactRow[] {
  return links.map((link) => ({
    id: link.contact_id,
    name: link.contacts?.display_name ?? null,
    relation: link.relation,
    isPrimary: link.is_primary,
    phone:
      link.relation === 'owner'
        ? { show: false }
        : { show: true, text: link.contacts?.raw_phone_text ?? null },
  }));
}
