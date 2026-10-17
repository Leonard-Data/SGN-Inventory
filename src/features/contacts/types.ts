// One recorded shared Contact identity as the directory presents it. `links` is the
// caller's readable Property contact set: a relationship is property-scoped, so the same
// identity may appear as an owner on one property and a broker on another.
export type ContactLink = {
  propertyId: string;
  propertyCode: string;
  relation: string;
  isPrimary: boolean;
  // A readable link on an archived property still reaches the reader, but it is outside the
  // unarchived inventory boundary the contact filter reads.
  archived: boolean;
};

export type ContactSummary = {
  id: string;
  displayName: string;
  contactType: string;
  phones: string[];
  rawPhoneText: string | null;
  revision: string;
  links: ContactLink[];
  // The number of readable, unarchived linked properties, derived from the same `links` the row
  // lists, so the count and the contact-filtered inventory can never disagree. A readable link
  // on an archived property stays listed (labelled) and is never counted. Zero means no
  // unarchived readable link.
  propertyCount: number;
};

export type ContactView = 'all' | 'owners';

export type ContactPage = {
  contacts: ContactSummary[];
  nextCursor: string | null;
};
