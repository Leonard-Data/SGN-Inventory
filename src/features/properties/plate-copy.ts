import type { Locale } from '@/i18n/messages';

const copy = {
  site: ['Sơ đồ lô đất', 'Plot diagram'],
  unit: ['Diện tích sàn', 'Floor area'],
  land: ['Lô đất', 'Plot'],
  dims: ['Mặt tiền × sâu', 'Frontage × depth'],
  built: ['Xây dựng', 'Built'],
  density: ['Mật độ', 'Coverage'],
  open: ['Trống', 'Open'],
  north: ['B', 'N'],
  scale: ['m', 'm'],
  caption: [
    'Minh họa từ dữ liệu hồ sơ, không phải bản vẽ khảo sát.',
    'Illustration from record data, not a survey drawing.',
  ],
  noData: ['Chưa có dữ liệu lô đất', 'No plot data'],
  ariaPlot: ['Sơ đồ lô đất', 'Plot diagram'],
  ariaUnit: ['Sơ đồ diện tích sàn', 'Floor-area diagram'],
  ariaPlotDim: ['mặt tiền {w} m, sâu {d} m', 'frontage {w} m, depth {d} m'],
  ariaBuilt: ['xây dựng {a} m²', 'built {a} m²'],
  ariaDerived: [
    'kích thước suy ra từ diện tích',
    'dimensions derived from area',
  ],
} as const;

export type PlateCopyKey = keyof typeof copy;

export function plateCopy(locale: Locale): Record<PlateCopyKey, string> {
  return Object.fromEntries(
    Object.entries(copy).map(([key, [vi, en]]) => [
      key,
      locale === 'vi' ? vi : en,
    ]),
  ) as Record<PlateCopyKey, string>;
}
