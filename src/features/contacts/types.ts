// One recorded shared Contact identity as the directory presents it. `links` is the
// caller's readable Property contact set: a relationship is property-scoped, so the same
// identity may appear as an owner on one property and a broker on another.
export type ContactLink = {
  propertyId: string;
  propertyCode: string;
  relation: string;
  isPrimary: boolean;
};

export type ContactSummary = {
  id: string;
  displayName: string;
  contactType: string;
  phones: string[];
  rawPhoneText: string | null;
  revision: string;
  links: ContactLink[];
};

export type ContactView = 'all' | 'owners';

export type ContactPage = {
  contacts: ContactSummary[];
  nextCursor: string | null;
};
