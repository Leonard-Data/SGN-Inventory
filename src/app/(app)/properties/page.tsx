import { cookies } from 'next/headers';
import { Inventory } from '@/features/properties/inventory';
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
      // The supplied ordering passes through unchanged so the read rejects an unknown value
      // instead of silently browsing by UUID.
      sort={params.sort ?? null}
    />
  );
}
