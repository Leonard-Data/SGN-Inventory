import { cookies } from 'next/headers';
import { ContactDirectory } from '@/features/contacts/directory-view';

export default async function PeopleContacts({
  searchParams,
}: {
  searchParams: Promise<{ query?: string; view?: string }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  // The directory is one stream of windows now, so the address carries no page and no cursor:
  // the search text and the recorded view name the one read every window is a slice of, and a
  // different search or view starts the stream again at its first window.
  return (
    <ContactDirectory
      initialLocale={locale}
      query={params.query ?? null}
      view={params.view ?? null}
    />
  );
}
