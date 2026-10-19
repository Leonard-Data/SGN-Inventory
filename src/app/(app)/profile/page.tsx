import { cookies } from 'next/headers';
import { MyProfile } from '@/features/employees/my-profile';

// The signed-in person's own profile page, reached from the account menu. src/proxy.ts already
// requires live membership for /profile, and the read and write both resolve the subject from
// the session.
export default async function ProfilePage() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <MyProfile initialLocale={locale} />;
}
