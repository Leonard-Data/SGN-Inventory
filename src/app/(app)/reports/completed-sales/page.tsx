import { cookies } from 'next/headers';
import { CompletedSaleRanking } from '@/features/sales/ranking';
import { defaultRange, vietnamToday } from '@/features/employees/report-range';

export default async function CompletedSalesReport({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const locale =
    (await cookies()).get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
  const today = vietnamToday();
  // Default to today and the preceding 29 Vietnam calendar days; supplied values pass through
  // unchanged so an invalid range is rejected by the report read, never shown as zeros.
  const initial =
    params.from || params.to
      ? { from: params.from ?? '', to: params.to ?? '' }
      : defaultRange(today);
  return (
    <CompletedSaleRanking
      initialLocale={locale}
      initialFrom={initial.from}
      initialTo={initial.to}
    />
  );
}
