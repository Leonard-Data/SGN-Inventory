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
export function formatDecimal(value: string, locale: Locale): string {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value))
    throw new Error('Exact decimal string required');
  const [whole, fraction] = value.split('.');
  return (
    numberFormats[locale].format(BigInt(whole!)) +
    (fraction ? (locale === 'vi' ? ',' : '.') + fraction : '')
  );
}
export function vietnamTimestamp(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
export function vietnamDate(value: string): string {
  const parts = dateFormat.formatToParts(new Date(value));
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
