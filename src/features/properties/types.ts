export type AddressSummary = {
  id: string;
  format: string;
  addressText: string;
  mappingStatus: string;
  isPrimary: boolean;
  // The address parts the table's own columns state. A legacy address keeps the district it
  // records; a current-format address has none, which the table shows as a missing value rather
  // than as a district it does not have.
  houseNumber: string | null;
  street: string | null;
  commune: string | null;
  district: string | null;
};
import type { InventoryOrder } from './stream';

export type PropertySummary = {
  id: string;
  propertyCode: string;
  listingMode: string;
  status: string;
  // The recorded type, the two recorded prices and the recorded creation and modification times:
  // the table states them and the drawer repeats them.
  propertyType: string;
  salePriceVnd: string | null;
  monthlyRentVnd: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  addresses: AddressSummary[];
  coverFileId: string | null;
  // The recorded original entry date and the database-computed age, returned by the stream read
  // for both orderings but shown only in the chronological views. null entryOn with entrySource
  // 'unknown' is the explicit unknown date.
  entryOn?: string | null;
  entrySource?: string | null;
  ageDays?: number | null;
  // Plot and floor fields the site plate draws from, kept exactly as the
  // database returns them. The stream read casts them to text, so no schema change
  // is needed to carry them.
  frontageM: string | null;
  depthM: string | null;
  landAreaM2: string | null;
  floorAreaM2: string | null;
  floors: number | null;
  direction: string | null;
  accessType: string | null;
  // The display name of the employee the record references as its creator, resolved from
  // that employee row. Null when the creator is missing or no longer resolvable, which the
  // card renders as nothing rather than as a placeholder.
  createdBy: string | null;
};
// One window of the stream: the rows this read answered with, the position they start at, and the
// matching total that arrived on the same read, so the count and the rows cannot describe
// different result sets.
export type PropertyStream = {
  properties: PropertySummary[];
  total: number;
  offset: number;
  order: InventoryOrder | null;
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
// One member of a shared-address group, as the comparison reads it. Owner names are listed the
// way the record's own contact panel lists them; no phone crosses this boundary.
export type AddressGroupMember = {
  id: string;
  propertyCode: string;
  listingMode: string;
  status: string;
  salePriceVnd: string | null;
  landAreaM2: string | null;
  floorAreaM2: string | null;
  frontageM: string | null;
  depthM: string | null;
  owners: string[];
};
// The group is empty for a unique address, so the indicator appears only when it holds a second
// property. keepId names the most complete record, the one a merge would keep.
export type AddressGroup = {
  keepId: string | null;
  members: AddressGroupMember[];
};
export type MergeReport = {
  keep: { id: string; propertyCode: string };
  merged: { id: string; propertyCode: string }[];
  moved: {
    files: number;
    contactLinks: number;
    alreadyLinked: number;
    history: number;
  };
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
