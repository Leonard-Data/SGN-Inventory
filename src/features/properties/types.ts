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
// A pending request never reserves the property; only an approved, unexpired reservation is
// effective and it carries the claimant and the expiry the browser displays.
export type EffectiveReservation = {
  id: string;
  claimantId: string;
  claimantName: string;
  decidedAt: string;
  expiresAt: string;
};
export type ReservationRequest = {
  id: string;
  claimantId: string;
  claimantName: string;
  reason: string;
  requestedAt: string;
  expiresAt: string;
};
export type ReservationState = {
  effective: EffectiveReservation | null;
  pending: ReservationRequest[];
  canDecide: boolean;
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
