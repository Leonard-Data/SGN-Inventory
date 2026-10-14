import { cookies } from 'next/headers';
import { Detail } from '@/features/properties/detail';
export default async function Property({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ id }, query, cookieStore] = await Promise.all([
    params,
    searchParams,
    cookies(),
  ]);
  const locale = cookieStore.get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  const returnTo = query.returnTo?.startsWith('/properties?')
    ? query.returnTo
    : '/properties';
  return <Detail id={id} initialLocale={locale} returnTo={returnTo} />;
}
