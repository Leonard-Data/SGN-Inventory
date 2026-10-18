import { cookies } from 'next/headers';
import { Inventory } from '@/features/properties/inventory';
import { inventoryFilters } from '@/features/properties/filters';
export default async function Properties({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string;
    page?: string;
    pageSize?: string;
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
      // The supplied ordering, page and filters pass through unchanged so the read rejects an
      // unknown or non-numeric value instead of silently browsing a different page of inventory.
      sort={params.sort ?? null}
      page={params.page ?? null}
      pageSize={params.pageSize ?? null}
      filters={inventoryFilters(search)}
    />
  );
}
