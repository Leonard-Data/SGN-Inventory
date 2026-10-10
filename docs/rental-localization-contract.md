# Required localization and rental contract — version 0.2.0

This is a normative extension to `database-contract.md`. The user added it on 10 October 2026. Migration 4 implements the database foundation; the Next.js UI, localization dictionaries and real service integration remain implementation work.

## 1. Two required languages, Vietnamese regional data

The application MUST support **Vietnamese (VN / Tiếng Việt)** and **English (EN)**. Internal language codes are `vi` and `en`; `vn` is not an API locale. Default is `vi`. Persist the signed-in employee's selection in `employees.preferred_locale` using `set_my_locale(p_locale)`. Read that preference after login and keep a matching cookie for initial rendering; a cookie must not change permissions.

Translate the entire interface: navigation, page titles, filters, forms, field hints, validation, dialogs, status badges, empty/loading/error states, notifications and dashboards. Dictionaries MUST have matching key sets. Every controlled backend value has both labels. Language switching must update current components without changing persisted property/rental/payment values or losing unsaved input. A missing translation is a test failure; use Vietnamese fallback only as an error-recovery measure.

Vietnamese localization applies in either language:

- Preserve Unicode names, house/alley strings, original legal text and old/new address versions. Translate field labels, not the source addresses or uploaded documents.
- All monetary values are VND, transmitted as invariant whole-VND decimal strings; no foreign-currency conversion. Localized input is normalized and validated before sending the API value. Never send `12.000.000` or `12,000,000` as a numeric API string.
- Show `12.000.000 ₫` or a clearly labeled tỷ/triệu value in Vietnamese; `VND 12,000,000` in English is acceptable. Monthly rent must explicitly say “/tháng” or “/month”.
- Use m²/metres, text phone numbers and `+84` normalization where verified. Keep Vietnam's commune/province selections and legacy district labels consistent with the address contract.
- Business date/time and month boundaries always use `Asia/Ho_Chi_Minh`, irrespective of device location or UI language. Display `dd/MM/yyyy` in both languages (`vi-VN` / `en-GB`); store UTC instants and date-only rental terms separately.
- `rental_agreements.contract_language` describes the signed document language; changing UI language does not change that value or translate a contract.

Implementation paths: `src/i18n/vi.ts`, `src/i18n/en.ts`, locale/provider support, and a dictionary-parity check. They are planned frontend deliverables, not existing components in this foundation.

## 2. Rental lifecycle and whole-property inventory

| Backend value | Vietnamese label | English label |
| --- | --- | --- |
| Agreement `draft` | Hợp đồng nháp | Draft agreement |
| Agreement `active` | Hợp đồng đã kích hoạt | Activated agreement |
| Agreement `ended` | Đã kết thúc | Ended |
| Agreement `canceled` | Đã hủy | Canceled |
| Occupancy `scheduled` | Chưa bắt đầu thuê | Scheduled tenancy |
| Occupancy `occupied` | Đang cho thuê | Occupied |
| Occupancy `expired` | Hết hạn, chờ đóng hợp đồng | Expired, awaiting closure |
| Month `scheduled` | Tháng thuê sắp tới | Upcoming rental month |
| Month `active` | Tháng thuê đang hoạt động | Active rental month |
| Month `completed` | Tháng thuê đã kết thúc | Completed rental month |
| Month `voided` | Tháng thuê đã hủy | Voided rental month |

The MVP rents the **whole property** to one agreement at a time; rooms/units and overlapping tenancy schedules are not modeled. Properties must have `listing_mode = rent` or `both` and a usable inventory state. Staff/manager/admin creates a draft with tenant, inclusive start/end dates, contract reference, agreed monthly rent, due day and proration rule. The term spans at most 120 calendar months.

A different active manager/admin activates the draft. Activation is atomic: lock property → agreement, check exclusivity, generate monthly records, record approval, set inventory to `rented`. An existing effective approved commission reservation must be released through its audited workflow first; activation never rewrites its claimant. Activation may be scheduled for a future start. Stored property `rented` therefore means committed tenancy, while `v_rental_property_status.occupancy_status` distinguishes scheduled from currently occupied.

An active agreement whose end date has passed has derived occupancy `expired` and awaits reviewer closure. Do not automatically delete it or treat overdue rent as permission to reopen inventory. Ending an active agreement requires an actual end date within its inclusive term and no later than today in Vietnam. Cancellation is allowed for a draft or an activated agreement that has not started. Once occupancy has begun, use `ended`, not `canceled`.

Closure records reviewer/time/reason. It recalculates the final month according to the agreed rule, voids future monthly dues, and makes the property available if this agreement held it as rented. An active rental prevents directly changing property status to available/sold/withdrawn, changing listing mode to sale-only, or archiving the property. End/cancel first.

Draft amendments and rent changes midterm are not exposed by this foundation. Correct a draft by canceling it and creating a reviewed replacement with a distinct reference. A future amendment workflow must preserve already confirmed monthly snapshots.

## 3. Monthly occupancy and dues

`rental_months` has one row per agreement/calendar month. `month_start` is the first day. `occupied_from` and `occupied_to` are the inclusive contractual dates intersecting that month. `occupied_days` in the view means contractual/billable days for an open month, including future scheduled days; it is not proof of physical attendance. Voided months have zero billable days.

`is_active_month` is true only when the agreement is active, the month is open, and today's Vietnam date is within its occupied date range. Do not use payment state or page-view counts to determine an active rental month. `month_phase` separates upcoming/current/completed/voided periods. Active-month reporting uses the date rule; historical reports retain the past monthly records after closure.

Monthly due snapshots use `monthly_rent_vnd` from the agreement, not the property's advertised rent. The property's advertised rent remains inventory marketing data.

| Rule | Amount due |
| --- | --- |
| `calendar_days` (default) | `round(agreed_monthly_rent × billable_days ÷ calendar_days_in_month)` in whole VND |
| `full_month` | Full agreed monthly rent for any occupied part of the month |

The rule must be explicit and reviewed before activation. The due day is 1–28, default 5, for reliable month lengths. First partial month due date is the later of occupied-from and the selected due day. These are MVP defaults, not a statement about legal rental obligations. Record the actual agreed rule.

Future periods voided by termination/cancellation have zero due. Confirmed receipts are preserved. If a reduced/voided due is below net confirmed receipts, the view shows `refund_due_vnd`; it does not automatically issue a refund or hide money previously received.

## 4. Manual rent payment tracking

Each payment entry belongs to exactly one rental month and records a positive whole-VND amount, `receipt`/`refund`, paid date, cash/bank-transfer/other method, reference, optional ready evidence, recorder and retry key. Multi-month advance receipts need separate reviewed allocations/entries per month with the same transaction reference; verify the total against the real bank receipt. This foundation does not implement a bank transaction allocation ledger or automatic matching.

| Status | Vietnamese | English | Balance effect |
| --- | --- | --- | --- |
| Entry `pending` | Chờ xác nhận | Pending confirmation | None |
| Entry `confirmed` | Đã xác nhận | Confirmed | Receipt adds; refund subtracts |
| Entry `rejected` | Từ chối | Rejected | None |
| Entry `voided` | Đã vô hiệu | Voided | None; original record retained |
| Month `unpaid` | Chưa thanh toán | Unpaid | Nothing confirmed |
| Month `partial` | Thanh toán một phần | Partially paid | Positive net paid below due |
| Month `paid` | Đã thanh toán đủ | Paid | Net paid equals due |
| Month `refund_due` | Cần hoàn tiền | Refund due | Net paid exceeds revised due |
| `is_overdue` | Quá hạn | Overdue | Due date passed and balance remains |

Staff/manager/admin records entries. Another manager/admin independently confirms/rejects them or voids an incorrect confirmed entry with a reason. Self review is forbidden. Sales can read tenancy status, but not rental month/payment details. All writes use RPCs; direct table DML and hard deletes are denied.

Only confirmed entries affect `net_paid_vnd = receipts − refunds`. `balance_due_vnd = max(due − net_paid, 0)` and `refund_due_vnd = max(net_paid − due, 0)`. Partial payment can also be overdue, so overdue is a separate flag. Reject confirmation of a receipt exceeding remaining monthly due or a refund exceeding confirmed net paid. Voiding a receipt cannot make the month net balance negative after earlier refunds.

Void means correcting an erroneous record; it is not proof that funds were returned. If real funds were returned, record a refund and independently confirm its evidence. After termination, refunds against an overpaid/voided month remain possible, while new receipts for a voided month are rejected. Prior outstanding rent on an open month can still be recorded after the agreement ends.

This is manual rent tracking. It does not collect money, integrate a gateway, calculate commission, issue tax invoices, maintain deposits/utility/penalty schedules, or perform full accounting. Those require separate requirements. Payment confirmation must reflect real payment evidence.

## 5. Public RPCs and read views

| API | Parameters | Access / result |
| --- | --- | --- |
| `set_my_locale` | `p_locale text` (`vi`/`en`) | Active employee; updates own preference only |
| `create_rental_agreement` | Property/tenant UUIDs, `p_code`, `p_start`, `p_end`, whole-VND `p_rent`, optional `p_due_day=5`, `p_proration='calendar_days'`, `p_language='vi'` | Staff/manager/admin; draft UUID |
| `activate_rental_agreement` | `p_agreement_id uuid` | Independent manager/admin; creates monthly snapshots |
| `close_rental_agreement` | `p_agreement_id`, `p_status` (`ended`/`canceled`), `p_end_on` (required for ended), `p_reason` | Manager/admin; preserve history and close inventory commitment |
| `record_rental_payment` | `p_month_id`, `p_kind`, whole-VND `p_amount`, `p_paid_on`, `p_method`, `p_key uuid`, optional `p_reference`, `p_evidence` | Staff/manager/admin; pending payment UUID |
| `decide_rental_payment` | `p_payment_id`, `p_action` (`confirm`/`reject`/`void`), `p_reason` | Independent manager/admin; audited transition |
| `v_rental_property_status` | Read/filter agreement/property | All active employees; contract and derived occupancy |
| `v_rental_month_status` | Read/filter month/agreement/property | Staff/manager/admin; phase, billable days, active flag, dues/net/balance/refund/overdue |

Payment retry keys are employee-scoped. Exact repeats return the same UUID; reusing a key with different month/amount/date/method/reference/evidence is rejected. Confirmation, correction and closure lock in consistent order: property → agreement → month → payment. Retries after an ambiguous decision response must read the current state rather than submit a second monetary record.

## 6. Migration and acceptance rules

Existing sale/rent mode and advertised rent values do not establish an active tenancy, tenant identity, lease term or payment. Import no rental agreements/months/receipts from inferred spreadsheet status alone. Obtain verified contracts and payment records or start new rental tracking through the UI.

Required acceptance: VI/EN dictionary parity and full flows; language preference persisted across login; Vietnam day/month boundaries; partial/full month proration including February; independent activation; concurrent agreement/payment decisions; pending payments excluded; partial/paid/overdue calculations; receipt/refund limits; early termination with preserved receipts and refund balance; sales/inactive payment privacy; confirmed-history/audit retention.
