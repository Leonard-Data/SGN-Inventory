import type { Json } from '@/types/database';

function plain(value: Json | undefined): value is Record<string, Json> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// A correction proposal names whole field values, so a reviewer only needs the fields the
// proposal actually names. The observed side is filtered to those same fields and keeps an
// explicit unknown for one that was never recorded. A proposal that is not a plain object
// (or an unreadable one) is passed through unfiltered: the detail never hides evidence it
// cannot diff.
export function changedValues(
  observed: Json,
  proposed: Json,
): { observed: Json; proposed: Json } {
  if (!plain(proposed)) return { observed, proposed };
  const source = plain(observed) ? observed : {};
  return {
    observed: Object.fromEntries(
      Object.keys(proposed).map((key) => [
        key,
        key in source ? source[key] : null,
      ]),
    ),
    proposed,
  };
}
