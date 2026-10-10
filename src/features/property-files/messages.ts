import type { Locale } from '@/i18n/messages';

const vi = {
  files: 'Tập tin đính kèm',
  noFiles: 'Chưa có tập tin đính kèm.',
  open: 'Mở',
  download: 'Tải xuống',
  signingFile: 'Đang lấy liên kết…',
  signedFailed: 'Không lấy được liên kết tập tin. Vui lòng thử lại.',
} as const;

const en: Record<keyof typeof vi, string> = {
  files: 'Attached files',
  noFiles: 'No attached files.',
  open: 'Open',
  download: 'Download',
  signingFile: 'Obtaining link…',
  signedFailed: 'Unable to obtain file link. Please retry.',
};

export const fileMessages: Record<Locale, Record<keyof typeof vi, string>> = {
  vi,
  en,
};
