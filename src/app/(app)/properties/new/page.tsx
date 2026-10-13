import { cookies } from 'next/headers';
import { NewProperty } from '@/features/property-maintenance/new-property';

export default async function NewPropertyPage() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <NewProperty locale={locale} />;
}
