import type { Json } from '@/types/database';

// An asking-price row is derived from one recorded property_history event. The two price
// fields are recorded and reported separately, and only an exact whole-VND string becomes a
// figure: anything else is reported as no value rather than rounded or guessed.
export const PRICE_FIELDS = ['sale_price_vnd', 'monthly_rent_vnd'] as const;
export type PriceField = (typeof PRICE_FIELDS)[number];
export type PriceChange = {
  key: string;
  occurredAt: string;
  actorName: string;
  field: PriceField;
  before: string | null;
  after: string | null;
};
type HistoryEvent = {
  id: string;
  occurred_at: string;
  actor_name: string;
  changed_fields: string[];
  before_values: Json;
  after_values: Json;
};
export function recordedVnd(value: Json): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}
export function priceChanges(event: HistoryEvent): PriceChange[] {
  const before = event.before_values,
    after = event.after_values;
  return PRICE_FIELDS.filter((field) =>
    event.changed_fields.includes(field),
  ).map((field) => ({
    key: event.id + ':' + field,
    occurredAt: event.occurred_at,
    actorName: event.actor_name,
    field,
    before: recordedVnd(
      before && typeof before === 'object' && !Array.isArray(before)
        ? ((before as Record<string, Json>)[field] ?? null)
        : null,
    ),
    after: recordedVnd(
      after && typeof after === 'object' && !Array.isArray(after)
        ? ((after as Record<string, Json>)[field] ?? null)
        : null,
    ),
  }));
}
// A price-only change is named by the price it moved; a change that moved both, or neither,
// is named by its target so the timeline never claims one price moved when both did.
export function priceFieldChanged(changedFields: string[]): PriceField | null {
  const moved = PRICE_FIELDS.filter((field) => changedFields.includes(field));
  return moved.length === 1 ? moved[0]! : null;
}
