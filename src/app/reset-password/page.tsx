import { cookies } from 'next/headers';
import { RecoveryScreen } from '@/features/employees/recovery-screen';
export default async function ResetPassword() {
  const store = await cookies();
  return (
    <RecoveryScreen
      initialLocale={store.get('sgn-locale')?.value === 'en' ? 'en' : 'vi'}
      mode="reset"
      invalid={!store.has('sgn-recovery')}
    />
  );
}
