// The Vendor domain identity (#73): one company record with one optional contact block.
// A recorded detail is a string (or its verbatim phone strings); an unknown optional
// detail is null and is never presented as an empty recorded value.
export type Vendor = {
  id: string;
  displayName: string;
  contactName: string | null;
  phones: string[] | null;
  email: string | null;
  sourceAddress: string | null;
  notes: string | null;
  createdAt: string;
};

// Newest-recorded-first keyset cursor: the pair recorded on the last row of the page.
export type VendorCursor = { before: string; beforeId: string };

export type VendorPage = {
  vendors: Vendor[];
  nextCursor: VendorCursor | null;
};

// One property's recorded vendor relationship: the company block plus the link revision
// the unlink operation checks. A link carries no owner marker and no occupancy state.
export type VendorLink = {
  vendorId: string;
  revision: string;
  displayName: string;
  contactName: string | null;
  phones: string[] | null;
  email: string | null;
  linkedAt: string;
};

// One authorized linked property of a vendor. `more` reports that the bounded projection
// was cut short rather than silently presenting a partial reach as the whole.
export type VendorLinkedProperty = {
  propertyId: string;
  propertyCode: string;
  status: string;
  archivedAt: string | null;
  linkedAt: string;
};

export type VendorLinkedProperties = {
  properties: VendorLinkedProperty[];
  more: boolean;
};
