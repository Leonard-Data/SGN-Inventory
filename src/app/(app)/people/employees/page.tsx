import { cookies } from 'next/headers';
import { EmployeeDirectory } from '@/features/employees/employee-directory';

export default async function PeopleEmployees() {
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  // The directory is one stream of windows now, so the address names no page and no cursor: the
  // rows are read as the person scrolls, from the same admin-only read as before.
  return <EmployeeDirectory initialLocale={locale} />;
}
