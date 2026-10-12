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
  // Plot and floor fields the site plate draws from, kept exactly as the
  // database returns them. search_properties returns setof public.properties, so
  // these need no schema change.
  frontageM: string | null;
  depthM: string | null;
  landAreaM2: string | null;
  floorAreaM2: string | null;
  floors: number | null;
  direction: string | null;
  accessType: string | null;
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
