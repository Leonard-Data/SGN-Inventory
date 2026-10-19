import type { Locale } from '@/i18n/messages';
// The status vocabulary itself comes from the inventory dictionary (`label`); this catalogue holds
// only the wording this workflow adds, in both languages.
const copy = {
  changeStatus: ['Đổi trạng thái', 'Change status'],
  statusLabel: ['Trạng thái mới', 'New status'],
  statusNote: ['Ghi chú (không bắt buộc)', 'Note (optional)'],
  statusNoteHint: [
    'Ví dụ: chủ nhà báo đã bán. Tối đa 500 ký tự.',
    'For example: the owner says it is sold. 500 characters at most.',
  ],
  statusSubmit: ['Lưu trạng thái', 'Save status'],
  statusSaving: ['Đang lưu…', 'Saving…'],
  statusSaved: ['Đã đổi trạng thái.', 'Status changed.'],
  statusRequested: [
    'Đã gửi yêu cầu; quản lý hoặc quản trị viên sẽ quyết định.',
    'Request sent; a manager or admin will decide.',
  ],
  statusPending: [
    'Một yêu cầu đổi trạng thái đang chờ quyết định.',
    'A status change is awaiting a decision.',
  ],
  saleFinalNote: [
    'Đã bán và đã cho thuê cần quản lý hoặc quản trị viên quyết định.',
    'Sold and rented need a manager or admin to decide.',
  ],
  statusArchived: [
    'Bất động sản đã lưu trữ không thể đổi trạng thái.',
    'An archived record cannot change status.',
  ],
  statusUnchanged: [
    'Bất động sản đang ở trạng thái này.',
    'The record already has this status.',
  ],
  statusRequestPending: [
    'Đã có một yêu cầu đổi trạng thái đang chờ quyết định cho bất động sản này.',
    'This record already has a status request awaiting a decision.',
  ],
  statusRequestDecided: [
    'Yêu cầu này đã được quyết định.',
    'This request has already been decided.',
  ],
  statusChanged: [
    'Trạng thái đã thay đổi sau khi yêu cầu được gửi; không áp dụng.',
    'The status changed after the request was raised, so it was not applied.',
  ],
  statusRefused: [
    'Không thể đổi trạng thái này.',
    'This status change is refused.',
  ],
  statusFailed: [
    'Chưa xác nhận được kết quả. Đọc lại trạng thái hiện tại trước khi thử lại.',
    'The outcome could not be confirmed. Read the current status before retrying.',
  ],
  statusTrail: ['Lịch sử trạng thái', 'Status history'],
  statusTrailNote: [
    'Mỗi lần đổi trạng thái đều được ghi lại, tách khỏi lịch sử giá.',
    'Every status change is recorded here, separately from price history.',
  ],
  statusTrailEmpty: [
    'Chưa có thay đổi trạng thái nào được ghi lại.',
    'No status change has been recorded yet.',
  ],
  statusSet: ['Đã đặt thành', 'Changed to'],
  statusRequestedBy: ['Yêu cầu bởi', 'Requested by'],
  statusAwaiting: ['Chờ quyết định', 'Awaiting decision'],
  statusApproved: ['Đã duyệt', 'Approved'],
  statusRejected: ['Đã từ chối', 'Rejected'],
  statusDecidedBy: ['Người quyết định', 'Decided by'],
  statusTrailFailed: [
    'Không tải được lịch sử trạng thái.',
    'The status history did not load.',
  ],
  refresh: ['Tải lại', 'Refresh'],
  queueTitle: ['Yêu cầu đổi trạng thái', 'Status change requests'],
  queueNote: [
    'Chỉ bất động sản đang chờ quyết định mới xuất hiện ở đây. Quyết định đã đưa ra vẫn đọc được trong lịch sử trạng thái của bất động sản.',
    'Only requests awaiting a decision appear here. A decided case stays readable in the record’s own status history.',
  ],
  queueEmpty: [
    'Không có yêu cầu nào đang chờ quyết định.',
    'No request is awaiting a decision.',
  ],
  queueDecisionReason: ['Lý do quyết định', 'Decision reason'],
  queueDecisionReasonHint: [
    'Từ 10 đến 2.000 ký tự.',
    'Between 10 and 2,000 characters.',
  ],
  queueApprove: ['Duyệt', 'Approve'],
  queueReject: ['Từ chối', 'Reject'],
  queueApproved: ['Đã duyệt yêu cầu.', 'Request approved.'],
  queueRejected: ['Đã từ chối yêu cầu.', 'Request rejected.'],
  queueDecideFailed: [
    'Chưa xác nhận được quyết định. Tải lại hàng đợi trước khi thử lại.',
    'The decision could not be confirmed. Reload the queue before retrying.',
  ],
  queueInvalidReason: [
    'Nhập lý do từ 10 đến 2.000 ký tự.',
    'Enter a reason between 10 and 2,000 characters.',
  ],
  queueFor: ['Bất động sản', 'Record'],
  queueRequestedAt: ['Yêu cầu lúc', 'Requested at'],
  loadFailed: ['Không tải được dữ liệu.', 'The data did not load.'],
  unavailable: [
    'Không thể kết nối. Vui lòng thử lại.',
    'Could not connect. Try again.',
  ],
} as const;
export type StatusCopyKey = keyof typeof copy;
export function statusText(locale: Locale) {
  return Object.fromEntries(
    Object.entries(copy).map(([key, values]) => [
      key,
      values[locale === 'vi' ? 0 : 1],
    ]),
  ) as Record<StatusCopyKey, string>;
}
// Every refusal the workflow raises has its own sentence; anything unrecognised stays a plain
// retry rather than a guess about what the database refused.
export function statusMessage(locale: Locale, code: string | null | undefined) {
  const text = statusText(locale);
  switch (code) {
    case 'property-archived':
      return text.statusArchived;
    case 'status-unchanged':
      return text.statusUnchanged;
    case 'status-request-pending':
      return text.statusRequestPending;
    case 'status-request-decided':
      return text.statusRequestDecided;
    case 'status-changed':
      return text.statusChanged;
    case 'invalid-input':
      return text.statusRefused;
    default:
      return text.statusFailed;
  }
}
