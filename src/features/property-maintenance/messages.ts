import { label, type Locale } from '@/i18n/messages';
const copy = {
  yes: ['Có', 'Yes'],
  no: ['Không', 'No'],
  unknown: ['Chưa biết', 'Unknown'],
  create: ['Thêm bất động sản', 'Create property'],
  // The create form's own sections: the record, its address, and the owner the person is
  // describing at that moment.
  formRecord: ['Thông tin bất động sản', 'Property facts'],
  formAddress: ['Địa chỉ', 'Address'],
  formContact: ['Liên hệ chủ sở hữu', 'Owner contact'],
  formContactHint: [
    'Không bắt buộc. Tên và số liên hệ được ghi cùng hồ sơ vừa tạo; để trống cả hai nếu chưa biết.',
    'Optional. The name and number are recorded with the record; leave both blank if unknown.',
  ],
  editFacts: ['Sửa thông tin', 'Edit facts'],
  tabFacts: ['Thông tin bất động sản', 'Property facts'],
  tabAddresses: ['Đính chính địa chỉ', 'Address corrections'],
  tabContacts: ['Đính chính liên hệ', 'Contact corrections'],
  notEditable: [
    'Bạn không có quyền sửa phần này. Gửi yêu cầu đính chính nếu thông tin sai.',
    'You cannot edit this section. Report a correction request if the information is wrong.',
  ],
  newAddress: ['Thêm địa chỉ đã biết', 'Add a known address'],
  correctAddress: ['Đính chính địa chỉ', 'Correct address'],
  preserveSource: [
    'Địa chỉ gốc được giữ nguyên; đính chính tạo bản kế tiếp.',
    'Original addresses are retained; corrections create a successor.',
  ],
  rawCurrent: [
    'Địa chỉ hiện tại không có quận/huyện. Nếu chưa có đơn vị chính thức, lưu nội dung theo nguồn chưa xác minh.',
    'Current addresses have no district. Missing official units do not prevent saving unverified source information.',
  ],
  optional: [
    'Để trống thông tin chưa biết. VND nguyên; số đo dùng dấu chấm thập phân, không dấu phân cách hàng nghìn.',
    'Leave unknown facts blank. Whole VND; dimensions use a decimal point without thousands separators.',
  ],
  save: ['Lưu ngay', 'Save now'],
  saving: ['Đang lưu…', 'Saving…'],
  cancel: ['Hủy chỉnh sửa', 'Cancel editing'],
  saved: ['Đã lưu.', 'Saved.'],
  // Save confirmations: the dialog closes, so the confirmation names what was recorded.
  propertySaved: ['Đã lưu thông tin bất động sản.', 'Property saved.'],
  propertyCreated: ['Đã tạo bất động sản.', 'Property created.'],
  addressSaved: ['Đã lưu địa chỉ.', 'Address saved.'],
  contactSaved: ['Đã lưu người liên hệ.', 'Contact saved.'],
  linkSaved: ['Đã lưu liên kết người liên hệ.', 'Contact link saved.'],
  correctionApplied: ['Đã áp dụng đính chính.', 'Correction applied.'],
  correctionRejected: [
    'Đã từ chối yêu cầu đính chính.',
    'Correction request rejected.',
  ],
  correctionWithdrawn: [
    'Đã rút yêu cầu đính chính.',
    'Correction request withdrawn.',
  ],
  requestSaved: [
    'Đã ghi nhận yêu cầu; dữ liệu kho chưa bị thay đổi.',
    'Request recorded; inventory has not been changed.',
  ],
  noChange: ['Chưa có thay đổi.', 'No changes to save.'],
  invalid: [
    'Kiểm tra trường bắt buộc, giá VND nguyên, số đo và bằng chứng. Không có dữ liệu nào được lưu.',
    'Check required fields, whole-VND prices, dimensions and evidence. Nothing was saved.',
  ],
  unavailable: [
    'Chưa xác nhận được kết quả. Đọc lại thông tin hiện tại trước khi thử lại; không gửi lại tự động.',
    'The outcome could not be confirmed. Read current information before retrying; do not automatically resubmit.',
  ],
  stale: [
    'Thông tin đã thay đổi. Bản nhập vẫn còn; mở dữ liệu hiện tại để đối chiếu và nhập lại rõ ràng. Không tự gộp hay ghi đè.',
    'Information has changed. Your draft remains; open the current record to reconcile and explicitly re-enter. No automatic merge or overwrite.',
  ],
  conflict: [
    'Thay đổi xung đột. Đọc lại dữ liệu hiện tại và đối chiếu.',
    'Conflicting change. Read the current record and reconcile.',
  ],
  current: [
    'Mở thông tin hiện tại (tab mới)',
    'Open current information (new tab)',
  ],
  mapping: ['Chỉ định ánh xạ từ bằng chứng', 'Designate mapping from evidence'],
  mappingHint: [
    'Chỉ quản lý/quản trị viên; cần đơn vị, ngày hiệu lực và bằng chứng của bất động sản. Không cần người duyệt thứ hai.',
    'Manager/admin only; requires official units, effective date and property evidence. No second approver.',
  ],
  catalogEmpty: [
    'Chưa có đơn vị phù hợp trong danh mục; giữ nội dung theo nguồn chưa xác minh.',
    'No matching official units available; keep unverified source information.',
  ],
  // Typed text that names no official unit is never committed, so the picker says so.
  comboboxNoMatch: [
    'Không có đơn vị chính thức nào khớp với nội dung đã gõ.',
    'No official unit matches what you typed.',
  ],
  contacts: [
    'Bảo trì người liên hệ và liên kết',
    'Maintain contacts and links',
  ],
  contactEdit: [
    'Sửa cùng người liên hệ chung',
    'Correct the same shared person',
  ],
  contactImpact: ['Các bất động sản bị ảnh hưởng', 'Affected properties'],
  confirmImpact: [
    'Tôi đã đối chiếu: đây là cùng một người, thay đổi áp dụng cho mọi liên kết nêu trên.',
    'I checked: this is the same person; the change applies to every link shown above.',
  ],
  contactRefusal: [
    'Không sửa được: người liên hệ chung này có thể chưa gắn với bất động sản nào, hoặc đang gắn với bất động sản bạn không được đọc. Nhờ người duyệt (quản lý hoặc quản trị viên) nếu bạn cần sửa; chưa có thay đổi nào được lưu.',
    'Cannot edit: this shared contact is either not linked to any property, or is linked to a property you cannot read. Ask a reviewer (manager or admin) if you need to correct it; nothing was saved.',
  ],
  wrongPerson: [
    'Nhầm người? Thay liên kết tại bất động sản này, không ghi đè người liên hệ chung.',
    'Wrong person? Replace this local link, not the shared identity.',
  ],
  newContact: ['Tạo người liên hệ chung', 'Create shared contact'],
  link: ['Thêm / thay liên kết', 'Add / replace link'],
  unlink: ['Gỡ liên kết này', 'Unlink this relationship'],
  unlinkConfirm: [
    'Gỡ liên kết chỉ tại đây; giữ người liên hệ và các bất động sản khác.',
    'Unlink here only; retain the shared person and other properties.',
  ],
  contactSearch: ['Tìm tên người liên hệ', 'Find contact name'],
  chooseContact: ['Chọn người liên hệ', 'Choose a contact'],
  history: ['Lịch sử thay đổi bất động sản', 'Property change history'],
  historyNote: [
    'Chỉ ghi nhận thay đổi giá chào; thay đổi địa chỉ, người liên hệ và thông tin khác không còn được ghi vào lịch sử này.',
    'Only asking-price changes are recorded; address, contact and other field changes are no longer recorded here.',
  ],
  emptyHistory: [
    'Chưa có thay đổi nghiệp vụ được ghi nhận; lịch sử nhập cũ không được suy đoán.',
    'No recorded business changes yet; imported historical changes are not invented.',
  ],
  priceHistory: ['Giá chào đã ghi', 'Recorded asking price'],
  priceHistoryNote: [
    'Chỉ gồm giá chào đã được ghi; không phải giá bán thực tế, tiền thuê theo hợp đồng hay biên nhận thanh toán. Giá trị chưa ghi là khoảng trống, không phải số 0.',
    'Recorded asking prices only; not achieved sale prices, contractual rent or payment receipts. A value that was never recorded is a gap, not zero.',
  ],
  salePriceSeries: ['Giá bán chào', 'Asking sale price'],
  rentPriceSeries: ['Giá thuê tháng chào', 'Monthly asking rent'],
  perMonth: ['tháng', 'month'],
  emptySalePrices: [
    'Chưa có thay đổi giá bán được ghi nhận; không suy đoán lịch sử nhập cũ.',
    'No recorded sale asking-price changes yet; imported history is not invented.',
  ],
  emptyRentPrices: [
    'Chưa có thay đổi giá thuê được ghi nhận; không suy đoán lịch sử nhập cũ.',
    'No recorded monthly asking-rent changes yet; imported history is not invented.',
  ],
  correctionExplanation: [
    'Giải thích đính chính (không bắt buộc)',
    'Correction explanation (optional)',
  ],
  correctionExplanationHint: [
    'Chỉ áp dụng khi giá bán hoặc giá thuê thay đổi; 10–2000 ký tự; được giữ cùng thay đổi đó.',
    'Applies only when a sale or monthly rent price changes; 10–2000 characters; kept with that change.',
  ],
  correctionExplanationNeedsPrice: [
    'Giải thích đính chính chỉ áp dụng khi có thay đổi giá bán hoặc giá thuê.',
    'A correction explanation applies only when a sale or monthly rent price changes.',
  ],
  before: ['Trước', 'Before'],
  after: ['Sau', 'After'],
  actor: ['Người thực hiện', 'Actor'],
  time: ['Thời gian Việt Nam', 'Vietnam time'],
  explanation: ['Giải thích', 'Explanation'],
  requests: ['Yêu cầu đính chính', 'Correction requests'],
  queue: ['Yêu cầu của tôi / hàng đợi xử lý', 'My requests / processing queue'],
  submit: ['Gửi vấn đề cần đính chính', 'Report a correction issue'],
  issueCategory: ['Loại vấn đề', 'Issue category'],
  issueExplanation: [
    'Mô tả vấn đề (10–2000 ký tự)',
    'Issue explanation (10–2000 characters)',
  ],
  unknownReplacement: [
    'Không cần biết giá trị thay thế. Gửi yêu cầu không sửa dữ liệu và không cấp quyền chỉnh sửa.',
    'Replacement values may be unknown. Submission does not edit inventory or grant editing authority.',
  ],
  target: ['Thông tin bị ảnh hưởng', 'Affected record'],
  newTarget: ['Chưa có địa chỉ / liên kết', 'Missing address / link'],
  amend: ['Bổ sung / đối chiếu đề xuất', 'Amend / reconcile proposal'],
  amendHint: [
    'Đối chiếu với dữ liệu hiện tại; bản gốc vẫn được giữ. Chọn trường thay thế nếu đã biết.',
    'Reconcile with current data; the original remains. Select replacement fields if known.',
  ],
  replacement: [
    'Trường cần thay thế (không bắt buộc)',
    'Replacement field (optional)',
  ],
  latestProposal: ['Đề xuất hiện tại', 'Current proposal'],
  needsUpdate: ['Trường cần đính chính', 'Fields to update'],
  section: ['Phần thông tin', 'Information section'],
  original: ['Đề xuất gốc', 'Original submission'],
  amendments: ['Các bổ sung được giữ lại', 'Retained amendments'],
  observed: ['Thông tin đã quan sát', 'Observed information'],
  proposal: ['Giá trị đề xuất', 'Proposed values'],
  apply: ['Áp dụng và kết thúc', 'Apply and resolve'],
  reject: ['Từ chối với lý do', 'Reject with reason'],
  withdraw: ['Rút yêu cầu của tôi', 'Withdraw my request'],
  reason: [
    'Lý do xử lý (10–2000 ký tự)',
    'Outcome reason (10–2000 characters)',
  ],
  terminal: [
    'Yêu cầu đã kết thúc, không thể áp dụng lại.',
    'This request is closed and cannot be reapplied.',
  ],
  emptyRequests: [
    'Chưa có yêu cầu trong trang này. Có thể báo vấn đề tại chi tiết bất động sản.',
    'No requests on this page. Report an issue from property details.',
  ],
  loading: ['Đang đọc dữ liệu được phép…', 'Reading authorized information…'],
  seriesFailed: [
    'Chưa xác nhận được dòng giá này. Đọc lại trước khi kết luận.',
    'This price series could not be confirmed. Read it again before concluding anything.',
  ],
  refresh: ['Đọc lại', 'Refresh'],
  more: ['Trang tiếp theo', 'Next page'],
  first: ['Trang đầu', 'First page'],
  immediate: [
    'Bảo trì được lưu ngay; chỉ thay đổi giá chào được ghi vào lịch sử. Yêu cầu giữ chỗ vẫn cần phê duyệt độc lập.',
    'Maintenance saves immediately; only asking-price changes are recorded in the history. Reservations still require independent approval.',
  ],
  primary: ['Địa chỉ / liên kết chính', 'Primary address / link'],
  location: ['Vị trí trên bản đồ', 'Location on map'],
  locationHint: [
    'Nhấn vào bản đồ để đặt hoặc di chuyển điểm, hoặc nhập toạ độ và nhấn "Áp dụng toạ độ"; điểm chỉ được lưu cùng các thông tin khác sau khi áp dụng.',
    'Click the map to place or move the point, or type coordinates and press "Apply coordinates"; the point saves with the other facts only after you apply it.',
  ],
  locationMapLabel: [
    'Bản đồ chọn vị trí: nhấn để đặt điểm',
    'Location picker map: click to place the point',
  ],
  locationTyped: ['Hoặc nhập toạ độ', 'Or type coordinates'],
  locationTypedHint: [
    'Vĩ độ từ -90 đến 90, kinh độ từ -180 đến 180, tối đa 7 chữ số thập phân.',
    'Latitude from -90 to 90, longitude from -180 to 180, up to 7 decimal places.',
  ],
  locationApply: ['Áp dụng toạ độ', 'Apply coordinates'],
  locationInvalid: [
    'Toạ độ không hợp lệ: vĩ độ từ -90 đến 90, kinh độ từ -180 đến 180, tối đa 7 chữ số thập phân.',
    'Invalid coordinates: latitude from -90 to 90, longitude from -180 to 180, up to 7 decimal places.',
  ],
  locationClear: ['Xoá vị trí', 'Clear location'],
  locationRecorded: ['Vị trí đã ghi', 'Recorded location'],
  locationNoPoint: ['Chưa đặt vị trí.', 'No point placed.'],
  locationTilesFailed: [
    'Không tải được nền bản đồ. Vẫn có thể nhấn trên khung bản đồ hoặc nhập toạ độ bên dưới.',
    'The map background could not load. You can still click the map area or type coordinates below.',
  ],
} as const;
export type CopyKey = keyof typeof copy;
export function maintenanceText(locale: Locale) {
  return Object.fromEntries(
    Object.entries(copy).map(([key, values]) => [
      key,
      values[locale === 'vi' ? 0 : 1],
    ]),
  ) as Record<CopyKey, string>;
}
export function maintenanceError(locale: Locale, code: string | null) {
  const text = maintenanceText(locale);
  return code === 'noChange'
    ? text.noChange
    : code === 'stale-edit'
      ? text.stale
      : code === 'conflict'
        ? text.conflict
        : code === 'explanation-without-price'
          ? text.correctionExplanationNeedsPrice
          : code === 'invalid-input'
            ? text.invalid
            : code === 'contact-refusal'
              ? text.contactRefusal
              : text.unavailable;
}
const values: Record<string, readonly [string, string]> = {
  property: ['Thông tin bất động sản', 'Property facts'],
  address: ['Địa chỉ', 'Address'],
  contact: ['Người liên hệ chung', 'Shared contact'],
  link: ['Liên kết người liên hệ', 'Contact link'],
  incorrect: ['Thông tin sai', 'Incorrect information'],
  missing: ['Thiếu thông tin', 'Missing information'],
  other: ['Vấn đề khác', 'Other issue'],
  manual: ['Đối chiếu thủ công có bằng chứng', 'Evidence-based manual mapping'],
  boundary: ['Bằng chứng ranh giới', 'Boundary evidence'],
  document: ['Bằng chứng tài liệu', 'Document evidence'],
  official_whole_mapping: [
    'Chuyển toàn bộ đã đối chiếu',
    'Reviewed whole transfer',
  ],
  individual: ['Cá nhân', 'Individual'],
  joint: ['Đồng sở hữu', 'Joint'],
  organization: ['Tổ chức', 'Organization'],
  buyer: ['Người mua', 'Buyer'],
  tenant: ['Người thuê', 'Tenant'],
  N: ['Bắc', 'North'],
  NE: ['Đông Bắc', 'Northeast'],
  E: ['Đông', 'East'],
  SE: ['Đông Nam', 'Southeast'],
  S: ['Nam', 'South'],
  SW: ['Tây Nam', 'Southwest'],
  W: ['Tây', 'West'],
  NW: ['Tây Bắc', 'Northwest'],
};
export function optionLabel(locale: Locale, value: string) {
  return values[value]?.[locale === 'vi' ? 0 : 1] ?? label(locale, value);
}
const requestStatuses: Record<string, readonly [string, string]> = {
  open: ['Đang mở', 'Open'],
  applied: ['Đã áp dụng', 'Applied'],
  rejected: ['Đã từ chối', 'Rejected'],
  withdrawn: ['Đã rút', 'Withdrawn'],
};
export function requestStatusLabel(locale: Locale, value: string) {
  return (
    requestStatuses[value]?.[locale === 'vi' ? 0 : 1] ?? label(locale, value)
  );
}
