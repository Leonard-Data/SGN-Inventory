import { cookies } from 'next/headers';
import { Inventory } from '@/features/properties/inventory';
import { inventoryFilters } from '@/features/properties/filters';
export default async function Properties({
  searchParams,
}: {
  searchParams: Promise<{
    // Next.js delivers a parameter the address states more than once as an array. The list states
    // one value per parameter, so a repeated one is dropped by the loop below rather than read as a
    // value it is not.
    query?: string | string[];
    view?: string | string[];
    sort?: string | string[];
    hide?: string | string[];
    status?: string | string[];
    mode?: string | string[];
    type?: string | string[];
    accessType?: string | string[];
    addressFormat?: string | string[];
    priceMin?: string | string[];
    priceMax?: string | string[];
    areaMin?: string | string[];
    areaMax?: string | string[];
    frontageMin?: string | string[];
    frontageMax?: string | string[];
    depthMin?: string | string[];
    depthMax?: string | string[];
    province?: string | string[];
    district?: string | string[];
    ward?: string | string[];
    contact?: string | string[];
    createdBy?: string | string[];
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
      initialQuery={search.get('query') ?? ''}
      // The supplied view, ordering and filters pass through unchanged so the read rejects an
      // unknown or non-numeric value instead of silently serving a different result set. The list
      // is one stream: a retired page number in a stale address names no window of it, so the
      // stream opens at its first rows.
      view={search.get('view')}
      sort={search.get('sort')}
      // The hidden columns pass through as stated; a name this table does not have is not a
      // column, so it hides nothing rather than reshaping the table.
      hide={search.get('hide')}
      filters={inventoryFilters(search)}
    />
  );
}
