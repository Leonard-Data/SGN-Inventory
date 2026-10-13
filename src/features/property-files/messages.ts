import type { Locale } from '@/i18n/messages';

const categoryBase = {
  category: 'Danh mục tập tin',
  otherCategory: 'Khác',
  selectCategory: 'Chọn danh mục…',
  newCategory: 'Danh mục mới',
  createCategory: 'Tạo danh mục',
  categoryName: 'Tên danh mục',
  categoryCreated: 'Đã tạo danh mục',
  categoryRequired: 'Vui lòng nhập tên danh mục.',
};

const vi = {
  ...categoryBase,
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
  recovery: 'Tiếp tục tập tin chưa hoàn tất',
  recoveryNote:
    'Đăng ký tập tin được giữ sau khi tải lại hoặc đăng nhập lại. Sau khi đóng trình duyệt, bạn phải chọn lại tập tin trên máy; trình duyệt không tự khôi phục quyền đọc tập tin đó.',
  reselect: 'Chọn lại nội dung trùng khớp',
  retryValidation: 'Kiểm tra và hoàn tất dữ liệu đã lưu',
  absent:
    'Chưa có dữ liệu được lưu. Chọn lại tập tin có cùng kích thước và mã băm.',
  present: 'Dữ liệu đã tồn tại. Chỉ kiểm tra và hoàn tất; không tải lên lại.',
  unknown:
    'Chưa xác định được trạng thái kho lưu trữ. Tải lại trạng thái trước khi tiếp tục.',
  unusable: 'Đăng ký cũ không thể tiếp tục với các thông tin bất biến hiện có.',
  replacementNote:
    'Nếu nội dung đã lưu không hợp lệ hoặc bạn muốn dùng nội dung khác, chọn tập tin ở phần tải lên để tạo một tập tin mới. Đăng ký cũ được giữ nguyên.',
  uploadNote:
    'PDF, JPEG, PNG hoặc WebP; lớn hơn 0 và tối đa 20 MiB mỗi tập tin. Không ghi đè tập tin đã có.',
  availabilityNote:
    'Tập tin đã kiểm tra kỹ thuật được chia sẻ nội bộ mà không cần duyệt tài liệu. Đây không phải xác minh tính xác thực, quyền sở hữu pháp lý hay quét mã độc.',
  cover: 'Ảnh bìa',
  setCover: 'Chọn làm ảnh bìa',
  replaceCover: 'Thay ảnh bìa',
  clearCover: 'Bỏ chọn ảnh bìa',
  noCover: 'Chưa có ảnh bìa',
  coverPlaceholder: 'Ảnh bìa bất động sản',
  coverLoading: 'Đang tải ảnh bìa…',
  coverImageFailed: 'Không tải được ảnh bìa. Thử lấy liên kết mới.',
  changingCover: 'Đang lưu ảnh bìa…',
  selectedCover: 'Ảnh bìa đã chọn',
  checkPhoto: 'Kiểm tra kỹ thuật ảnh trước khi chọn',
  cardImage: 'Ảnh thẻ hồ sơ',
  cardImageNote:
    'Ảnh được chọn hiển thị trên thẻ hồ sơ trong kho bất động sản.',
  cardImageEmpty:
    'Chưa có ảnh bất động sản nào được đăng. Mở tab Tài liệu để tải lên.',
  save: 'Lưu',
  cancel: 'Hủy',
  changeCategory: 'Đổi danh mục',
  savingCategory: 'Đang lưu…',
};

const en: Record<keyof typeof vi, string> = {
  category: 'Document category',
  otherCategory: 'Other',
  selectCategory: 'Select category…',
  newCategory: 'New category',
  createCategory: 'Create category',
  categoryName: 'Category name',
  categoryCreated: 'Category created',
  categoryRequired: 'Please enter a category name.',
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
  recovery: 'Recover unfinished files',
  recoveryNote:
    'Registrations survive refresh and a new login. After browser closure, reselect the local file: browsers cannot automatically restore access to it.',
  reselect: 'Reselect matching content',
  retryValidation: 'Validate and complete stored bytes',
  absent:
    'No complete object is stored. Reselect content with the registered count and hash.',
  present:
    'Immutable bytes exist. Retry validation/completion only, not another upload.',
  unknown:
    'Storage state is unknown. Reload authoritative state before continuing.',
  unusable:
    'This legacy registration cannot resume with its immutable expectations.',
  replacementNote:
    'For invalid stored bytes or different content, select a file in the upload section to create a new attachment. The original registration is retained.',
  uploadNote:
    'PDF, JPEG, PNG or WebP; greater than zero and up to 20 MiB per file. Existing files are never overwritten.',
  availabilityNote:
    'Technically validated files are shared privately without document approval. This is not authenticity or legal ownership verification, or malware scanning.',
  cover: 'Cover photo',
  setCover: 'Set as cover',
  replaceCover: 'Replace cover',
  clearCover: 'Clear cover',
  noCover: 'No cover selected',
  coverPlaceholder: 'Property cover photo',
  coverLoading: 'Loading cover…',
  coverImageFailed:
    'Could not load the cover. Retry with a newly authorized link.',
  changingCover: 'Saving cover…',
  selectedCover: 'Selected cover',
  checkPhoto: 'Technically validate photo before selection',
  cardImage: 'Card image',
  cardImageNote:
    'The selected image is shown on the record card in the inventory.',
  cardImageEmpty:
    'No property photos have been uploaded. Open the Documents tab to upload one.',
  save: 'Save',
  cancel: 'Cancel',
  changeCategory: 'Change category',
  savingCategory: 'Saving…',
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
  'unknown-object-state':
    'Không xác định được dữ liệu đã lưu hay chưa. Tải lại trạng thái; không tải lên khi chưa rõ.',
  'replacement-required':
    'Đăng ký này không thể tiếp tục. Chọn nội dung thay thế thành một tập tin mới; giữ nguyên đăng ký cũ.',
  'invalid-cover':
    'Chọn ảnh bất động sản đã kiểm tra kỹ thuật và thuộc đúng bất động sản này.',
  'invalid-category': 'Danh mục không hợp lệ.',
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
  'unknown-object-state':
    'The stored object state is unknown. Reload state; do not upload blindly.',
  'replacement-required':
    'This registration cannot resume. Upload replacement content as a new attachment; the original registration is retained.',
  'invalid-cover':
    'Choose a technically validated Property photo belonging to this property.',
  'invalid-category': 'Invalid category.',
};

export const fileMessages: Record<
  Locale,
  typeof en & { errors: Record<string, string> }
> = {
  vi: { ...vi, errors: errorsVi },
  en: { ...en, errors: errorsEn },
};
