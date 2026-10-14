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
