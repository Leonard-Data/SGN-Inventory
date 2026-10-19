import { cookies } from 'next/headers';
import { Inventory } from '@/features/properties/inventory';
import { inventoryFilters } from '@/features/properties/filters';
export default async function Properties({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string;
    view?: string;
    sort?: string;
    status?: string;
    mode?: string;
    type?: string;
    priceMin?: string;
    priceMax?: string;
    areaMin?: string;
    areaMax?: string;
    province?: string;
    ward?: string;
    contact?: string;
  }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  const values: [string, string][] = [];
  for (const [key, value] of Object.entries(params))
    if (typeof value === 'string') values.push([key, value]);
  const search = new URLSearchParams(values);
  return (
    <Inventory
      initialLocale={locale}
      initialQuery={params.query ?? ''}
      // The supplied view, ordering and filters pass through unchanged so the read rejects an
      // unknown or non-numeric value instead of silently serving a different result set. The list
      // is one stream: a retired page number in a stale address names no window of it, so the
      // stream opens at its first rows.
      view={params.view ?? null}
      sort={params.sort ?? null}
      filters={inventoryFilters(search)}
    />
  );
}
