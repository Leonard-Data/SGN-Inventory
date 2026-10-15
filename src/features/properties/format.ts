type Locale = 'vi' | 'en';
const numberFormats = {
  vi: new Intl.NumberFormat('vi-VN'),
  en: new Intl.NumberFormat('en-GB'),
};
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Ho_Chi_Minh',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
export function formatVnd(value: string, locale: Locale): string {
  if (!/^\d+$/.test(value))
    throw new Error('Whole VND decimal string required');
  return numberFormats[locale].format(BigInt(value)) + ' VND';
}
// A whole count the database derived (an inventory age in days) is never parsed from text,
// so no locale number string can turn it into a different day count.
export function formatInteger(value: number, locale: Locale): string {
  if (!Number.isInteger(value) || value < 0)
    throw new Error('Non-negative integer required');
  return numberFormats[locale].format(value);
}
export function formatDecimal(value: string, locale: Locale): string {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error('Exact decimal string required');
  const [whole, fraction] = value.split('.');
  return (
    numberFormats[locale].format(BigInt(whole!)) +
    (fraction ? (locale === 'vi' ? ',' : '.') + fraction : '')
  );
}
export function vietnamTimestamp(
  value: string | null | undefined,
  locale: Locale,
): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
// A recorded date is optional in this domain (an address may carry no effective date,
// and imported rows may have none), so the formatters report "no value" instead of
// throwing on an unparseable one: the caller renders the unknown marker.
function parseDate(value: string | null | undefined): Date | null {
  const date = new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? null : date;
}
export function vietnamDate(value: string | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const parts = dateFormat.formatToParts(date);
  return ['day', 'month', 'year']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('/');
}
// Only a recorded entry that looks like one plausible number becomes a dialer link; two
// numbers or masked text must not be concatenated into a fabricated dial target.
export function dialableNumber(phone: string): string | null {
  const trimmed = phone.trim();
  if (!/^\+?[0-9\s().-]+$/.test(trimmed)) return null;
  const dialable = trimmed.replace(/[^\d+]/g, '');
  const digits = (dialable.match(/\d/g) ?? []).length;
  return digits >= 8 && digits <= 15 ? dialable : null;
}
