import { cookies } from 'next/headers';
import { AuthScreen } from '@/features/employees/auth-screen';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const [jar, params] = await Promise.all([cookies(), searchParams]);
  const locale =
    params.lang === 'en' || params.lang === 'vi'
      ? params.lang
      : jar.get('sgn-locale')?.value === 'en'
        ? 'en'
        : 'vi';
  return <AuthScreen initialLocale={locale} />;
}
