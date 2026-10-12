import { cookies } from 'next/headers';
import { AuthScreen } from '@/features/employees/auth-screen';
export default async function AccessDenied() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <AuthScreen initialLocale={locale} denied />;
}
