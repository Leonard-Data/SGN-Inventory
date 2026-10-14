import { cookies } from 'next/headers';
import { VendorDetailView } from '@/features/vendors/detail-view';

export default async function VendorRecord({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  // The identifier passes through unchanged; the read validates it as a UUID.
  return <VendorDetailView id={id} initialLocale={locale} />;
}
