import { cookies } from 'next/headers';
import { ContactDirectory } from '@/features/contacts/directory-view';

export default async function PeopleContacts({
  searchParams,
}: {
  searchParams: Promise<{
    query?: string;
    after?: string;
    view?: string;
  }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  // The search text, id cursor and view pass through unchanged: the read rejects a
  // malformed cursor, an unknown view or an over-long query rather than silently showing
  // the first page of the wrong view.
  return (
    <ContactDirectory
      initialLocale={locale}
      query={params.query ?? null}
      after={params.after ?? null}
      view={params.view ?? null}
    />
  );
}
