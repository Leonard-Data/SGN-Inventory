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
export function vietnamDate(value: string): string {
  const parts = dateFormat.formatToParts(new Date(value));
  return ['day', 'month', 'year']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('/');
}
