export type AddressSummary = {
  id: string;
  format: string;
  addressText: string;
  mappingStatus: string;
  isPrimary: boolean;
};
export type PropertySummary = {
  id: string;
  propertyCode: string;
  listingMode: string;
  status: string;
  addresses: AddressSummary[];
  coverFileId: string | null;
};
export type PropertyPage = {
  properties: PropertySummary[];
  nextCursor: string | null;
};
// The database returns the disclosure contact and the committed activity reference. A matched
// retry can return the reference without a contact when the owner link was later removed.
export type OwnerContactDisclosure = {
  eventId: string | null;
  businessDay: string;
  credited: boolean;
  contact: {
    id: string;
    displayName: string;
    relation: string;
    isPrimary: boolean;
    phone: string;
  } | null;
};
