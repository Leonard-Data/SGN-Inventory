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
