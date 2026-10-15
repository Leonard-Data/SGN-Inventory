import { cookies } from 'next/headers';
import { VendorDirectory } from '@/features/vendors/directory-view';

export default async function PeopleVendors({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; before?: string; beforeId?: string }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  // The search text and cursor pass through unchanged: the read rejects a malformed
  // cursor or an over-long query rather than silently showing the first page.
  return (
    <VendorDirectory
      initialLocale={locale}
      query={params.query ?? null}
      before={params.before ?? null}
      beforeId={params.beforeId ?? null}
    />
  );
}
