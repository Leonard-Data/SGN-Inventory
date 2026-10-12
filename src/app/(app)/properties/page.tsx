import { cookies } from 'next/headers';
import { Inventory } from '@/features/properties/inventory';
export default async function Properties({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; after?: string; trail?: string }>;
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
    />
  );
}
