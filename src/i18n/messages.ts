export type Locale = 'vi' | 'en';
const vi = {
  title: 'SGN Inventory',
  inventory: 'Kho bất động sản',
  reports: 'Báo cáo',
  reservationsReviews: 'Đặt chỗ & Duyệt',
  login: 'Đăng nhập',
  email: 'Email',
  password: 'Mật khẩu',
  logout: 'Đăng xuất',
  language: 'Ngôn ngữ',
  viLanguage: 'Tiếng Việt',
  enLanguage: 'English',
  skipToContent: 'Đến nội dung chính',
  loading: 'Đang tải…',
  retry: 'Thử lại',
  denied: 'Không có quyền truy cập',
  deniedHelp:
    'Tài khoản chưa được liên kết với nhân viên đang hoạt động hoặc quyền truy cập đã bị tắt.',
  unavailable: 'Không thể kết nối. Vui lòng thử lại.',
  invalidCredentials: 'Email hoặc mật khẩu không đúng.',
  invalidInput: 'Vui lòng kiểm tra thông tin nhập.',
  empty: 'Không tìm thấy bất động sản.',
  unknown: 'Chưa rõ',
  previous: 'Trang trước',
  next: 'Trang tiếp',
  first: 'Trang đầu',
  listingMode: 'Loại giao dịch',
  status: 'Trạng thái kho',
  address: 'Địa chỉ',
  legacy: 'Địa chỉ cũ',
  current: 'Địa chỉ mới',
  alternate: 'Địa chỉ khác',
  unresolved: 'Chưa xác minh',
  candidate: 'Địa chỉ đề xuất — chưa xác minh',
  verified: 'Đã xác minh địa chỉ',
  sale: 'Bán',
  rent: 'Cho thuê',
  both: 'Bán và cho thuê',
  draft: 'Bản nháp',
  available: 'Đang chào',
  negotiating: 'Đang thương lượng',
  sold: 'Đã bán',
  rented: 'Đã cho thuê',
  withdrawn: 'Ngừng chào',
  archived: 'Hồ sơ lưu trữ — chỉ người quản lý xem',
  search: 'Tìm địa chỉ',
  searchHint:
    'Nhập một đoạn địa chỉ liền nhau; không cần dấu. % và _ là ký tự thường, không phải ký tự đại diện.',
  queryTooLong: 'Địa chỉ tìm kiếm tối đa 120 ký tự.',
  sortLabel: 'Thứ tự theo ngày nhập kho',
  sortDefault: 'Mặc định',
  sortOldest: 'Cũ nhất trước',
  sortNewest: 'Mới nhất trước',
  orderReverse: 'Đảo chiều',
  orderReverseHint: 'Chọn thứ tự theo ngày nhập kho để đảo chiều thứ tự.',
  ageHint:
    'Chỉ gồm hồ sơ đang chào hoặc đang thương lượng, chưa lưu trữ. Thứ tự dùng ngày nhập kho gốc, không đổi khi cập nhật, đổi giá hoặc đăng lại. Hồ sơ chưa xác định ngày nhập kho được liệt kê sau cùng, không bị ẩn.',
  filters: 'Bộ lọc',
  filtersApply: 'Áp dụng bộ lọc',
  filtersClear: 'Xoá bộ lọc',
  filtersRemove: 'Bỏ điều kiện lọc',
  filtersAny: 'Tất cả',
  filtersInvalid: 'Bộ lọc chưa hợp lệ. Kiểm tra lại giá và diện tích đã nhập.',
  priceFilterHint:
    'Không chọn loại giao dịch: mỗi hồ sơ dùng giá chào riêng — hồ sơ cho thuê dùng giá thuê tháng (VND/tháng), còn hồ sơ bán và bán và cho thuê dùng giá bán (nguyên VND). Chọn Bán hoặc Bán và cho thuê để chỉ so sánh giá bán; chọn Cho thuê để chỉ so sánh giá thuê tháng.',
  areaFilterHint:
    'Diện tích khớp khi diện tích đất hoặc diện tích sàn nằm trong khoảng.',
  province: 'Tỉnh / thành phố',
  ward: 'Xã / phường',
  areaAdminHint:
    'Lọc theo tỉnh/thành phố và xã/phường của địa chỉ. Chọn tỉnh/thành phố sẽ gồm mọi xã/phường thuộc tỉnh/thành phố đó; chọn xã/phường sẽ thu hẹp trong xã/phường đó. Khi cả hai được chọn, xã/phường là điều kiện có hiệu lực.',
  areaFilterUnavailable:
    'Chưa tải được danh mục tỉnh/thành phố và xã/phường. Bộ lọc giá và diện tích vẫn dùng được.',
  contactFilter: 'Người liên hệ',
  contactFilterHint:
    'Chỉ gồm người liên hệ bạn được phép đọc. Bộ lọc này kết hợp với các điều kiện khác.',
  contactFilterUnavailable:
    'Chưa tải được danh sách người liên hệ. Các bộ lọc khác vẫn dùng được.',
  priceUnitVnd: 'VND',
  priceUnitMonthly: 'VND/tháng',
  priceRangeFrom: 'Giá từ',
  priceRangeTo: 'Giá đến',
  salePriceFrom: 'Giá bán từ',
  salePriceTo: 'Giá bán đến',
  rentPriceFrom: 'Giá thuê tháng từ',
  rentPriceTo: 'Giá thuê tháng đến',
  areaRangeFrom: 'Diện tích từ',
  areaRangeTo: 'Diện tích đến',
  emptyFiltered: 'Không có bất động sản khớp bộ lọc.',
  entryDate: 'Ngày nhập kho gốc',
  entryDateUnknown: 'Chưa xác định',
  entryDateLegacy: 'Theo hồ sơ gốc',
  entrySourceRecorded: 'Ghi nhận khi tạo hồ sơ',
  entryAge: 'ngày trong kho',
  entryAgeOne: 'ngày trong kho',
  entryAgeUnknown: 'Tuổi kho chưa xác định',
  propertyCode: 'Mã bất động sản',
  details: 'Chi tiết bất động sản',
  back: 'Về kết quả',
  notFound: 'Không tìm thấy bất động sản hoặc không có quyền đọc.',
  propertyType: 'Loại bất động sản',
  accessType: 'Đặc điểm lối vào',
  reviewStatus: 'Đánh giá thông tin',
  legalStatus: 'Tình trạng pháp lý',
  pending: 'Chờ đánh giá',
  approved: 'Đã đánh giá',
  rejected: 'Bị từ chối',
  legalNote: 'Đánh giá nội bộ không xác lập quyền sở hữu pháp lý.',
  owner_reported: 'Chủ nhà cung cấp',
  documents_received: 'Đã nhận tài liệu',
  reviewed: 'Đã xem xét',
  issue_flagged: 'Có vấn đề cần xem xét',
  house: 'Nhà',
  land: 'Đất',
  apartment: 'Căn hộ',
  villa: 'Biệt thự',
  serviced_apartment: 'Căn hộ dịch vụ',
  unclassified: 'Chưa phân loại',
  street_front: 'Mặt tiền đường',
  car_alley: 'Hẻm ô tô',
  motorbike_alley: 'Hẻm xe máy',
  three_wheeler_alley: 'Hẻm ba gác',
  salePrice: 'Giá bán',
  monthlyRent: 'Giá thuê / tháng',
  landArea: 'Diện tích đất',
  floorArea: 'Diện tích sàn',
  frontage: 'Chiều ngang',
  depth: 'Chiều sâu',
  floors: 'Số tầng',
  bedrooms: 'Phòng ngủ',
  bathrooms: 'Phòng tắm',
  direction: 'Hướng',
  contacts: 'Liên hệ chủ nhà / môi giới',
  noContacts: 'Chưa có liên kết liên hệ được ghi nhận.',
  owner: 'Chủ nhà',
  broker: 'Môi giới',
  representative: 'Đại diện',
  primary: 'Liên hệ chính',
  showOwnerContact: 'Hiện liên hệ chủ nhà',
  ownerContactMissing: 'Chưa ghi nhận liên hệ chủ nhà cho bất động sản này.',
  ownerPhoneMissing: 'Liên hệ chủ nhà được ghi nhận chưa có số điện thoại.',
  ownerContactFailed:
    'Chưa hiện được liên hệ chủ nhà. Thử lại dùng lại lượt ghi nhận này, không tạo thêm.',
  ownerContactKeyConflict: 'Lượt ghi nhận này đã dùng cho bất động sản khác.',
  ownerContactUnavailable:
    'Đã ghi nhận lượt mở liên hệ chủ nhà; hiện chưa có số để hiển thị.',
  call: 'Gọi',
  callUnavailable: 'Số đã ghi không đủ để quay số.',
  ownerContactNote:
    'Chỉ hiện sau khi bạn chọn. Mở liên hệ chủ nhà không phải cuộc gọi đã kết nối và không phải lượt thăm bất động sản.',
  noCurrent: 'Chưa có địa chỉ mới được ghi nhận.',
  pageViewFailed:
    'Chưa ghi nhận được lượt xem. Thử lại không tạo lượt xem trùng.',
  pageViewNote:
    'Mở trang chỉ ghi nhận lượt xem, không xác nhận đã thăm bất động sản.',
  todayActivity: 'Hoạt động hôm nay của tôi',
  todayDay: 'Ngày (giờ Việt Nam)',
  todayPageViews: 'Lượt xem trang',
  todayProperties: 'Bất động sản đã xem',
  todayOwnerContacts: 'Bất động sản đã xem liên hệ chủ nhà',
  todayActivityFailed: 'Chưa tải được hoạt động hôm nay.',
  companyActivity: 'Hoạt động của nhân viên theo ngày',
  companyActivityLink: 'Báo cáo hoạt động công ty',
  backToInventory: 'Về kho bất động sản',
  filterFrom: 'Từ ngày',
  filterTo: 'Đến ngày',
  applyFilter: 'Xem báo cáo',
  invalidRange:
    'Khoảng ngày không hợp lệ. Ngày bắt đầu không được sau ngày kết thúc và tối đa 366 ngày.',
  rangeTooLarge:
    'Khoảng ngày {from} – {to} vượt giới hạn 1.000 dòng của báo cáo (giới hạn = số nhân viên đang hoạt động × số ngày). Hãy thu hẹp khoảng ngày.',
  rankingTooLarge:
    'Khoảng ngày {from} – {to} vượt giới hạn 1.000 dòng của bảng xếp hạng (số nhân viên trong phạm vi báo cáo). Hãy thu hẹp khoảng ngày.',
  todaySummary: 'Tổng hợp hôm nay',
  companyHistory: 'Lịch sử theo ngày',
  companyEmployee: 'Nhân viên',
  companyActivityNote:
    'Lượt truy cập liên hệ chủ nhà là số bất động sản mà mỗi nhân viên đã mở liên hệ chủ nhà trong ngày (giờ Việt Nam): không phải điểm danh, giờ làm việc, cuộc gọi đã kết nối hay lượt thăm bất động sản.',
  noEmployees: 'Chưa có nhân viên đang hoạt động.',
  rankingTitle: 'Xếp hạng hoạt động liên hệ chủ nhà',
  rankingRank: 'Hạng',
  rankingInactive: 'Không còn hoạt động',
  rankingNote:
    'Hạng dựa trên tổng số bất động sản mà mỗi nhân viên đã mở liên hệ chủ nhà trong khoảng đã chọn, cộng theo từng ngày (giờ Việt Nam): mỗi bất động sản tính một lần cho mỗi nhân viên mỗi ngày và các tổng bằng nhau dùng chung một hạng. Lượt xem trang và số bất động sản đã xem không tính vào hạng và được xem riêng ở bảng lịch sử theo ngày. Nhân viên đã ngừng hoạt động vẫn giữ hoạt động đã ghi nhận trong khoảng.',
  myActivity: 'Hoạt động của tôi',
  myActivityLink: 'Hoạt động của tôi',
  myActivityNote:
    'Các số liệu này chỉ tính hoạt động của chính bạn: lượt xem trang, số bất động sản đã xem và số bất động sản bạn đã mở liên hệ chủ nhà trong ngày (giờ Việt Nam). Không phải điểm danh, giờ làm việc, cuộc gọi đã kết nối hay lượt thăm bất động sản.',
  myActivityEmpty:
    'Không có hoạt động nào được ghi nhận trong khoảng đã chọn. Mỗi ngày vẫn hiển thị với giá trị 0.',
  provinceActivity: 'Hoạt động mở liên hệ chủ nhà theo tỉnh/thành phố',
  provinceActivityLink: 'Hoạt động theo tỉnh/thành phố',
  provinceActivityNote:
    'Bảng này chỉ dành cho quản lý/quản trị, nhóm theo địa chỉ mới đã xác minh và đơn vị hành chính chính thức mới nhất của từng bất động sản. Mỗi lượt tính là một cặp nhân viên – bất động sản – ngày (giờ Việt Nam) đã mở liên hệ chủ nhà, không phải lượt thăm, số điện thoại hay số lần bấm. Sửa hoặc thu hồi xác minh địa chỉ có thể chuyển hoạt động cũ sang nhóm khác nhưng tổng toàn công ty không đổi.',
  provinceOwnerContact: 'Lượt mở liên hệ chủ nhà',
  provinceColumn: 'Tỉnh/Thành phố (địa chỉ đã xác minh)',
  unverifiedLocation: 'Chưa xác minh vị trí',
  provinceActivityTotal: 'Tổng cộng',
  provinceActivityCountsFrom:
    'Tổng này bằng tổng số lượt mở liên hệ chủ nhà của báo cáo hoạt động công ty trong cùng khoảng ngày.',
  provinceActivityEmpty:
    'Không có lượt mở liên hệ chủ nhà nào trong khoảng đã chọn. Nhóm “Chưa xác minh vị trí” vẫn hiển thị với giá trị 0.',
  provinceActivityBands:
    'Mức màu chỉ so sánh trong kỳ đã chọn với nhóm có số lượt lớn nhất; mỗi ô đều hiển thị số chính xác và nhãn mức bằng chữ.',
  activityLevelNone: 'Không phát sinh',
  activityLevelLow: 'Thấp',
  activityLevelMedium: 'Trung bình',
  activityLevelHigh: 'Cao',
  discussion: 'Thảo luận bất động sản',
  commentHistory: 'Lịch sử bình luận',
  commentHistoryEmpty: 'Chưa có dữ liệu lịch sử.',
  commentHistoryMore:
    'Cửa sổ này giữ 64 sự kiện cũ nhất; các sự kiện mới hơn chưa hiển thị.',
  commentHistoryFailed: 'Chưa tải được lịch sử bình luận. Vui lòng thử lại.',
  viewHistory: 'Xem lịch sử',
  hideHistory: 'Ẩn lịch sử',
  addComment: 'Bình luận',
  commentHint: 'Viết bình luận chung cho bất động sản này. Tối đa 2.000 ký tự.',
  postComment: 'Gửi bình luận',
  posting: 'Đang gửi…',
  commentRequired: 'Vui lòng nhập từ 1 đến 2.000 ký tự.',
  commentTooLong: 'Bình luận tối đa 2.000 ký tự.',
  commentPosted: 'Đã gửi bình luận.',
  commentPostFailed:
    'Chưa gửi được bình luận. Bản nháp được giữ lại; gửi lại sẽ không tạo bình luận trùng.',
  commentConflict:
    'Khóa gửi này đã được ghi với nội dung khác. Hãy làm mới để xem bình luận đã ghi.',
  commentPostRemoved:
    'Bình luận đã được gỡ trước đó. Nội dung đã nhập được giữ lại; gửi lại sẽ tạo bình luận mới.',
  editComment: 'Chỉnh sửa bình luận',
  commentCurrent: 'Nội dung hiện đang được lưu',
  editHint: 'Chỉnh sửa nội dung bình luận chung. Tối đa 2.000 ký tự.',
  saveComment: 'Lưu thay đổi',
  savingComment: 'Đang lưu…',
  commentEdited: 'Đã cập nhật bình luận.',
  commentEditedMarker: 'đã chỉnh sửa',
  commentUnchanged: 'Nội dung chưa thay đổi.',
  editStale:
    'Bình luận đã thay đổi hoặc đã bị gỡ. Bản nháp đang sửa được giữ lại; hãy làm mới để đối chiếu.',
  editFailed: 'Chưa lưu được thay đổi. Bản nháp đang sửa được giữ lại.',
  editDenied:
    'Chưa lưu được thay đổi. Quyền truy cập hoặc trạng thái lưu trữ của bất động sản đã thay đổi; hãy làm mới để xem trạng thái hiện tại.',
  noComments: 'Chưa có bình luận nào.',
  moreComments: 'Xem bình luận cũ hơn',
  removeComment: 'Gỡ bình luận',
  moderateComment: 'Gỡ kèm lý do',
  confirmRemove: 'Xác nhận gỡ',
  removing: 'Đang gỡ…',
  cancel: 'Huỷ',
  commentRemoved: 'Bình luận đã được gỡ.',
  commentAuthorWithdrawal: 'Tác giả đã tự gỡ bình luận.',
  commentModeratedRemoval: 'Đã gỡ do kiểm duyệt.',
  removalReason: 'Lý do kiểm duyệt',
  removalReasonHint:
    'Bắt buộc. Lý do được lưu lại cho quản lý và quản trị viên.',
  removalReasonRequired: 'Vui lòng nhập lý do kiểm duyệt.',
  removalStale:
    'Bình luận đã thay đổi hoặc đã bị gỡ. Hãy làm mới để xem trạng thái hiện tại.',
  removalFailed: 'Chưa gỡ được bình luận. Nội dung đã nhập được giữ lại.',
  removalDenied:
    'Chưa gỡ được bình luận. Quyền truy cập hoặc trạng thái lưu trữ của bất động sản đã thay đổi; hãy làm mới để xem trạng thái hiện tại.',
  refresh: 'Làm mới',
  vietnamTime: 'giờ Việt Nam',
  savedLocaleFailed:
    'Không lưu được ngôn ngữ. Ngôn ngữ hiện tại được giữ nguyên.',
  recovery: 'Quên mật khẩu?',
  recoveryTitle: 'Khôi phục mật khẩu',
  recoveryInstructions:
    'Nhập email để nhận liên kết khôi phục. Khôi phục mật khẩu không cấp quyền nhân viên.',
  sendRecovery: 'Gửi liên kết khôi phục',
  recoverySent: 'Nếu email hợp lệ, bạn sẽ nhận được hướng dẫn khôi phục.',
  resetTitle: 'Đặt mật khẩu mới',
  newPassword: 'Mật khẩu mới',
  confirmPassword: 'Xác nhận mật khẩu',
  updatePassword: 'Đổi mật khẩu',
  recoveryInvalid:
    'Liên kết khôi phục không hợp lệ hoặc đã hết hạn. Hãy yêu cầu liên kết mới.',
  passwordUpdated: 'Đã thay đổi mật khẩu. Hãy đăng nhập lại.',
  updated: 'Cập nhật',
  sessionEnded: 'Phiên đăng nhập đã kết thúc.',
  signInHelp:
    'Chỉ nhân viên được mời, liên kết và kích hoạt mới được truy cập.',
  north: 'Bắc',
  northeast: 'Đông Bắc',
  east: 'Đông',
  southeast: 'Đông Nam',
  south: 'Nam',
  southwest: 'Tây Nam',
  west: 'Tây',
  northwest: 'Tây Bắc',
  signOutFailed:
    'Đăng xuất chưa hoàn tất. Thông tin đã được ẩn; vui lòng thử lại.',
  accessChanged:
    'Quyền truy cập của bạn đã thay đổi. Tải lại trang để tiếp tục.',
  // Canonical authentication design foundation (tickets #50–#52).
  brandRole: 'Hệ Thống quản lý bất động sản',
  brandTitle: 'Hệ thống quản lý bất động sản Saigon New House.',
  brandLede: 'Truy cập dành riêng cho nhân viên được cấp quyền.',
  brandMeta: 'Saigon New House · Truy cập nội bộ',
  footNote: 'Saigon New House · Hệ thống nội bộ',
  // Application shell (ADR 0001): rail, topbar, account menu.
  openMenu: 'Mở menu điều hướng',
  breadcrumb: 'Đường dẫn',
  close: 'Đóng',
  navSearch: 'Tìm kiếm',
  navNewProperty: 'Thêm bất động sản',
  navCorrections: 'Yêu cầu đính chính',
  sales: 'Kinh doanh',
  staff: 'Nhân viên',
  manager: 'Quản lý',
  admin: 'Quản trị viên',
  // People → Employees (#65): the admin employee list.
  people: 'Nhân sự',
  employeesLink: 'Nhân viên',
  employeeDirectory: 'Danh sách nhân viên',
  employeeDirectoryNote:
    'Các danh tính nhân viên đã được ghi nhận. “Chưa liên kết đăng nhập” chỉ nói về tài khoản đăng nhập; trạng thái lời mời được hiển thị riêng theo bản ghi lời mời thực tế.',
  employeeDirectoryEmpty: 'Chưa có danh tính nhân viên nào được ghi nhận.',
  employeeDirectoryFailed: 'Không thể tải danh sách nhân viên.',
  employeePageInfo: 'Trang này: {n} nhân viên',
  employeeName: 'Họ tên',
  employeeRole: 'Vai trò',
  employeeAccess: 'Trạng thái truy cập',
  employeeAccessActive: 'Đang hoạt động',
  employeeAccessInactive: 'Đã tắt truy cập',
  employeeAccessUnlinked: 'Chưa liên kết đăng nhập',
  employeeAccessAccountDeleted: 'Đã xóa tài khoản đăng nhập',
  // Employee deactivation (issue #66).
  employeeActions: 'Thao tác',
  employeeDeactivate: 'Tắt quyền truy cập',
  employeeDeactivateTarget: 'Nhân viên',
  employeeDeactivateNote:
    'Thao tác này tắt quyền truy cập nội bộ trước, sau đó xác nhận chặn đăng nhập của đúng tài khoản. Hồ sơ, lịch sử và công việc vẫn giữ nguyên.',
  employeeDeactivateConfirm: 'Xác nhận tắt quyền truy cập',
  employeeDeactivateReconcile: 'Đối soát chặn đăng nhập',
  employeeDeactivateState: 'Trạng thái thao tác',
  employeeDeactivateOutstanding: 'Đặt chỗ đang mở',
  employeeDeactivateNoOutstanding:
    'Không có yêu cầu đặt chỗ hoặc đặt chỗ hiệu lực nào đang mở.',
  employeeDeactivateReservationEffective: 'Đặt chỗ đã duyệt',
  employeeDeactivateReservationPending: 'Yêu cầu đang chờ',
  employeeDeactivateReservationExpires: 'Hết hạn',
  employeeDeactivateReservationNote:
    'Việc giải phóng hoặc hết hạn vẫn theo đúng người yêu cầu, người duyệt và thời hạn hiện có; hệ thống không tự chuyển hay đổi người được ghi nhận.',
  employeeDeactivatePendingLabel: 'Đang chờ xác nhận chặn đăng nhập',
  employeeDeactivateReconciliationLabel: 'Cần đối soát chặn đăng nhập',
  employeeDeactivateConfirmedLabel: 'Đã xác nhận chặn đăng nhập',
  employeeDeactivateBanNote:
    'Chặn đăng nhập có thời hạn do nhà cung cấp xác nhận (khoảng 100 năm) và chỉ được gia hạn bằng một lần đối soát rõ ràng; đây không phải trạng thái vô hạn.',
  employeeDeactivateSuccess:
    'Đã tắt quyền truy cập và xác nhận chặn đăng nhập.',
  employeeDeactivatePending:
    'Đã tắt quyền truy cập; chặn đăng nhập chưa được xác nhận.',
  employeeDeactivateFailed:
    'Thao tác chưa hoàn tất. Quyền truy cập vẫn bị tắt và trạng thái đã ghi vẫn được giữ nguyên.',
  employeeDeactivateLastAdmin:
    'Không thể tắt quyền truy cập của quản trị viên đang hoạt động cuối cùng.',
  employeeDeactivateNotDeactivable:
    'Nhân viên này không còn có thể tắt quyền truy cập (chưa liên kết đăng nhập hoặc đã tắt).',
  employeeDeactivateConflict:
    'Mã thao tác đã được dùng cho một hành động khác. Hãy mở lại mục này.',
  employeeDeactivateStale:
    'Trạng thái thao tác đã thay đổi. Hãy tải lại trước khi thử lại.',
  employeeDeactivateProviderUnavailable:
    'Máy chủ chưa có cấu hình xác nhận chặn đăng nhập. Quyền truy cập đã bị tắt; hãy thử lại sau khi cấu hình được khôi phục.',
  employeeDeactivateLoadFailed: 'Không thể tải trạng thái tắt quyền truy cập.',
  // Permanent sign-in account deletion (issue #67).
  employeeDelete: 'Xóa tài khoản đăng nhập',
  employeeDeleteReconcile: 'Đối soát xóa tài khoản',
  employeeDeleteTarget: 'Nhân viên được giữ lại',
  employeeDeleteNote:
    'Xóa vĩnh viễn tài khoản đăng nhập của đúng nhân viên này. Hồ sơ nhân viên, họ tên, mã định danh và toàn bộ công việc đã ghi nhận vẫn được giữ nguyên.',
  employeeDeleteConfirmLabel: 'Nhập email để xác nhận',
  employeeDeleteConfirmHint:
    'Nhập chính xác email “{email}” để bật nút xóa vĩnh viễn.',
  employeeDeleteConfirmRequired: 'Hãy nhập email của nhân viên này.',
  employeeDeleteConfirmMismatch: 'Email nhập vào không khớp với nhân viên này.',
  employeeDeleteConfirm: 'Xóa vĩnh viễn tài khoản đăng nhập',
  employeeDeleteState: 'Trạng thái thao tác',
  employeeDeleteStorageNote:
    'Tệp đã tải lên thuộc sở hữu kỹ thuật của tài khoản đăng nhập. Hệ thống kiểm tra trước và chỉ chuyển quyền sở hữu sang một quản trị viên đang hoạt động; nội dung, mã tệp, đường dẫn và người tải lên không thay đổi.',
  employeeDeleteStorageEvidence:
    'Tệp thuộc sở hữu: {owned} · đã chuyển quyền sở hữu: {reassigned}',
  employeeDeletePendingLabel: 'Đang chờ xóa tài khoản đăng nhập',
  employeeDeleteReconciliationLabel: 'Cần đối soát xóa tài khoản đăng nhập',
  employeeDeleteStorageBlockedLabel: 'Chưa xóa: còn tệp thuộc sở hữu tài khoản',
  employeeDeleteConfirmedLabel: 'Đã xác nhận xóa tài khoản đăng nhập',
  employeeDeleteSuccess:
    'Đã xác nhận tài khoản đăng nhập không còn tồn tại. Hồ sơ nhân viên và công việc vẫn được giữ nguyên.',
  employeeDeletePending:
    'Đã tắt quyền truy cập; tài khoản đăng nhập chưa được xóa.',
  employeeDeleteFailed:
    'Thao tác chưa hoàn tất. Quyền truy cập vẫn bị tắt, hồ sơ nhân viên và công việc vẫn nguyên vẹn; hãy thử lại.',
  employeeDeleteStorageBlocked:
    'Chưa thể xóa: tài khoản còn sở hữu tệp trong kho lưu trữ và quyền sở hữu chưa được chuyển an toàn. Không có tệp nào bị xóa.',
  employeeDeleteLastAdmin:
    'Không thể xóa tài khoản đăng nhập của quản trị viên đang hoạt động cuối cùng.',
  employeeDeleteNotDeletable:
    'Nhân viên này không còn có thể xóa tài khoản đăng nhập (chưa liên kết đăng nhập hoặc đã xóa).',
  employeeDeleteLifecycleConflict:
    'Một thao tác vòng đời khác đang mở cho nhân viên này. Hãy hoàn tất hoặc đối soát thao tác đó trước.',
  employeeDeleteKeyConflict:
    'Mã thao tác đã được dùng cho một hành động khác. Hãy mở lại mục này.',
  employeeDeleteStale:
    'Trạng thái thao tác đã thay đổi. Hãy tải lại trước khi thử lại.',
  employeeDeleteProviderUnavailable:
    'Máy chủ chưa có cấu hình xóa tài khoản đăng nhập. Quyền truy cập đã bị tắt; hãy thử lại sau khi cấu hình được khôi phục.',
  employeeDeleteLoadFailed: 'Không thể tải trạng thái xóa tài khoản đăng nhập.',
  // Employee invitation (issue #68).
  employeeInviteNote:
    'Ghi nhận một lời mời cho đúng địa chỉ email và vai trò đã chọn. Người được mời chưa có quyền truy cập cho đến khi tự thiết lập tài khoản trong bước riêng.',
  employeeInviteEmailHint:
    'Địa chỉ được chuẩn hóa (bỏ khoảng trắng thừa, chữ thường) trước khi ghi nhận.',
  employeeInviteRoleHint:
    'Một trong các vai trò công ty hiện có. Vai trò được ghi vào hồ sơ nhân viên, không ghi vào thông tin đăng nhập.',
  employeeInviteSubmit: 'Gửi lời mời',
  employeeInviteTarget: 'Người được mời',
  employeeInviteState: 'Trạng thái lời mời',
  employeeInvitePendingLabel: 'Chưa có xác nhận từ nhà cung cấp',
  employeeInviteReconciliationLabel: 'Cần đối soát lời mời',
  employeeInviteNoneLabel: 'Chưa ghi nhận lời mời',
  employeeInviteRecordedLabel: 'Đã ghi nhận lời mời',
  employeeInviteDeliveryNote:
    'Đã có danh tính nhà cung cấp cho địa chỉ này. Điều này không xác nhận hộp thư đã nhận được thư và không bật quyền truy cập.',
  employeeInviteUnconfirmedNote:
    'Chưa xác nhận việc gửi thư và chưa bật quyền truy cập nào.',
  employeeInviteSuccess:
    'Đã ghi nhận lời mời; chưa có quyền truy cập nào được bật.',
  employeeInvitePending:
    'Yêu cầu mời đã được ghi nhận; nhà cung cấp chưa xác nhận.',
  employeeInviteFailed:
    'Yêu cầu mời đã được ghi nhận, nhưng bước gửi của nhà cung cấp chưa hoàn tất và chưa xác nhận việc gửi thư. Lời mời đã ghi nhận bên dưới hiển thị trạng thái cần đối soát và chi tiết từ nhà cung cấp; hãy thử lại với cùng thao tác.',
  employeeInviteEmailRecorded:
    'Email này đã thuộc một nhân viên đã ghi nhận, không phải người mới; hãy xử lý theo chính sách người quay lại.',
  employeeInviteAlreadyRecorded: 'Đã có lời mời được ghi nhận cho người này.',
  employeeInviteRoleConflict:
    'Một vai trò khác đã được ghi nhận cho lời mời đang mở này.',
  employeeInviteKeyConflict:
    'Mã thao tác đã được dùng cho một lời mời khác. Hãy mở lại biểu mẫu mời.',
  employeeInviteStale:
    'Trạng thái lời mời đã thay đổi. Hãy tải lại trước khi thử lại.',
  employeeInviteChanged:
    'Nhân viên này đã thay đổi trong lúc gửi; hãy bắt đầu lại lời mời.',
  employeeInviteProviderUnavailable:
    'Máy chủ chưa có cấu hình gửi lời mời. Yêu cầu đã được ghi nhận; hãy thử lại sau khi cấu hình được khôi phục.',
  employeeInviteLoadFailed: 'Không thể tải trạng thái lời mời.',
  employeeInviteOpen: 'Ghi nhận lời mời',
  // The fixed invitation destination (issue #68). The account-setup journey itself is a
  // separate ticket, so this surface claims no access and no delivery.
  inviteTitle: 'Điểm đến của liên kết lời mời',
  inviteLead:
    'Đây là điểm đến cố định của một liên kết lời mời. Trang này không đọc thông tin về bất kỳ lời mời nào và không xác nhận lời mời của bạn. Bước tự thiết lập tài khoản cho người được mời chưa được mở trong phiên bản này; khi bước đó sẵn sàng, người được mời có thể đăng nhập bằng địa chỉ email được mời. Trang này không xác nhận hộp thư đã nhận được thư và không bật quyền truy cập.',
  // People → Vendors (#73): the company directory and its one bounded create.
  vendorsLink: 'Nhà cung cấp',
  vendorDirectory: 'Danh sách nhà cung cấp',
  vendorDirectoryNote:
    'Các công ty được ghi nhận riêng, không phải chủ nhà, môi giới hay nhân viên. Mọi nhân viên đang hoạt động đều xem được; nhân viên, quản lý và quản trị viên ghi nhận nhà cung cấp.',
  vendorDirectoryEmpty: 'Chưa có nhà cung cấp nào được ghi nhận.',
  vendorDirectoryEmptyQuery: 'Không tìm thấy nhà cung cấp phù hợp.',
  vendorDirectoryFailed: 'Không thể tải danh sách nhà cung cấp.',
  vendorPageInfo: 'Trang này: {n} nhà cung cấp',
  vendorSearch: 'Tìm nhà cung cấp',
  vendorSearchHint:
    'Nhập một đoạn tên liền nhau, không cần dấu; % và _ là ký tự thường. Tối đa 120 ký tự.',
  vendorCreate: 'Ghi nhận nhà cung cấp',
  vendorCreateNote:
    'Một công ty với một khối liên hệ, tách biệt khỏi chủ nhà, môi giới và nhân viên.',
  vendorCompanyName: 'Tên công ty',
  vendorCompanyNameHint: 'Tên công ty như được ghi nhận, từ 1 đến 200 ký tự.',
  vendorContactName: 'Tên người liên hệ',
  vendorPhones: 'Số điện thoại',
  vendorPhonesHint:
    'Mỗi dòng một số, tối đa 5 số. Số được giữ nguyên như đã nhập.',
  vendorSourceAddress: 'Địa chỉ / văn bản nguồn',
  vendorOptionalHint:
    'Ô để trống là chưa rõ, không phải giá trị rỗng. Hệ thống không tự điền.',
  vendorCreateSubmit: 'Ghi nhận nhà cung cấp',
  vendorCreateInvalid: 'Vui lòng kiểm tra tên công ty, số điện thoại và email.',
  vendorCreateConflict:
    'Lượt gửi này đã được dùng cho thông tin nhà cung cấp khác. Nội dung đã nhập được giữ lại; gửi lại sẽ ghi nhận như một nhà cung cấp mới.',
  vendorCreateFailed:
    'Chưa ghi nhận được nhà cung cấp. Thử lại giữ nguyên nội dung đã nhập; lượt gửi trùng không tạo thêm công ty.',
  vendorMaintainerOnly:
    'Bạn có thể xem danh sách này. Chỉ nhân viên, quản lý và quản trị viên mới được ghi nhận nhà cung cấp.',
  vendorDetailTitle: 'Chi tiết nhà cung cấp',
  vendorDetailFailed: 'Không thể tải chi tiết nhà cung cấp.',
  vendorNotFound: 'Không tìm thấy nhà cung cấp hoặc không có quyền đọc.',
  vendorBackToDirectory: 'Về danh sách nhà cung cấp',
  vendorRecordedAt: 'Ghi nhận lúc',
  vendorPropertyNote:
    'Nhà cung cấp được ghi nhận cho bất động sản này, tách biệt với chủ sở hữu và người môi giới. Liên kết nhà cung cấp không phải chủ sở hữu, không phải đặt chỗ và không phải trạng thái thuê.',
  vendorPropertyEmpty: 'Chưa ghi nhận nhà cung cấp nào cho bất động sản này.',
  vendorPropertyFailed: 'Không thể tải nhà cung cấp của bất động sản này.',
  vendorLinkOpen: 'Liên kết nhà cung cấp đã ghi nhận',
  vendorLinkChoose: 'Chọn nhà cung cấp',
  vendorLinkNone:
    'Không có nhà cung cấp phù hợp. Ghi nhận công ty trong danh sách nhà cung cấp trước.',
  vendorLinkSubmit: 'Liên kết với bất động sản này',
  vendorLinkStale:
    'Thông tin bất động sản đã thay đổi. Đọc lại trang rồi liên kết lại; chưa có thay đổi nào được lưu.',
  vendorLinkInvalid: 'Liên kết không hợp lệ. Chọn lại nhà cung cấp.',
  vendorLinkMissing: 'Không tìm thấy nhà cung cấp hoặc liên kết hiện tại.',
  vendorLinkFailed:
    'Chưa xác nhận được kết quả. Đọc lại thông tin hiện tại trước khi thử lại; không tự gửi lại.',
  vendorUnlink: 'Gỡ liên kết',
  vendorUnlinkConfirm:
    'Gỡ liên kết này? Chỉ mối liên hệ hiện tại bị gỡ; nhà cung cấp và các liên kết khác vẫn được giữ.',
  vendorUnlinkYes: 'Xác nhận gỡ liên kết',
  vendorLinkedProperties: 'Bất động sản đã liên kết',
  vendorLinkedPropertiesNote:
    'Chỉ các bất động sản bạn được phép đọc. Bất động sản đã lưu trữ không hiển thị ngoài quyền của bạn.',
  vendorLinkedPropertiesEmpty:
    'Nhà cung cấp này chưa được liên kết với bất động sản nào bạn được phép đọc.',
  vendorLinkedPropertiesMore: 'Hiển thị 50 bất động sản đã liên kết đầu tiên.',
  vendorLinkedAt: 'Liên kết lúc',
  vendorLinkedArchived: 'Đã lưu trữ',
  // People → Contacts (#71): the shared-identity directory, its Owners view and the
  // expansion that corrects the shared contact through the one maintenance operation.
  contactsLink: 'Người liên hệ',
  contactDirectory: 'Danh sách người liên hệ',
  contactDirectoryNote:
    'Một người liên hệ dùng chung cho mọi bất động sản liên kết. Mục Chủ nhà chỉ gồm người có liên kết quan hệ chủ nhà trên bất động sản bạn được đọc; trường phân loại chung không quyết định. Mọi nhân viên đang hoạt động có thể đính chính thông tin đã ghi của người liên hệ đã gắn với một bất động sản.',
  contactViews: 'Chế độ xem danh sách',
  contactViewAll: 'Tất cả người liên hệ',
  contactViewOwners: 'Chủ nhà',
  contactSearch: 'Tìm tên người liên hệ',
  contactSearchHint:
    'Tìm theo tên đã ghi; chỉ tên, không tìm số điện thoại. % và _ là ký tự thường. Tối đa 120 ký tự.',
  contactColumnName: 'Người liên hệ',
  contactColumnRelation: 'Quan hệ trên bất động sản',
  contactColumnPhone: 'Số điện thoại đã ghi',
  contactPrimaryLink: 'Liên hệ chính',
  contactColumnProperties: 'Bất động sản liên quan',
  contactColumnActions: 'Thao tác',
  contactNoProperties: 'Chưa gắn bất động sản nào',
  contactPropertyCount: '{n} bất động sản liên quan',
  contactPageInfo: 'Trang này: {n} người liên hệ',
  contactDirectoryEmpty: 'Chưa có người liên hệ nào được ghi nhận.',
  contactDirectoryEmptyQuery: 'Không tìm thấy người liên hệ phù hợp.',
  contactOwnersEmpty:
    'Chưa có người liên hệ nào được ghi nhận là chủ nhà trên bất động sản bạn được đọc.',
  contactOwnersEmptyQuery: 'Không tìm thấy chủ nhà phù hợp.',
  contactDirectoryFailed: 'Không thể tải danh sách người liên hệ.',
  contactOpen: 'Xem và đính chính',
  // Unlinked-identity correction is staff/manager/admin (ticket #72); sales still see this note.
  contactUnlinkedNote:
    'Chưa gắn bất động sản nào nên chưa thể đính chính từ danh sách này; mục này mở khi người liên hệ được gắn vào một bất động sản.',
  contactClose: 'Đóng chi tiết',
  contactLinkedProperties: 'Bất động sản liên quan',
  contactLinkedPropertiesNote:
    'Quan hệ được ghi theo từng bất động sản: cùng một người có thể là chủ nhà ở nơi này và môi giới ở nơi khác. Mọi bất động sản nêu trên đều nhận thay đổi và hiển thị thông tin mới ở lần đọc kế tiếp; thay đổi người liên hệ dùng chung không ghi vào lịch sử bất động sản.',
  contactClassifiedAs: 'Phân loại chung',
  contactRawPhoneText: 'Văn bản điện thoại gốc',
  contactEditorTitle: 'Đính chính người liên hệ dùng chung',
  contactSharedIdentityNote:
    'Đây là người liên hệ dùng chung: đính chính sẽ áp dụng cho mọi bất động sản đang gắn với người này.',
  saving: 'Đang lưu…',
  notes: 'Ghi chú',
  languageName: 'Ngôn ngữ / Language',
  switchToVi: 'Chuyển sang tiếng Việt',
  switchToEn: 'Switch to English',
  accountNote:
    'Tài khoản do quản trị viên Saigon New House cấp. Nếu chưa nhận được lời mời, liên hệ bộ phận quản lý tòa nhà.',
  remember: 'Ghi nhớ đăng nhập',
  showPassword: 'Hiện mật khẩu',
  hidePassword: 'Ẩn mật khẩu',
  signingIn: 'Đang đăng nhập…',
  emailRequired: 'Vui lòng nhập email.',
  emailInvalid: 'Email không hợp lệ.',
  passwordRequired: 'Vui lòng nhập mật khẩu.',
  emailPlaceholder: 'ten@congty.vn',
  recoveryEyebrow: 'Saigon New House · Bảo mật tài khoản',
  stepVerify: 'Xác minh',
  stepPassword: 'Mật khẩu',
  stepDone: 'Hoàn tất',
  recoverySending: 'Đang gửi liên kết…',
  recoverySentTitle: 'Kiểm tra email của bạn',
  resetInstructions:
    'Liên kết khôi phục đã được xác minh. Chọn mật khẩu mới cho tài khoản.',
  resetUpdating: 'Đang cập nhật…',
  passwordDoneTitle: 'Đổi mật khẩu thành công',
  passwordRulesUnmet: 'Mật khẩu chưa đáp ứng yêu cầu bảo mật.',
  passwordMismatch: 'Mật khẩu xác nhận không khớp.',
  confirmRequired: 'Vui lòng xác nhận mật khẩu.',
  ruleLength: 'Ít nhất 10 ký tự',
  ruleCase: 'Có chữ hoa và chữ thường',
  ruleDigit: 'Có ít nhất một chữ số',
  ruleSymbol: 'Có ký tự đặc biệt',
  strength: 'Độ mạnh',
  strengthWeak: 'Yếu',
  strengthFair: 'Trung bình',
  strengthGood: 'Tốt',
  strengthStrong: 'Mạnh',
  stepBack: 'Quay lại',
  reservations: 'Đặt chỗ',
  reservationEffective: 'Đã có đặt chỗ hiệu lực',
  reservationClaimant: 'Người đặt chỗ',
  reservationExpires: 'Hết hạn',
  reservationPending: 'Yêu cầu của bạn đang chờ duyệt',
  reservationRequestedAt: 'Gửi lúc',
  reservationPendingExpires: 'Yêu cầu hết hạn',
  reservationPendingNote:
    'Yêu cầu đang chờ không giữ bất động sản cho đến khi được duyệt.',
  reservationArchived: 'Hồ sơ lưu trữ không nhận yêu cầu đặt chỗ mới.',
  reservationReason: 'Lý do đặt chỗ',
  reservationReasonHint: 'Từ 10 đến 2.000 ký tự.',
  reservationReasonRequired: 'Vui lòng nhập lý do từ 10 đến 2.000 ký tự.',
  submitReservation: 'Gửi yêu cầu đặt chỗ',
  reservationRequested:
    'Đã gửi yêu cầu. Bất động sản chưa được đặt chỗ cho đến khi quản lý hoặc quản trị viên duyệt.',
  reservationRequestFailed: 'Chưa gửi được yêu cầu đặt chỗ. Vui lòng thử lại.',
  reservationRequests: 'Yêu cầu đang chờ duyệt',
  reservationNoRequests: 'Không có yêu cầu nào đang chờ.',
  reservationDecisionReason: 'Lý do quyết định',
  reservationDays: 'Số ngày hiệu lực (1–30)',
  reservationApprove: 'Duyệt đặt chỗ',
  reservationReject: 'Từ chối yêu cầu',
  reservationApproved: 'Đã duyệt đặt chỗ.',
  reservationRejected: 'Đã từ chối yêu cầu.',
  reservationDecisionFailed: 'Chưa ghi được quyết định. Vui lòng thử lại.',
  reservationConflict:
    'Đã có xung đột đặt chỗ. Trạng thái mới nhất đang được hiển thị.',
  reservationUnavailable: 'Bất động sản này không còn khả dụng để đặt chỗ.',
  reservationNotProceeding:
    'Yêu cầu đặt chỗ này không thể tiếp tục hoặc được quyết định.',
  reservationSelfApproval: 'Bạn không thể tự duyệt yêu cầu của mình.',
  reservationLoadFailed: 'Không tải được tình trạng đặt chỗ.',
  reservationNote:
    'Chỉ đặt chỗ đã được duyệt và còn hiệu lực mới giữ bất động sản.',
  reservationRelease: 'Giải phóng đặt chỗ',
  reservationReleaseReason: 'Lý do giải phóng',
  reservationReleaseReasonHint: 'Từ 10 đến 2.000 ký tự.',
  reservationReleaseReasonRequired:
    'Vui lòng nhập lý do từ 10 đến 2.000 ký tự.',
  reservationReleaseSubmit: 'Giải phóng',
  reservationReleased:
    'Đã giải phóng đặt chỗ; người đặt chỗ và lịch sử được giữ nguyên.',
  reservationReleaseFailed: 'Chưa giải phóng được đặt chỗ. Vui lòng thử lại.',
  reservationReleaseClosed:
    'Đặt chỗ này không còn hiệu lực để giải phóng. Trạng thái mới nhất đang được hiển thị.',
  reservationReleaseNote:
    'Giải phóng không xoá người đặt chỗ, lý do hay sự kiện đã ghi.',
  completedSaleTitle: 'Xác nhận bán thành công',
  completedSaleNote:
    'Chỉ quản lý hoặc quản trị viên khác nhân viên được ghi nhận mới có thể xác nhận. Một bất động sản chỉ có một thương vụ bán đang hiệu lực.',
  completedSaleCreditedCloser: 'Nhân viên được ghi nhận',
  completedSaleSelectCloser: 'Chọn nhân viên',
  completedSaleSuggestedCloser:
    'Người đặt chỗ hiệu lực: {name} — bạn phải tự chọn để xác nhận.',
  completedSaleDate: 'Ngày bán thực tế (Việt Nam)',
  completedSaleReference: 'Hợp đồng/tham chiếu',
  completedSaleReferenceHint: 'Từ 1 đến 200 ký tự.',
  completedSaleReferenceRequired:
    'Vui lòng chọn nhân viên và nhập ngày, tham chiếu hợp lệ.',
  completedSaleClosesReservations:
    'Xác nhận sẽ đóng mọi yêu cầu đặt chỗ đang mở và giữ nguyên người đặt chỗ cùng lịch sử.',
  completedSaleSubmit: 'Xác nhận đã bán',
  completedSaleRecorded:
    'Đã ghi nhận bán thành công; bất động sản chuyển sang Đã bán.',
  completedSaleFailed: 'Chưa ghi được xác nhận bán. Vui lòng thử lại.',
  completedSaleSelfCredit: 'Bạn không thể tự ghi nhận thương vụ của mình.',
  completedSaleFutureDate: 'Ngày bán không được ở tương lai.',
  completedSaleConflict:
    'Ghi nhận bán đã thay đổi. Trạng thái mới nhất đang được hiển thị.',
  completedSaleReservationConflict:
    'Bất động sản đang có đặt chỗ hiệu lực của nhân viên khác. Hãy giải phóng đặt chỗ đó trước.',
  completedSaleRentalActive:
    'Bất động sản đang có hợp đồng thuê hiệu lực; hãy kết thúc hợp đồng thuê trước.',
  completedSaleUnavailable:
    'Bất động sản đang ở trạng thái {status}, không thể xác nhận bán.',
  completedSaleArchived: 'Hồ sơ lưu trữ không thể xác nhận bán.',
  completedSaleNoCloser:
    'Không có nhân viên nào khác để ghi nhận thương vụ này.',
  completedSaleLoadFailed: 'Không tải được trạng thái xác nhận bán.',
  completedSaleRecordedBy: 'Người xác nhận',
  completedSaleRecordedAt: 'Thời điểm ghi nhận',
  completedSalePreviousStatus: 'Trạng thái trước khi bán',
  navCompletedSales: 'Bán thành công',
  completedSalesRanking: 'Xếp hạng bán thành công',
  completedSalesNote:
    'Chỉ các thương vụ bán đã được xác nhận độc lập mới được tính; đặt chỗ, trạng thái Đã bán thô và hồ sơ cũ chưa có người ghi nhận không tạo thành tích.',
  completedSales: 'Thương vụ bán đã xác nhận',
  completedSalesCount: 'Số thương vụ',
  completedSalesEmpty:
    'Không có thương vụ bán nào được xác nhận trong khoảng thời gian này.',
  completedSalesTotal: 'Tổng cộng: {n}',
  completedSalesUnknown:
    'Bất động sản đã bán chưa có người được ghi nhận (tính đến {date}): {n} — hiển thị riêng, không gán cho nhân viên nào.',
  completedSalesFailed: 'Không tải được xếp hạng bán thành công.',
  rank: 'Hạng',
};
export type MessageKey = keyof typeof vi;

export const messages: Record<Locale, Record<keyof typeof vi, string>> = {
  vi,
  en: {
    title: 'SGN Inventory',
    inventory: 'Property inventory',
    reports: 'Reports',
    reservationsReviews: 'Reservations & Reviews',
    login: 'Sign in',
    email: 'Email',
    password: 'Password',
    logout: 'Sign out',
    language: 'Language',
    viLanguage: 'Tiếng Việt',
    enLanguage: 'English',
    skipToContent: 'Skip to main content',
    loading: 'Loading…',
    retry: 'Retry',
    denied: 'Access denied',
    deniedHelp:
      'This identity is not linked to an active employee, or employee access has been disabled.',
    unavailable: 'Unable to connect. Please try again.',
    invalidCredentials: 'Incorrect email or password.',
    invalidInput: 'Check the entered information.',
    empty: 'No properties found.',
    unknown: 'Unknown',
    previous: 'Previous page',
    next: 'Next page',
    first: 'First page',
    listingMode: 'Listing mode',
    status: 'Inventory status',
    address: 'Address',
    legacy: 'Legacy address',
    current: 'Current address',
    alternate: 'Alternate address',
    unresolved: 'Unverified',
    candidate: 'Candidate address — unverified',
    verified: 'Address mapping verified',
    sale: 'Sale',
    rent: 'Rent',
    both: 'Sale and rent',
    draft: 'Draft',
    available: 'Available',
    negotiating: 'Negotiating',
    sold: 'Sold',
    rented: 'Rented',
    withdrawn: 'Withdrawn',
    archived: 'Archived record — reviewers only',
    search: 'Search address',
    searchHint:
      'Enter a contiguous address fragment; accents are optional. % and _ are literal characters, not wildcards.',
    queryTooLong: 'Search addresses must be at most 120 characters.',
    sortLabel: 'Original entry date order',
    sortDefault: 'Default',
    sortOldest: 'Oldest first',
    sortNewest: 'Newest first',
    orderReverse: 'Reverse',
    orderReverseHint: 'Choose an entry-date order to reverse it.',
    ageHint:
      'Available and negotiating unarchived inventory only. Order uses the original inventory entry date and does not change on update, price edit or relisting. Records with an unknown entry date are listed last, never hidden.',
    filters: 'Filters',
    filtersApply: 'Apply filters',
    filtersClear: 'Clear filters',
    filtersRemove: 'Remove filter',
    filtersAny: 'Any',
    filtersInvalid:
      'The filter set is not valid. Check the entered price and area bounds.',
    priceFilterHint:
      'With no listing mode selected, each record uses its own asking price: rental records use monthly asking rent (VND/month), while sale and sale-and-rent records use asking sale price in whole VND. Select Sale or Sale and rent to compare asking sale prices only; select Rent to compare monthly asking rents only.',
    areaFilterHint:
      'Area matches when the land area or the floor area is inside the range.',
    province: 'Province / city',
    ward: 'Commune / ward',
    areaAdminHint:
      "Filter by the address's province/city and commune/ward. Choosing a province/city includes every commune/ward in it; choosing a commune/ward narrows to that ward. When both are set, the ward is the condition in force.",
    areaFilterUnavailable:
      'The province and ward catalog could not be loaded. The price and area filters still work.',
    contactFilter: 'Contact',
    contactFilterHint:
      'Only contacts you may read. This filter combines with the other conditions.',
    contactFilterUnavailable:
      'The contact list could not be loaded. The other filters still work.',
    priceUnitVnd: 'VND',
    priceUnitMonthly: 'VND/month',
    priceRangeFrom: 'Price from',
    priceRangeTo: 'Price to',
    salePriceFrom: 'Sale price from',
    salePriceTo: 'Sale price to',
    rentPriceFrom: 'Monthly rent from',
    rentPriceTo: 'Monthly rent to',
    areaRangeFrom: 'Area from',
    areaRangeTo: 'Area to',
    emptyFiltered: 'No property matches these filters.',
    entryDate: 'Original inventory entry date',
    entryDateUnknown: 'Unknown',
    entryDateLegacy: 'From the legacy record',
    entrySourceRecorded: 'Recorded when the record was created',
    entryAge: 'days in inventory',
    entryAgeOne: 'day in inventory',
    entryAgeUnknown: 'Inventory age unknown',
    propertyCode: 'Property code',
    details: 'Property details',
    back: 'Back to results',
    notFound: 'Property not found or not available to you.',
    propertyType: 'Property type',
    accessType: 'Access type',
    reviewStatus: 'Record review',
    legalStatus: 'Legal status',
    pending: 'Pending review',
    approved: 'Reviewed',
    rejected: 'Rejected',
    legalNote: 'Internal review does not establish legal ownership.',
    owner_reported: 'Owner reported',
    documents_received: 'Documents received',
    reviewed: 'Reviewed',
    issue_flagged: 'Issue flagged',
    house: 'House',
    land: 'Land',
    apartment: 'Apartment',
    villa: 'Villa',
    serviced_apartment: 'Serviced apartment',
    unclassified: 'Unclassified',
    street_front: 'Street front',
    car_alley: 'Car-access alley',
    motorbike_alley: 'Motorbike alley',
    three_wheeler_alley: 'Three-wheeler alley',
    salePrice: 'Sale price',
    monthlyRent: 'Rent / month',
    landArea: 'Land area',
    floorArea: 'Floor area',
    frontage: 'Frontage',
    depth: 'Depth',
    floors: 'Floors',
    bedrooms: 'Bedrooms',
    bathrooms: 'Bathrooms',
    direction: 'Direction',
    contacts: 'Owner / broker contacts',
    noContacts: 'No recorded contact links.',
    owner: 'Owner',
    broker: 'Broker',
    representative: 'Representative',
    primary: 'Primary contact',
    showOwnerContact: 'Show owner contact',
    ownerContactMissing: 'No owner contact is recorded for this property.',
    ownerPhoneMissing: 'The recorded owner contact has no phone number.',
    ownerContactFailed:
      'Owner contact could not be revealed. Retrying reuses this recorded access without adding another.',
    ownerContactKeyConflict:
      'This access reference was already used for another property.',
    ownerContactUnavailable:
      'Owner-contact access was recorded; no owner phone is currently recorded.',
    call: 'Call',
    callUnavailable: 'The recorded number is not dialable.',
    ownerContactNote:
      'Shown only after you choose. Revealing an owner contact is not a connected call and not a physical visit.',
    noCurrent: 'No current address recorded.',
    pageViewFailed:
      'Page view not recorded. Retrying will not create a duplicate.',
    pageViewNote:
      'Opening this page records a page view, not a confirmed physical visit.',
    todayActivity: 'My activity today',
    todayDay: 'Day (Vietnam time)',
    todayPageViews: 'Page views',
    todayProperties: 'Distinct properties viewed',
    todayOwnerContacts: 'Owner-contact properties',
    todayActivityFailed: "Today's activity could not be loaded.",
    companyActivity: 'Employee activity by day',
    companyActivityLink: 'Company activity report',
    backToInventory: 'Back to inventory',
    filterFrom: 'From date',
    filterTo: 'To date',
    applyFilter: 'View report',
    invalidRange:
      'That date range is not valid. The start date must not be after the end date, and the range may cover at most 366 days.',
    rangeTooLarge:
      "The range {from} – {to} exceeds the report's 1,000-row limit (the limit is active employees × days). Narrow the date range.",
    rankingTooLarge:
      "The range {from} – {to} exceeds the ranking's 1,000-row limit (the number of employees in scope). Narrow the date range.",
    todaySummary: "Today's summary",
    companyHistory: 'History by day',
    companyEmployee: 'Employee',
    companyActivityNote:
      'Owner-contact access is the number of properties whose owner contact each employee opened that Vietnam day: not attendance, work hours, connected calls or physical visits.',
    noEmployees: 'No active employees.',
    rankingTitle: 'Owner-contact activity ranking',
    rankingRank: 'Rank',
    rankingInactive: 'No longer active',
    rankingNote:
      'The rank uses the number of properties whose owner contact each employee opened in the selected range, summed per Vietnam day: one property counts once per employee per day, and equal totals share a rank. Page views and distinct properties viewed never enter the rank and stay in the history-by-day table below. A contributor who is no longer active keeps the activity recorded in this range.',
    myActivity: 'My activity',
    myActivityLink: 'My activity',
    myActivityNote:
      'These figures cover your own activity only: page views, distinct properties viewed and the number of properties whose owner contact you opened that Vietnam day. Not attendance, work hours, connected calls or physical visits.',
    myActivityEmpty:
      'No activity was recorded in the selected period. Every day still appears with zero values.',
    provinceActivity: 'Owner-contact activity by province/city',
    provinceActivityLink: 'Activity by province/city',
    provinceActivityNote:
      'This manager/admin-only table groups by each property’s latest verified current address and its canonical official province/city identity. One access is one employee – property – Vietnam day that opened an owner contact, not a physical visit, a phone number or a click count. Correcting or invalidating an address may move earlier activity to another group, but the company total does not change.',
    provinceOwnerContact: 'Owner-contact accesses',
    provinceColumn: 'Province/city (verified address)',
    unverifiedLocation: 'Unverified location',
    provinceActivityTotal: 'Total',
    provinceActivityCountsFrom:
      'This total equals the owner-contact accesses summed from the company activity report for the same date range.',
    provinceActivityEmpty:
      'No owner contact was opened in the selected period. The Unverified location group still appears with zero.',
    provinceActivityBands:
      'Colour bands compare groups inside the selected period against the largest group; every cell also prints its exact count and a text level label.',
    activityLevelNone: 'None',
    activityLevelLow: 'Low',
    activityLevelMedium: 'Medium',
    activityLevelHigh: 'High',
    discussion: 'Property discussion',
    commentHistory: 'Comment history',
    commentHistoryEmpty: 'No retained history is available.',
    commentHistoryMore:
      'This window keeps the 64 oldest events; newer events are not shown here.',
    commentHistoryFailed: 'Comment history could not be loaded. Try again.',
    viewHistory: 'View history',
    hideHistory: 'Hide history',
    addComment: 'Comment',
    commentHint:
      'Write a shared comment about this property. Up to 2,000 characters.',
    postComment: 'Post comment',
    posting: 'Posting…',
    commentRequired: 'Enter 1 to 2,000 characters.',
    commentTooLong: 'Comments are limited to 2,000 characters.',
    commentPosted: 'Comment posted.',
    commentPostFailed:
      'Comment not posted. Your draft is kept; retrying does not create a duplicate.',
    commentConflict:
      'This submission key already recorded different text. Refresh to see the recorded comment.',
    commentPostRemoved:
      'That comment was already removed. Your text is kept; posting again creates a new comment.',
    editComment: 'Edit comment',
    commentCurrent: 'Current saved comment',
    editHint: 'Edit the shared comment text. Up to 2,000 characters.',
    saveComment: 'Save changes',
    savingComment: 'Saving…',
    commentEdited: 'Comment updated.',
    commentEditedMarker: 'edited',
    commentUnchanged: 'No changes to save.',
    editStale:
      'This comment changed or was removed. Your unsent edit is kept; refresh to reconcile.',
    editFailed: 'Changes not saved. Your unsent edit is kept.',
    editDenied:
      'Changes not saved. Access or the Property archived state changed; refresh to see the current state.',
    noComments: 'No comments yet.',
    moreComments: 'More comments',
    removeComment: 'Remove',
    moderateComment: 'Remove with reason',
    confirmRemove: 'Confirm removal',
    removing: 'Removing…',
    cancel: 'Cancel',
    commentRemoved: 'Comment removed.',
    commentAuthorWithdrawal: 'Author withdrew the comment.',
    commentModeratedRemoval: 'Removed by moderation.',
    removalReason: 'Moderation reason',
    removalReasonHint:
      'Required. The reason is retained for managers and admins.',
    removalReasonRequired: 'Enter a moderation reason.',
    removalStale:
      'This comment changed or was already removed. Refresh to see the current state.',
    removalFailed: 'Comment not removed. What you entered is kept.',
    removalDenied:
      'Comment not removed. Access or the Property archived state changed; refresh to see the current state.',
    refresh: 'Refresh',
    vietnamTime: 'Vietnam time',
    savedLocaleFailed:
      'Unable to save language. The current language is unchanged.',
    recovery: 'Forgot password?',
    recoveryTitle: 'Recover password',
    recoveryInstructions:
      'Enter your email to receive a recovery link. Password recovery does not grant employee access.',
    sendRecovery: 'Send recovery link',
    recoverySent:
      'If the email is eligible, recovery instructions will arrive.',
    resetTitle: 'Set a new password',
    newPassword: 'New password',
    confirmPassword: 'Confirm password',
    updatePassword: 'Change password',
    recoveryInvalid:
      'The recovery link is invalid or expired. Request a new link.',
    passwordUpdated: 'Password changed. Sign in again.',
    updated: 'Updated',
    sessionEnded: 'Your session has ended.',
    // Application shell (ADR 0001): rail, topbar, account menu.
    openMenu: 'Open navigation menu',
    breadcrumb: 'Breadcrumb',
    close: 'Close',
    navSearch: 'Search',
    navNewProperty: 'Create property',
    navCorrections: 'Correction requests',
    sales: 'Sales',
    staff: 'Staff',
    manager: 'Manager',
    admin: 'Administrator',
    // People → Employees (#65): the admin employee list.
    people: 'People',
    employeesLink: 'Employees',
    employeeDirectory: 'Employee list',
    employeeDirectoryNote:
      'Recorded employee identities. “Not linked to sign-in” only describes the sign-in account; a recorded invitation is shown as its own marker.',
    employeeDirectoryEmpty: 'No employee identities are recorded.',
    employeeDirectoryFailed: 'The employee list could not be loaded.',
    employeePageInfo: 'This page: {n} employees',
    employeeName: 'Name',
    employeeRole: 'Role',
    employeeAccess: 'Access',
    employeeAccessActive: 'Active',
    employeeAccessInactive: 'Access disabled',
    employeeAccessUnlinked: 'Not linked to sign-in',
    employeeAccessAccountDeleted: 'Sign-in account deleted',
    // Employee deactivation (issue #66).
    employeeActions: 'Actions',
    employeeDeactivate: 'Deactivate access',
    employeeDeactivateTarget: 'Employee',
    employeeDeactivateNote:
      'This disables internal membership first, then confirms the sign-in block for the exact account. Record, history and work stay attributed to the person.',
    employeeDeactivateConfirm: 'Confirm deactivation',
    employeeDeactivateReconcile: 'Reconcile sign-in block',
    employeeDeactivateState: 'Action state',
    employeeDeactivateOutstanding: 'Outstanding reservations',
    employeeDeactivateNoOutstanding: 'No open requests or reservations.',
    employeeDeactivateReservationEffective: 'Approved reservation',
    employeeDeactivateReservationPending: 'Pending request',
    employeeDeactivateReservationExpires: 'Expires',
    employeeDeactivateReservationNote:
      'Release or expiry stays with the existing claimant, reviewer and expiry rules; the system never transfers or rewrites the recorded claimant.',
    employeeDeactivatePendingLabel: 'Sign-in block confirmation pending',
    employeeDeactivateReconciliationLabel:
      'Sign-in block reconciliation required',
    employeeDeactivateConfirmedLabel: 'Sign-in block confirmed',
    employeeDeactivateBanNote:
      'The provider confirms a finite sign-in ban (about 100 years); it is renewed only by an explicit reconciliation and is not an infinite state.',
    employeeDeactivateSuccess:
      'Access disabled and the sign-in block was confirmed.',
    employeeDeactivatePending:
      'Access is disabled; the sign-in block is not confirmed yet.',
    employeeDeactivateFailed:
      'The action did not complete. Access stays disabled and the recorded state is unchanged.',
    employeeDeactivateLastAdmin: 'The last active admin cannot be deactivated.',
    employeeDeactivateNotDeactivable:
      'This employee can no longer be deactivated (no linked sign-in or already inactive).',
    employeeDeactivateConflict:
      'This action key was already used for a different action. Reopen this entry.',
    employeeDeactivateStale:
      'The action state changed. Reload before retrying.',
    employeeDeactivateProviderUnavailable:
      'The server has no sign-in confirmation configuration. Access is disabled; retry after configuration is restored.',
    employeeDeactivateLoadFailed: 'Deactivation state did not load.',
    // Permanent sign-in account deletion (issue #67).
    employeeDelete: 'Delete sign-in account',
    employeeDeleteReconcile: 'Reconcile account deletion',
    employeeDeleteTarget: 'Retained employee',
    employeeDeleteNote:
      'Permanently removes this exact employee’s sign-in account. The employee record, name, identifier and all recorded work are retained.',
    employeeDeleteConfirmLabel: 'Type the email to confirm',
    employeeDeleteConfirmHint:
      'Type exactly “{email}” to enable the permanent delete button.',
    employeeDeleteConfirmRequired: 'Type this employee’s email.',
    employeeDeleteConfirmMismatch:
      'The typed email does not match this employee.',
    employeeDeleteConfirm: 'Permanently delete the sign-in account',
    employeeDeleteState: 'Action state',
    employeeDeleteStorageNote:
      'Uploaded files are technically owned by the sign-in account. The system preflights them and only reassigns ownership to an active admin; file content, file id, path and uploader attribution are unchanged.',
    employeeDeleteStorageEvidence:
      'Files owned: {owned} · ownership reassigned: {reassigned}',
    employeeDeletePendingLabel: 'Account deletion confirmation pending',
    employeeDeleteReconciliationLabel:
      'Account deletion reconciliation required',
    employeeDeleteStorageBlockedLabel:
      'Not deleted: files are still owned by the account',
    employeeDeleteConfirmedLabel: 'Sign-in account deletion confirmed',
    employeeDeleteSuccess:
      'The sign-in account was confirmed absent. The employee record and their work are retained.',
    employeeDeletePending:
      'Access is disabled; the sign-in account is not deleted yet.',
    employeeDeleteFailed:
      'The action did not complete. Access stays disabled and the employee record and work are intact; retry.',
    employeeDeleteStorageBlocked:
      'Deletion could not confirm: the account still owns files and ownership was not safely reassigned. No file was deleted.',
    employeeDeleteLastAdmin:
      'The last active admin’s sign-in account cannot be deleted.',
    employeeDeleteNotDeletable:
      'This employee’s sign-in account can no longer be deleted (no linked sign-in or already deleted).',
    employeeDeleteLifecycleConflict:
      'Another lifecycle action is open for this employee. Finish or reconcile it first.',
    employeeDeleteKeyConflict:
      'This action key was already used for a different action. Reopen this entry.',
    employeeDeleteStale: 'The action state changed. Reload before retrying.',
    employeeDeleteProviderUnavailable:
      'The server has no account-deletion configuration. Access is disabled; retry after configuration is restored.',
    employeeDeleteLoadFailed: 'Deletion state did not load.',
    // Employee invitation (issue #68).
    employeeInviteNote:
      'Records one invitation for the chosen email address and role. The invitee has no access until they set up their own account in a separate step.',
    employeeInviteEmailHint:
      'The address is normalized (extra whitespace removed, lower case) before it is recorded.',
    employeeInviteRoleHint:
      'One of the existing company roles. The role is recorded on the employee record, never in sign-in metadata.',
    employeeInviteSubmit: 'Send invitation',
    employeeInviteTarget: 'Invited person',
    employeeInviteState: 'Invitation state',
    employeeInvitePendingLabel: 'No provider confirmation yet',
    employeeInviteReconciliationLabel: 'Invitation reconciliation required',
    employeeInviteNoneLabel: 'No invitation recorded',
    employeeInviteRecordedLabel: 'Invitation recorded',
    employeeInviteDeliveryNote:
      'The provider holds an identity for this address. This does not confirm the mailbox received the message and enables no access.',
    employeeInviteUnconfirmedNote:
      'No delivery is confirmed and no access is enabled.',
    employeeInviteSuccess:
      'The invitation is recorded; no access has been enabled.',
    employeeInvitePending:
      'The invitation request is recorded; the provider has not confirmed it yet.',
    employeeInviteFailed:
      'The invitation request is recorded, but the provider step did not complete and no delivery is confirmed. The recorded invitation below shows the reconciliation state and the provider detail; retry under the same action.',
    employeeInviteEmailRecorded:
      'This email already belongs to a recorded employee, not a new person; handle it through the returning-person policy.',
    employeeInviteAlreadyRecorded:
      'An invitation is already recorded for this person.',
    employeeInviteRoleConflict:
      'A different role is already recorded for this open invitation.',
    employeeInviteKeyConflict:
      'This action key was used for a different invitation. Reopen the invitation form.',
    employeeInviteStale:
      'The invitation state changed. Reload before retrying.',
    employeeInviteChanged:
      'This employee changed while the invitation was sent; restart the invitation.',
    employeeInviteProviderUnavailable:
      'The server has no invitation configuration. The request is recorded; retry after configuration is restored.',
    employeeInviteLoadFailed: 'The invitation state did not load.',
    employeeInviteOpen: 'Record an invitation',
    // The fixed invitation destination (issue #68). The account-setup journey itself is a
    // separate ticket, so this surface claims no access and no delivery.
    inviteTitle: 'Invitation link destination',
    inviteLead:
      'This is the fixed destination of an invitation link. This page reads nothing about any invitation and does not confirm your invitation. The account-setup step for an invited person is not open in this release; once it is, an invited person can sign in with the invited email address. This page does not confirm the mailbox received the message and enables no access.',
    // People → Vendors (#73): the company directory and its one bounded create.
    vendorsLink: 'Vendors',
    vendorDirectory: 'Vendor directory',
    vendorDirectoryNote:
      'Recorded companies, distinct from owners, brokers and employees. Every active employee can read the directory; staff, managers and admins record vendors.',
    vendorDirectoryEmpty: 'No vendors are recorded.',
    vendorDirectoryEmptyQuery: 'No vendors match this search.',
    vendorDirectoryFailed: 'The vendor directory could not be loaded.',
    vendorPageInfo: 'This page: {n} vendors',
    vendorSearch: 'Search vendors',
    vendorSearchHint:
      'Enter a contiguous name fragment; accents are optional and % and _ are ordinary characters. At most 120 characters.',
    vendorCreate: 'Record a vendor',
    vendorCreateNote:
      'One company with one contact block, separate from owners, brokers and employees.',
    vendorCompanyName: 'Company name',
    vendorCompanyNameHint: 'The company name as recorded, 1 to 200 characters.',
    vendorContactName: 'Contact name',
    vendorPhones: 'Phone numbers',
    vendorPhonesHint:
      'One number per line, up to five. Numbers are preserved as typed.',
    vendorSourceAddress: 'Address / source text',
    vendorOptionalHint:
      'A blank field is unknown, not an empty value. Nothing is filled in automatically.',
    vendorCreateSubmit: 'Record vendor',
    vendorCreateInvalid: 'Check the company name, phone numbers and email.',
    vendorCreateConflict:
      'This submission key was already used for different vendor details. Your draft is kept; submitting again records a new vendor.',
    vendorCreateFailed:
      'The vendor was not recorded. Retry keeps your draft; a duplicate submission does not create another company.',
    vendorMaintainerOnly:
      'You can read this directory. Only staff, managers and admins may record vendors.',
    vendorDetailTitle: 'Vendor details',
    vendorDetailFailed: 'Vendor details could not be loaded.',
    vendorNotFound: 'The vendor was not found or you cannot read it.',
    vendorBackToDirectory: 'Back to the vendor directory',
    vendorRecordedAt: 'Recorded',
    vendorPropertyNote:
      'Supplier companies recorded on this property, separate from owners and brokers. A vendor link is not ownership, a reservation or rental occupancy.',
    vendorPropertyEmpty: 'No vendor is recorded on this property yet.',
    vendorPropertyFailed: "This property's vendors could not be loaded.",
    vendorLinkOpen: 'Link a recorded vendor',
    vendorLinkChoose: 'Choose a vendor',
    vendorLinkNone:
      'No vendor matches. Record the company in the vendor directory first.',
    vendorLinkSubmit: 'Link to this property',
    vendorLinkStale:
      'The property changed. Reload the page and link again; nothing was saved.',
    vendorLinkInvalid: 'That link was refused. Choose the vendor again.',
    vendorLinkMissing: 'The vendor or the current link was not found.',
    vendorLinkFailed:
      'The outcome could not be confirmed. Read the current information before retrying; do not automatically resubmit.',
    vendorUnlink: 'Unlink',
    vendorUnlinkConfirm:
      'Unlink this relationship? Only the current link is removed; the vendor and its other links remain.',
    vendorUnlinkYes: 'Confirm unlink',
    vendorLinkedProperties: 'Linked properties',
    vendorLinkedPropertiesNote:
      'Only properties you may read. An archived property stays hidden outside your role.',
    vendorLinkedPropertiesEmpty:
      'This vendor is not linked to any property you may read.',
    vendorLinkedPropertiesMore: 'Showing the first 50 linked properties.',
    vendorLinkedAt: 'Linked',
    vendorLinkedArchived: 'Archived',
    // People → Contacts (#71): the shared-identity directory, its Owners view and the
    // expansion that corrects the shared contact through the one maintenance operation.
    contactsLink: 'Contacts',
    contactDirectory: 'Contact directory',
    contactDirectoryNote:
      'One recorded person is shared by every linked property. The Owners view lists only records linked as an owner on a property you can read; the general classification does not decide it. Every active employee can correct the recorded details of a contact linked to a property.',
    contactViews: 'Directory view',
    contactViewAll: 'All contacts',
    contactViewOwners: 'Owners',
    contactSearch: 'Search contact name',
    contactSearchHint:
      'Matches the recorded name only, never a phone number. % and _ are ordinary characters. At most 120 characters.',
    contactColumnName: 'Contact',
    contactColumnRelation: 'Property relationship',
    contactColumnPhone: 'Recorded phone',
    contactPrimaryLink: 'Primary contact',
    contactColumnProperties: 'Linked properties',
    contactColumnActions: 'Actions',
    contactNoProperties: 'No linked property',
    contactPropertyCount: '{n} linked properties',
    contactPageInfo: 'This page: {n} contacts',
    contactDirectoryEmpty: 'No contacts are recorded.',
    contactDirectoryEmptyQuery: 'No contacts match this search.',
    contactOwnersEmpty:
      'No contact is recorded as an owner on a property you can read.',
    contactOwnersEmptyQuery: 'No owner matches this search.',
    contactDirectoryFailed: 'The contact directory could not be loaded.',
    contactOpen: 'Open and correct',
    // Unlinked-identity correction is staff/manager/admin (ticket #72); sales still see this note.
    contactUnlinkedNote:
      'Not linked to a property yet, so it cannot be corrected from this directory; this opens once the contact is linked to a property.',
    contactClose: 'Close details',
    contactLinkedProperties: 'Linked properties',
    contactLinkedPropertiesNote:
      'The relationship is recorded per property: the same person may be an owner on one and a broker on another. Every property listed above receives the change and shows the new details on its next read; a shared-contact correction is not recorded in property history.',
    contactClassifiedAs: 'General classification',
    contactRawPhoneText: 'Original phone text',
    contactEditorTitle: 'Correct the shared contact',
    contactSharedIdentityNote:
      'This is the shared contact: a correction applies to every property linked to it.',
    saving: 'Saving…',
    notes: 'Notes',
    signInHelp:
      'Access is limited to invited staff whose account has been activated.',
    north: 'North',
    northeast: 'Northeast',
    east: 'East',
    southeast: 'Southeast',
    south: 'South',
    southwest: 'Southwest',
    west: 'West',
    northwest: 'Northwest',
    signOutFailed:
      'Sign-out did not complete. Information is hidden; please retry.',
    accessChanged: 'Your access changed. Reload the page to continue.',
    // Canonical authentication design foundation (tickets #50–#52).
    brandRole: 'Real estate management system',
    brandTitle: "Saigon New House's real estate management system.",
    brandLede: 'Access is limited to staff who have been granted a role.',
    brandMeta: 'Saigon New House · Internal access',
    footNote: 'Saigon New House · Internal system',
    languageName: 'Ngôn ngữ / Language',
    switchToVi: 'Chuyển sang tiếng Việt',
    switchToEn: 'Switch to English',
    accountNote:
      'Accounts are issued by a Saigon New House administrator. If you have not received an invitation, contact the property management team.',
    remember: 'Keep me signed in',
    showPassword: 'Show password',
    hidePassword: 'Hide password',
    signingIn: 'Signing in…',
    emailRequired: 'Enter your email.',
    emailInvalid: 'That email address is not valid.',
    passwordRequired: 'Enter your password.',
    emailPlaceholder: 'name@company.com',
    recoveryEyebrow: 'Saigon New House · Account security',
    stepVerify: 'Verify',
    stepPassword: 'Password',
    stepDone: 'Done',
    recoverySending: 'Sending link…',
    recoverySentTitle: 'Check your email',
    resetInstructions:
      'The reset link is verified. Choose a new password for the account.',
    resetUpdating: 'Updating…',
    passwordDoneTitle: 'Password changed',
    passwordRulesUnmet: 'The password does not meet the security requirements.',
    passwordMismatch: 'The passwords do not match.',
    confirmRequired: 'Confirm your password.',
    ruleLength: 'At least 10 characters',
    ruleCase: 'Upper and lower case',
    ruleDigit: 'At least one number',
    ruleSymbol: 'At least one symbol',
    strength: 'Strength',
    strengthWeak: 'Weak',
    strengthFair: 'Fair',
    strengthGood: 'Good',
    strengthStrong: 'Strong',
    stepBack: 'Back',
    reservations: 'Reservations',
    reservationEffective: 'Effective reservation',
    reservationClaimant: 'Claimant',
    reservationExpires: 'Expires',
    reservationPending: 'Your request is pending review',
    reservationRequestedAt: 'Requested',
    reservationPendingExpires: 'Request expires',
    reservationPendingNote:
      'A pending request does not hold the property until it is approved.',
    reservationArchived: 'Archived records accept no new reservation request.',
    reservationReason: 'Reservation reason',
    reservationReasonHint: 'Between 10 and 2,000 characters.',
    reservationReasonRequired:
      'Enter a reason between 10 and 2,000 characters.',
    submitReservation: 'Submit reservation request',
    reservationRequested:
      'Request submitted. The property is not reserved until a manager or admin approves it.',
    reservationRequestFailed:
      'The reservation request was not submitted. Try again.',
    reservationRequests: 'Pending requests',
    reservationNoRequests: 'No pending requests.',
    reservationDecisionReason: 'Decision reason',
    reservationDays: 'Effective days (1–30)',
    reservationApprove: 'Approve reservation',
    reservationReject: 'Reject request',
    reservationApproved: 'Reservation approved.',
    reservationRejected: 'Request rejected.',
    reservationDecisionFailed: 'The decision was not recorded. Try again.',
    reservationConflict:
      'A reservation conflict occurred. The latest state is shown.',
    reservationUnavailable:
      'This property is no longer available for reservation.',
    reservationNotProceeding:
      'This reservation request can no longer proceed or be decided.',
    reservationSelfApproval: 'You cannot decide your own request.',
    reservationLoadFailed: 'Reservation state did not load.',
    reservationNote:
      'Only an approved, unexpired reservation holds the property.',
    reservationRelease: 'Release reservation',
    reservationReleaseReason: 'Release reason',
    reservationReleaseReasonHint: 'Between 10 and 2,000 characters.',
    reservationReleaseReasonRequired:
      'Enter a reason between 10 and 2,000 characters.',
    reservationReleaseSubmit: 'Release',
    reservationReleased:
      'Reservation released; the claimant and recorded events are retained.',
    reservationReleaseFailed: 'The reservation was not released. Try again.',
    reservationReleaseClosed:
      'This reservation can no longer be released. The latest state is shown.',
    reservationReleaseNote:
      'Release never erases the claimant, reason or recorded events.',
    completedSaleTitle: 'Confirm completed sale',
    completedSaleNote:
      'Only a manager or admin other than the credited employee can confirm. A property has at most one effective completed sale.',
    completedSaleCreditedCloser: 'Credited closer',
    completedSaleSelectCloser: 'Select an employee',
    completedSaleSuggestedCloser:
      'Effective reservation claimant: {name} — you must select a closer explicitly.',
    completedSaleDate: 'Actual completion date (Vietnam)',
    completedSaleReference: 'Contract/reference',
    completedSaleReferenceHint: 'Between 1 and 200 characters.',
    completedSaleReferenceRequired:
      'Select an employee and enter a valid date and reference.',
    completedSaleClosesReservations:
      'Confirming closes every open reservation and retains its claimant and events.',
    completedSaleSubmit: 'Confirm completed sale',
    completedSaleRecorded:
      'Completed sale recorded; the property is marked sold.',
    completedSaleFailed: 'The completion was not recorded. Try again.',
    completedSaleSelfCredit: 'You cannot credit your own sale.',
    completedSaleFutureDate: 'The completion date cannot be in the future.',
    completedSaleConflict:
      'The completion state changed. The latest state is shown.',
    completedSaleReservationConflict:
      'Another employee holds an effective reservation. Release it first.',
    completedSaleRentalActive:
      'An active rental commitment blocks this sale; close the rental first.',
    completedSaleUnavailable:
      'The property is {status}; a completion can only be recorded from available or negotiating.',
    completedSaleArchived: 'An archived record cannot be completed.',
    completedSaleNoCloser: 'No other employee is available to credit.',
    completedSaleLoadFailed: 'The completion state did not load.',
    completedSaleRecordedBy: 'Confirmed by',
    completedSaleRecordedAt: 'Recorded at',
    completedSalePreviousStatus: 'Pre-sale status',
    navCompletedSales: 'Completed sales',
    completedSalesRanking: 'Completed sales ranking',
    completedSalesNote:
      'Only independently confirmed completions count; reservations, raw sold statuses and unrecorded legacy sales earn no credit.',
    completedSales: 'Confirmed completed sales',
    completedSalesCount: 'Completed sales',
    completedSalesEmpty: 'No completed sale was confirmed in this period.',
    completedSalesTotal: 'Total: {n}',
    completedSalesUnknown:
      'Sold properties with no recorded closer (as of {date}): {n} — shown separately, never assigned to an employee.',
    completedSalesFailed: 'The completed-sales ranking did not load.',
    rank: 'Rank',
  },
};
export function label(
  locale: Locale,
  value: string | null | undefined,
): string {
  const dictionary = messages[locale];
  return value && Object.hasOwn(dictionary, value)
    ? dictionary[value as keyof typeof vi]
    : dictionary.unknown;
}
