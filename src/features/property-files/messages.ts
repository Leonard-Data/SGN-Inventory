import type { Locale } from '@/i18n/messages';

const vi = {
  files: 'Tập tin đính kèm',
  noFiles: 'Chưa có tập tin đính kèm.',
  open: 'Mở',
  download: 'Tải xuống',
  signingFile: 'Đang lấy liên kết…',
  selectFiles: 'Chọn tập tin',
  purpose: 'Mục đích tập tin',
  document: 'Tài liệu',
  photo: 'Ảnh bất động sản',
  other: 'Khác',
  land_certificate: 'Giấy chứng nhận quyền sử dụng đất',
  sale_contract: 'Hợp đồng mua bán',
  planning: 'Quy hoạch',
  construction_permit: 'Giấy phép xây dựng',
  registering: 'Đang đăng ký…',
  uploading: 'Đang tải lên…',
  validating: 'Đang kiểm tra nội dung…',
  ready: 'Đã hoàn tất',
  failed: 'Chưa hoàn tất',
  uploadNote:
    'PDF, JPEG, PNG hoặc WebP; lớn hơn 0 và tối đa 20 MiB mỗi tập tin. Không ghi đè tập tin đã có.',
  availabilityNote:
    'Tập tin đã kiểm tra kỹ thuật được chia sẻ nội bộ mà không cần duyệt tài liệu. Đây không phải xác minh tính xác thực, quyền sở hữu pháp lý hay quét mã độc.',
};
const en: Record<keyof typeof vi, string> = {
  files: 'Attached files',
  noFiles: 'No attached files.',
  open: 'Open',
  download: 'Download',
  signingFile: 'Obtaining link…',
  selectFiles: 'Select files',
  purpose: 'File purpose',
  document: 'Document',
  photo: 'Property photo',
  other: 'Other',
  land_certificate: 'Land-use certificate',
  sale_contract: 'Sale contract',
  planning: 'Planning',
  construction_permit: 'Construction permit',
  registering: 'Registering…',
  uploading: 'Uploading…',
  validating: 'Checking content…',
  ready: 'Completed',
  failed: 'Not completed',
  uploadNote:
    'PDF, JPEG, PNG or WebP; greater than zero and up to 20 MiB per file. Existing files are never overwritten.',
  availabilityNote:
    'Technically validated files are shared privately without document approval. This is not authenticity or legal ownership verification, or malware scanning.',
};
const errorsVi: Record<string, string> = {
  'unsupported-format':
    'Định dạng không hỗ trợ. Chọn PDF, JPEG, PNG hoặc WebP.',
  'empty-file': 'Tập tin rỗng.',
  'file-too-large': 'Tập tin vượt quá 20 MiB.',
  'unsafe-filename':
    'Tên tập tin không an toàn. Không dùng ký tự đường dẫn hoặc ký tự điều khiển.',
  'invalid-input': 'Kiểm tra tên, định dạng và mục đích tập tin.',
  'invalid-file':
    'Nội dung bị cắt hoặc không phải PDF, JPEG, PNG hay WebP hợp lệ.',
  'file-mismatch':
    'Nội dung, kích thước hoặc mã băm khác với tập tin đã đăng ký. Không ghi đè; đăng ký nội dung thay thế thành tập tin mới.',
  'missing-bytes':
    'Chưa có dữ liệu trong kho lưu trữ. Đăng ký tập tin vẫn được giữ để tiếp tục.',
  'file-conflict':
    'Trạng thái tập tin đã thay đổi. Tải lại trạng thái trước khi tiếp tục.',
  'access-denied': 'Không có quyền thực hiện thao tác này.',
  'not-found': 'Không tìm thấy tập tin hoặc không có quyền đọc.',
};
const errorsEn: Record<keyof typeof errorsVi, string> = {
  'unsupported-format': 'Unsupported format. Choose PDF, JPEG, PNG or WebP.',
  'empty-file': 'The file is empty.',
  'file-too-large': 'The file exceeds 20 MiB.',
  'unsafe-filename':
    'Unsafe filename. Do not use path separators or control characters.',
  'invalid-input': 'Check the filename, format and file purpose.',
  'invalid-file':
    'Content is truncated or is not a valid PDF, JPEG, PNG or WebP.',
  'file-mismatch':
    'Content, size or hash differs from the registration. Never overwrite; register replacement content as a new file.',
  'missing-bytes':
    'No bytes are stored yet. The file registration is retained for recovery.',
  'file-conflict':
    'File state changed. Reload authoritative state before continuing.',
  'access-denied': 'You do not have permission for this operation.',
  'not-found': 'File not found or not accessible.',
};
export const fileMessages: Record<
  Locale,
  typeof en & { errors: Record<string, string> }
> = {
  vi: { ...vi, errors: errorsVi },
  en: { ...en, errors: errorsEn },
};
