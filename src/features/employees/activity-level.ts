// Colour band rule for the province owner-contact table (#35). Bands are relative to the
// largest group in the same report, so they compare activity inside one selected period
// instead of pretending to be a fixed company threshold. Colour never carries the meaning
// alone: every row prints its exact count and the band's localized text label beside it.
export type ActivityLevel = 'none' | 'low' | 'medium' | 'high';

export function activityLevel(count: number, largest: number): ActivityLevel {
  if (!Number.isFinite(count) || count <= 0) return 'none';
  if (!Number.isFinite(largest) || largest <= 0) return 'none';
  // Integer comparison, so no rounding or floating-point boundary decides a band.
  if (count * 3 >= largest * 2) return 'high';
  if (count * 3 >= largest) return 'medium';
  return 'low';
}
