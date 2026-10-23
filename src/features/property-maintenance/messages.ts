import { label, type Locale } from '../../i18n/messages.ts';
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
    'Địa chỉ hiện tại không có quận/huyện. Nếu chưa có đơn vị chính thức, hãy ghi số nhà hoặc tên đường; nội dung địa chỉ được ghép từ các phần đã ghi khi lưu.',
    'Current addresses have no district. If the official unit is unknown, record a house number or a street; the address text is composed from the parts you record when you save.',
  ],
  legacyHint: [
    'Địa chỉ cũ dùng danh mục trước 2025: chọn quận/huyện, rồi xã/phường cũ. Nội dung địa chỉ được ghép từ số nhà, tên đường, xã/phường, quận/huyện và tỉnh/thành phố khi lưu.',
    'Legacy addresses use the pre-2025 catalog: choose the old district, then ward. The address text is composed from the house number, street, commune, district and province when you save.',
  ],
  // The province is stated, not chosen: the app records one. A record that already stores a province
  // row keeps exactly what it stored, and the form says so rather than silently replacing it: the row
  // is the same official province in the catalog generation the address was recorded in.
  provinceKept: [
    'Địa chỉ này đã ghi tỉnh/thành phố theo danh mục của nó; giá trị đã ghi được giữ nguyên khi lưu.',
    'This address already records the province/city from its own catalog generation; the recorded value is kept when you save.',
  ],
  optional: [
    'Để trống thông tin chưa biết. Giá nhập theo đơn vị tỷ, triệu hoặc VND và được lưu bằng VND nguyên; số đo dùng dấu chấm thập phân, không dấu phân cách hàng nghìn.',
    'Leave unknown facts blank. Prices take a tỷ, triệu or VND unit and are stored as whole VND; dimensions use a decimal point without thousands separators.',
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
  // The pre-create warning: it names what already sits at the address and still lets the person
  // make a second property, because separate units in one building are ordinary.
  duplicateAddressBefore: [
    'Hồ sơ khác cùng địa chỉ: {n}. Mở để xem trước khi tạo thêm.',
    'Other properties at this address: {n}. Open them before creating another.',
  ],
  duplicateAddressHint: [
    'Xem xong vẫn tạo được hồ sơ mới — cả hai sẽ cùng địa chỉ và có thể so sánh sau khi tạo.',
    'You can still create it — both records will share the address and can be compared once created.',
  ],
  createAnyway: ['Vẫn tạo hồ sơ', 'Create anyway'],
  createBack: ['Quay lại chỉnh sửa', 'Back to editing'],
  addressPartsRequired: [
    'Nhập số nhà, tên đường hoặc chọn xã/phường. Chỉ riêng tỉnh/thành phố chưa phải là địa chỉ; chưa có dữ liệu nào được lưu.',
    'Enter a house number, a street, or pick the commune / ward. The province alone is not an address; nothing was saved.',
  ],
  invalid: [
    'Kiểm tra trường bắt buộc, số tiền, số đo và bằng chứng. Không có dữ liệu nào được lưu.',
    'Check required fields, the amounts, dimensions and evidence. Nothing was saved.',
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
  crosswalkCandidate: [
    'Ghi địa chỉ mới (đề xuất)',
    'Record the current address (candidate)',
  ],
  crosswalkCandidateHint: [
    'Chưa xác minh: chỉ ghi sau khi bạn đã đối chiếu. Địa chỉ cũ được giữ nguyên và vẫn là địa chỉ chính.',
    'Unverified: record only after you have checked. The legacy address is kept and stays primary.',
  ],
  crosswalkRecorded: [
    'Đã ghi địa chỉ mới dưới dạng đề xuất, chưa xác minh.',
    'Current address recorded as an unverified candidate.',
  ],
  // Switching an existing address between the two formats is this labelled action, never a change
  // of the format field on an ordinary save.
  convertToCurrent: [
    'Chuyển sang địa chỉ hiện tại',
    'Convert to current address',
  ],
  convertToLegacy: ['Chuyển sang địa chỉ cũ', 'Convert to legacy address'],
  convertHint: [
    'Thao tác riêng, không phải đổi trường loại địa chỉ. Hệ thống ghi thêm một địa chỉ ở dạng còn lại theo bảng chuyển đổi chính thức, dưới dạng đề xuất chưa xác minh. Địa chỉ đang có được giữ nguyên, kể cả nội dung nguồn và các đơn vị đã ghi.',
    'A deliberate action, not a change of the address type field. It records a second address in the other format from the official crosswalk, as an unverified candidate. The address you see is kept exactly as it is, including its source text and recorded units.',
  ],
  convertConfirm: ['Xác nhận chuyển', 'Confirm conversion'],
  converted: [
    'Đã ghi địa chỉ ở dạng còn lại, chưa xác minh; địa chỉ đang có vẫn được giữ nguyên.',
    'The other format address is recorded, unverified; the address you had is kept.',
  ],
  convertUnitsMissing: [
    'Không chuyển được: địa chỉ này chưa ghi phường/xã chính thức nên không có gì để đối chiếu bảng chuyển đổi. Chưa có dữ liệu nào được ghi.',
    'Cannot convert: this address records no official ward, so there is nothing to look up in the crosswalk. Nothing was written.',
  ],
  convertAmbiguous: [
    'Không chuyển được: bảng chuyển đổi không nêu một đơn vị duy nhất cho địa chỉ này (chuyển một phần hoặc nhiều đơn vị). Hãy đối chiếu và đính chính địa chỉ; chưa có dữ liệu nào được ghi.',
    'Cannot convert: the crosswalk names no single unit for this address (a partial transfer, or several units). Reconcile the address and correct it instead; nothing was written.',
  ],
  convertNoCrosswalk: [
    'Không chuyển được: phường/xã đã ghi chưa có dòng nào trong bảng chuyển đổi chính thức, nên chưa có đơn vị ở dạng còn lại để ghi. Địa chỉ đã ghi không sai; chưa có dữ liệu nào được ghi.',
    'Cannot convert: the recorded ward has no row in the official crosswalk yet, so there is no unit in the other format to record. The address you have is not wrong; nothing was written.',
  ],
  convertDuplicate: [
    'Không chuyển được: bất động sản đã có địa chỉ ở dạng này cho cùng địa bàn, nên không ghi thêm bản trùng.',
    'Cannot convert: the property already records an address in this format for the same territory, so no duplicate was written.',
  ],
  convertSuperseded: [
    'Không chuyển được: địa chỉ này đã được đính chính bởi một bản mới hơn. Hãy chuyển đổi bản mới nhất; chưa có dữ liệu nào được ghi.',
    'Cannot convert: a later correction replaced this address. Convert the newest row instead; nothing was written.',
  ],
  convertLevelChange: [
    'Không chuyển được: bảng chuyển đổi ghi nhận đơn vị này ở cấp hành chính khác (ví dụ đặc khu hình thành từ cả một huyện cũ), nên địa chỉ này không diễn đạt được ở dạng còn lại. Địa chỉ đã ghi không sai; chưa có dữ liệu nào được ghi.',
    'Cannot convert: the crosswalk records this unit at a different administrative level (an island special zone formed from a whole old district, for example), so this address cannot be stated in the other format. The address you have is not wrong; nothing was written.',
  ],
  openRecord: ['Mở hồ sơ', 'Open record'],
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
      : code === 'address-parts-required'
        ? text.addressPartsRequired
        : code === 'conflict'
          ? text.conflict
          : code === 'explanation-without-price'
            ? text.correctionExplanationNeedsPrice
            : code === 'invalid-input'
              ? text.invalid
              : code === 'contact-refusal'
                ? text.contactRefusal
                : code === 'crosswalk-units-missing'
                  ? text.convertUnitsMissing
                  : code === 'crosswalk-ambiguous'
                    ? text.convertAmbiguous
                    : code === 'crosswalk-missing'
                      ? text.convertNoCrosswalk
                      : code === 'address-superseded'
                        ? text.convertSuperseded
                        : code === 'crosswalk-level-change'
                          ? text.convertLevelChange
                          : code === 'address-format-duplicate'
                            ? text.convertDuplicate
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
