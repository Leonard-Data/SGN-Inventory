import { messages } from '../../i18n/messages.ts';

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
// How long "ago" still helps: up to a week the modified time says how long ago it changed, from a
// week on it names the recorded day, because "9 days ago" is harder to place than a date.
export const RELATIVE_DAYS = 7;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_KEYS = {
  minute: ['relativeMinuteAgo', 'relativeMinutesAgo'],
  hour: ['relativeHourAgo', 'relativeHoursAgo'],
  day: ['relativeDayAgo', 'relativeDaysAgo'],
} as const;

export type RelativeTime = {
  // What the cell reads now.
  text: string;
  // The recorded instant, locale-formatted. It never leaves the cell; it stops being the visible
  // text, so the exact moment stays available behind the phrase.
  exact: string;
};

// A modified time reads as how long ago it changed while that still says more than the date does.
// `now` is the browser's clock and is null until the page has hydrated: the server render and the
// first client render then both state the recorded timestamp instead of a phrase built from two
// clocks that may disagree. A stamp in the future is not "in 3 minutes" either: it states the day.
export function relativeTime(
  value: string | null | undefined,
  locale: Locale,
  now: number | null,
): RelativeTime | null {
  const instant = parseDate(value);
  const exact = vietnamTimestamp(value, locale);
  if (!instant || !exact) return null;
  const day = vietnamDate(value)!;
  if (now === null) return { text: exact, exact };
  const elapsed = now - instant.getTime();
  const text = messages[locale];
  if (elapsed < 0) return { text: day, exact };
  if (elapsed < MINUTE_MS) return { text: text.relativeJustNow, exact };
  if (elapsed < HOUR_MS)
    return {
      text: relativePhrase(locale, 'minute', Math.floor(elapsed / MINUTE_MS)),
      exact,
    };
  if (elapsed < DAY_MS)
    return {
      text: relativePhrase(locale, 'hour', Math.floor(elapsed / HOUR_MS)),
      exact,
    };
  const days = Math.floor(elapsed / DAY_MS);
  if (days < RELATIVE_DAYS)
    return { text: relativePhrase(locale, 'day', days), exact };
  return { text: day, exact };
}

function relativePhrase(
  locale: Locale,
  unit: keyof typeof RELATIVE_KEYS,
  count: number,
): string {
  const [one, many] = RELATIVE_KEYS[unit];
  return messages[locale][count === 1 ? one : many].replace(
    '{n}',
    String(count),
  );
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
