import { cookies } from 'next/headers';
import { RecoveryScreen } from '@/features/employees/recovery-screen';
export default async function Recover({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; lang?: string }>;
}) {
  const [jar, params] = await Promise.all([cookies(), searchParams]);
  const locale =
    params.lang === 'en' || params.lang === 'vi'
      ? params.lang
      : jar.get('sgn-locale')?.value === 'en'
        ? 'en'
        : 'vi';
  return (
    <RecoveryScreen
      initialLocale={locale}
      mode="request"
      invalid={params.error === 'invalid'}
    />
  );
}
