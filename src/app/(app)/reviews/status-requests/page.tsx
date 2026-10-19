import { cookies } from 'next/headers';
import { StatusRequestsPage } from '@/features/property-status/page';

export default async function ReviewsStatusRequestsPage() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <StatusRequestsPage locale={locale} />;
}
