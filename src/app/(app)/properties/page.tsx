import { cookies } from 'next/headers';
import { Inventory } from '@/features/properties/inventory';
import { isInventoryOrder } from '@/features/properties/age-cursor';
export default async function Properties({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string;
    after?: string;
    trail?: string;
    sort?: string;
  }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return (
    <Inventory
      initialLocale={locale}
      initialQuery={params.query ?? ''}
      after={params.after ?? null}
      trail={params.trail ?? ''}
      // An unknown ordering falls back to the ordinary browse; the API still rejects it.
      sort={isInventoryOrder(params.sort) ? params.sort : null}
    />
  );
}
