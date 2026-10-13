import { cookies } from 'next/headers';
import { CorrectionRequests } from '@/features/corrections/requests';

export default async function CorrectionRequestsPage() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <CorrectionRequests locale={locale} />;
}
