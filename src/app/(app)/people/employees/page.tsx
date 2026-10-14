import { cookies } from 'next/headers';
import { EmployeeDirectory } from '@/features/employees/employee-directory';

export default async function PeopleEmployees({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  // The cursor passes through unchanged: the read rejects a malformed one rather than
  // silently showing the first page.
  return (
    <EmployeeDirectory initialLocale={locale} after={params.after ?? null} />
  );
}
