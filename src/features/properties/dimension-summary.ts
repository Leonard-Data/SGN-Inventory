import { messages, type Locale } from '../../i18n/messages.ts';
import { formatDecimal } from './format.ts';

// The comparison lists the fields two records can disagree on; each recorded frontage and depth
// is rendered with its own label, paired when both exist, so an unpaired value is never dropped.
export function dimensions(
  member: {
    frontageM: string | null;
    depthM: string | null;
    landAreaM2: string | null;
  },
  locale: Locale,
): string | null {
  const text = messages[locale];
  const frontage =
    member.frontageM === null ? null : formatDecimal(member.frontageM, locale);
  const depth =
    member.depthM === null ? null : formatDecimal(member.depthM, locale);
  const land =
    member.landAreaM2 === null
      ? null
      : formatDecimal(member.landAreaM2, locale);
  const size =
    frontage && depth
      ? `${frontage} × ${depth} m`
      : frontage
        ? `${text.frontage} ${frontage} m`
        : depth
          ? `${text.depth} ${depth} m`
          : null;
  return [size, land ? `${land} m²` : null].filter(Boolean).join(' · ') || null;
}
