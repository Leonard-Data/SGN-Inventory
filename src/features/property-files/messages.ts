import type { Locale } from '@/i18n/messages';

const vi = {
  files: 'Tập tin đính kèm',
  noFiles: 'Chưa có tập tin đính kèm.',
  open: 'Mở',
  download: 'Tải xuống',
  signingFile: 'Đang lấy liên kết…',
  signedFailed: 'Không lấy được liên kết tập tin. Vui lòng thử lại.',
  availabilityNote: 'Tập tin hiển thị không xác nhận quyền sở hữu pháp lý hoặc tính xác thực pháp lý.',
  // document_type labels — six fixed types
  image: 'Hình ảnh',
  contract: 'Hợp đồng',
  certificate: 'Chứng chỉ',
  identification: 'Giấy tờ tùy thân',
  report: 'Báo cáo',
  other: 'Khác',
} as const;

const en: Record<keyof typeof vi, string> = {
  files: 'Attached files',
  noFiles: 'No attached files.',
  open: 'Open',
  download: 'Download',
  signingFile: 'Obtaining link…',
  signedFailed: 'Unable to obtain file link. Please retry.',
  availabilityNote: 'Displayed files do not confirm legal ownership or legal authenticity.',
  image: 'Image',
  contract: 'Contract',
  certificate: 'Certificate',
  identification: 'Identification',
  report: 'Report',
  other: 'Other',
};

export const fileMessages: Record<Locale, Record<keyof typeof vi, string>> = {
  vi,
  en,
};
