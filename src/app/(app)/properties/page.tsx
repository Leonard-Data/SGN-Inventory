import { cookies } from 'next/headers';
import { Inventory } from '@/features/properties/inventory';
import { inventoryFilters } from '@/features/properties/filters';
export default async function Properties({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string;
    after?: string;
    trail?: string;
    sort?: string;
    status?: string;
    mode?: string;
    type?: string;
    priceMin?: string;
    priceMax?: string;
    areaMin?: string;
    areaMax?: string;
  }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  const values: [string, string][] = [];
  for (const [key, value] of Object.entries(params))
    if (typeof value === 'string') values.push([key, value]);
  return (
    <Inventory
      initialLocale={locale}
      initialQuery={params.query ?? ''}
      after={params.after ?? null}
      trail={params.trail ?? ''}
      // The supplied ordering and filters pass through unchanged so the read rejects an
      // unknown value instead of silently browsing different inventory.
      sort={params.sort ?? null}
      filters={inventoryFilters(new URLSearchParams(values))}
    />
  );
}
