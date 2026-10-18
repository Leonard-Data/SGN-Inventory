import { cookies } from 'next/headers';
import { InviteScreen } from '@/features/employees/invite-screen';

// The fixed application destination an invitation email points at (issue #68), now the real
// acceptance journey (issue #69). The invitation link's own fragment is read client-side by
// the setup screen; nothing here claims a delivery or an access outcome.
export default async function Invite() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  return <InviteScreen initialLocale={locale} />;
}
