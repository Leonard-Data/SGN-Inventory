import { cookies } from 'next/headers';
import { InviteScreen } from '@/features/employees/invite-screen';

// The fixed application destination an invitation email points at (issue #68). The invitation
// link's own parameters are never read here: nothing is verified, displayed or logged, and no
// access, acceptance or delivery is claimed.
export default async function Invite() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <InviteScreen initialLocale={locale} />;
}
