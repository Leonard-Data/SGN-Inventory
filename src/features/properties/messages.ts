import type { Locale } from '@/i18n/messages';

const vi = {
  back: 'Về kết quả',
  tabOverview: 'Tổng quan',
  tabDocs: 'Tài liệu',
  tabComments: 'Thảo luận',
  facts: 'Thông tin hồ sơ',
  addresses: 'Địa chỉ',
  contacts: 'Liên hệ chủ nhà / môi giới',
  addrNote:
    'Địa chỉ gốc được giữ nguyên; đính chính tạo bản kế tiếp. Chỉ thay đổi giá chào được ghi vào lịch sử.',
  contactPrimary: 'Liên hệ chính',
  contactConsent: 'Đồng ý nhận liên hệ từ Saigon New House',
  contactSource: 'Nguồn giới thiệu hồ sơ',
  noAddresses: 'Chưa có địa chỉ được ghi nhận.',
  noContacts: 'Chưa có liên kết liên hệ được ghi nhận.',
  owner: 'Chủ nhà',
  agent: 'Môi giới',
  representative: 'Đại diện',
  primary: 'Liên hệ chính',
  recordActions: 'Thao tác hồ sơ',
  myRequests: 'Yêu cầu của tôi',
  // A shared address is stated, and the comparison is the only way to a merge.
  sharedAddressCount: 'Hồ sơ khác cùng địa chỉ: {n}.',
  compare: 'So sánh',
  compareTitle: 'So sánh hồ sơ cùng địa chỉ',
  compareNote:
    'Các hồ sơ dưới đây có cùng văn bản địa chỉ đã ghi nhận. Chỉ quản lý hoặc quản trị được gộp hồ sơ.',
  recordColumn: 'Hồ sơ',
  dimensions: 'Kích thước',
  keepBadge: 'Hồ sơ giữ lại',
  keepBoth: 'Giữ cả hai',
  mergeStart: 'Gộp hồ sơ',
  mergeConfirm: 'Gộp {merged} vào {keep}?',
  mergeWarning:
    'Ảnh, tài liệu, lịch sử giá và liên hệ chủ nhà của các hồ sơ được gộp chuyển sang hồ sơ giữ lại. Các hồ sơ còn lại được lưu trữ và không còn hiện là trùng địa chỉ. Ứng dụng không hoàn tác được thao tác này.',
  mergeConfirmAction: 'Xác nhận gộp',
  mergeDone: 'Đã gộp {merged} vào {keep}.',
  mergeMoved:
    'Đã chuyển {files} tệp, {links} liên hệ chủ nhà và {history} mục lịch sử.',
  mergeShared: 'Liên hệ đã có trên hồ sơ giữ lại: {n}.',
  mergeRetired: 'Đã lưu trữ {merged}.',
  mergeDenied: 'Chỉ quản lý hoặc quản trị được gộp hồ sơ cùng địa chỉ.',
  mergeTarget:
    'Hồ sơ giữ lại phải là hồ sơ đầy đủ nhất trong nhóm. Mở lại so sánh để cập nhật.',
  addressMismatch:
    'Các hồ sơ không còn dùng cùng địa chỉ. Mở lại so sánh để cập nhật.',
  fileMoveIncomplete:
    'Chưa chuyển xong tệp của hồ sơ được gộp. Chưa có thay đổi nào được lưu.',
  reservationConflict:
    'Một hồ sơ được gộp đang có đặt chỗ đã duyệt. Xử lý đặt chỗ trước.',
  rentalActive:
    'Một hồ sơ được gộp đang có hợp đồng thuê hiệu lực. Kết thúc hợp đồng trước.',
  location: 'Vị trí',
  locationRecorded: 'Vị trí đã ghi',
  noLocation: 'Chưa ghi nhận vị trí trên bản đồ.',
  openInMap: 'Mở trong bản đồ',
  mapUnavailable: 'Không tải được nền bản đồ. Dùng liên kết mở bản đồ.',
};

const en: Record<keyof typeof vi, string> = {
  back: 'Back to results',
  tabOverview: 'Overview',
  tabDocs: 'Documents',
  tabComments: 'Discussion',
  facts: 'Record facts',
  addresses: 'Addresses',
  contacts: 'Owner / agent contacts',
  addrNote:
    'Original addresses are retained; corrections create a successor. Only asking-price changes are recorded in history.',
  contactPrimary: 'Primary contact',
  contactConsent: 'Consented to contact by Saigon New House',
  contactSource: 'Referral source for this record',
  noAddresses: 'No addresses recorded.',
  noContacts: 'No contact links recorded.',
  owner: 'Owner',
  agent: 'Agent',
  representative: 'Representative',
  primary: 'Primary contact',
  recordActions: 'Record actions',
  myRequests: 'My requests',
  sharedAddressCount: 'Other properties at this address: {n}.',
  compare: 'Compare',
  compareTitle: 'Compare records at one address',
  compareNote:
    'These records carry the same recorded address. Only a manager or admin can merge records.',
  recordColumn: 'Record',
  dimensions: 'Dimensions',
  keepBadge: 'Record kept',
  keepBoth: 'Keep both',
  mergeStart: 'Merge records',
  mergeConfirm: 'Merge {merged} into {keep}?',
  mergeWarning:
    'The merged records’ photos, documents, price history and owner links move to the record kept. The merged-away records are archived and stop reporting as duplicates. The app cannot undo this.',
  mergeConfirmAction: 'Confirm merge',
  mergeDone: 'Merged {merged} into {keep}.',
  mergeMoved:
    'Moved {files} files, {links} owner links and {history} price changes.',
  mergeShared: 'Owner links already on the kept record: {n}.',
  mergeRetired: 'Archived {merged}.',
  mergeDenied: 'Only a manager or admin can merge records at a shared address.',
  mergeTarget:
    'The record kept must be the most complete one in the group. Reopen the comparison.',
  addressMismatch:
    'The records no longer share this address. Reopen the comparison.',
  fileMoveIncomplete:
    'The merged records’ files were not fully moved. Nothing was saved.',
  reservationConflict:
    'One of the merged records holds an approved reservation. Resolve it first.',
  rentalActive:
    'One of the merged records has a live rental agreement. End it first.',
  location: 'Location',
  locationRecorded: 'Recorded location',
  noLocation: 'No location recorded on the map.',
  openInMap: 'Open in map',
  mapUnavailable:
    'The map background could not load. Use the open-in-map link.',
};

export const detailMessages: Record<Locale, Record<keyof typeof vi, string>> = {
  vi,
  en,
};
