# Mapping Databases.xlsx to the MVP

Profiled the complete provided workbook, not just sample rows. The sanitized `workbook-profile.json` includes its SHA-256, row counts and issue counts. Physical source row numbers include the header; counts below exclude headers and fully empty rows.

## Sheet inventory

| Sheet | Records | Destination / decision |
| --- | ---: | --- |
| Thông tin dự án | 19,233 | Properties, legacy addresses and embedded owner contacts after review |
| Loại Hình | 2 | Listing modes (sale/rent), not physical property types |
| Loại dự án | 18 | Reviewed physical/access classification; source property rows use labels |
| Nhân viên | 17 | Proposed employee roster, inactive until role review and Auth linkage |
| Contracts | 20,480 | Owner/contact rows despite English sheet name; quarantine unresolved references |
| Historical | 19,151 | Private legacy history archive; do not fabricate new approval audit |
| Attachments | 2,544 | Attachment metadata plus separately retrieved file bytes |
| clicks | 56,932 | Page views only, after property/employee resolution |
| Trạng thái dự án | 6 | Controlled status mapping |
| Quận | 22 | Historical label reference, not current administrative catalog |
| Phường | 367 | Historical ward/district labels; app IDs are not official government codes |
| Cities | 2 | Source labels; property sheet's nonblank city labels are HCMC |
| Login | 0 | Excluded entirely |

## Identity and foreign-reference findings

| Finding | Count / implication |
| --- | --- |
| Nonblank distinct property IDs | 19,209 |
| Property rows with no ID | 23 — quarantine identity until resolved |
| Duplicated nonblank property keys | 1 key shared by 2 rows — never upsert both to a single property automatically |
| Unique-ID rows before other checks | 19,208 — not a final migration success count |
| Contracts direct property-ID matches | 0 / 20,480 |
| Historical unambiguous direct matches | 18,829 / 19,151; 322 unresolved/ambiguous |
| Attachments unambiguous direct matches | 2,468 / 2,544; 76 unresolved |
| clicks unambiguous direct matches | 56,431 / 56,932; 501 unresolved/ambiguous |

`Contracts` references use a different key system, largely `BDS-…`; current property IDs have no `BDS-` keys. Do not construct a conversion from worksheet row position. Obtain the former AppSheet export/key mapping or review aliases against reliable property evidence. Store approved alias decisions in `private.property_source_map`. For the duplicate property key, use explicitly reviewed row-specific source keys; related historical references cannot choose between those properties without additional evidence.

## Property-column transformations

| Source column | Destination | Rule |
| --- | --- | --- |
| PropertyID | `private.property_source_map.source_key` | Canonical property UUID is independent; keep source key as provenance; only unambiguous reviewed mappings |
| Tên người tạo | Staging provenance | Display-name fallback only; never identifies an Auth account |
| Email Người Tạo | `properties.created_by` via reviewed employee map | Normalize email; unresolved authors remain source provenance, not invented employees |
| Ngày Tạo | `properties.entry_on` + `entry_source='legacy'`; `properties.created_at` stays the record creation time | Use the source value as the original inventory entry date only when it is a reliable entry date, interpreting a naive datetime in Vietnam only after confirmation; retain the raw value in staging. Unreliable or absent values leave `entry_on` null with `entry_source='unknown'` instead of substituting `created_at` or the import day |
| Tên chủ sở hũu | `contacts.display_name` | Generic names such as owner shorthand do not establish identity |
| Số điện thoai | `contacts.phones` + `raw_phone_text` | Split multiple values; normalized valid mobile strings; preserve invalid/landline text for review |
| Địa chỉ dự án | `property_addresses.address_text`, format legacy | Preserve exactly; no automatic new ward |
| Chiều ngang | `properties.frontage_m` | Positive numeric metres; invalid/zero stays unresolved/null after reviewed disposition |
| Chiều dài | `properties.depth_m` | Positive numeric metres |
| Tổng diện tích | `land_area_m2` + `area_raw` | Parse explicit m²/m2; preserve reported area and do not overwrite with width × depth |
| Loại Hình | `listing_mode` | `caee82465r` → sale; `caee82465b` → rent |
| Loại Dự án | `access_type` and/or `property_type` | Separate alley/frontage labels from house/land/apartment labels |
| Tạo mới | `status` | Column actually stores state; use status table below |
| Hướng nhà | `direction` | Vietnamese direction → controlled compass code |
| Ghi Chú Thêm | `notes` | Preserve source text; history-style embedded messages are not separate reliable events |
| Giá Bán (tỷ Đồng) | `sale_price_vnd` | Decimal × 1,000,000,000; whole-VND result; no float arithmetic |
| Giá Thuê (triệu Đồng) | `monthly_rent_vnd` | Decimal × 1,000,000; zero is a source value, not automatically null |
| Thành phố | `property_addresses.province_text` | Legacy label; match to official dated unit only after review |
| Quận | `district_text` | Legacy address only |
| Phường | `commune_text` | Match in the context of legacy province/district |
| Tên Đường | `street` | Preserve Unicode spelling and source text |
| Địa Chỉ | `house_number` | Text; retain slashes, alley notation and suffixes |
| Ngày Chỉnh Sửa gần nhất | Source updated time / `updated_at` during trusted import | Retain source instant; normal app trigger uses server mutation time |
| Note | Staging or labeled notes | Do not replace another notes column silently |
| Temp Value | Staging only | Unclear semantics; do not treat as authoritative price |
| Người chỉnh sửa | `updated_by` via reviewed employee map | Keep unresolved source value; never grant authority from it |
| Kết cấu | `construction_text` | Free text; structured floors/rooms are null unless explicitly confirmed |
| Approved | Staging provenance | Not reservation approval; only 4 true cells, many null/false. Import record review starts pending |

## State and category mapping

| Source state | Target state | Reservation implication |
| --- | --- | --- |
| Tạo mới | draft | None |
| Đang bán | available | Request allowed once validated |
| Đang Thương lượng | negotiating | Request allowed |
| Đang giao dịch | negotiating | Does not create an approved reservation |
| Đã bán | sold | Historical inventory state; no commission or claimant inferred |
| Ngưng Bán | withdrawn | No new reservation |
| Empty / unknown | Quarantine or reviewed correction | No silent default to available |

`Mặt tiền` and `Mặt Tiền` both map to street_front; Hẻm ô tô → car_alley; Hẻm xe máy → motorbike_alley; Ba Gác → three_wheeler_alley. These labels alone do not prove physical house type. Nhà/Nhà nát → house; Đất ở → land; Chung cư → apartment; Vila/ Biệt thự → villa; Căn hộ dịch vụ → serviced_apartment. Unrecognized values stay unclassified/unknown with an issue. Three source category values require review because they are not valid classifications.

## Other-sheet rules

- `Nhân viên`: name/email/phone → employee roster; proposed role map sales labels → sales, Thư ký → staff, TPKD → manager, Admin → admin. Human review authorizes it. Avatar paths can be migrated later to a separate private employee bucket; not part of property files. Password and Monitor are not used for Auth/roles.
- `Contracts`: PhoneID is masked and not a global contact key. After alias resolution, preserve owner name/phone text and create property/contact links. Prefer embedded property-sheet contacts as an initial reviewed contact source; do not discard the unresolved Contracts rows.
- `Historical`: History_ID, Dự án, editor, old prices/phone/area/status/direction/category/notes, date and Chấp nhận remain a private source archive. It is distinct from the new system's immutable audit events.
- `Attachments`: attachmentID, property reference, URL and modified date are provenance. The URL values are relative AppSheet paths, not downloadable binaries or proof of document type. Retrieve originals from the actual backing drive; verify hashes, type/size, and property linkage before ready status.
- `clicks`: ID is source provenance; Dự án → resolved property; Nhân viên → reviewed employee; detailed timestamp preferred over date-only value. Repeated/ambiguous source IDs need review. Source phone values remain private provenance if required, never activity KPI content.

## Known preparation issues

The conservative script flags 2,174 property phone values for review, 98 sale-price strings with ambiguous notation, one sale price beyond the schema numeric range, two ambiguous rent values and nonpositive dimensions/areas. Issue categories overlap; do not sum issue counts as rejected row counts. Most of these are recoverable data-quality decisions, not grounds to delete the source row.

The script prepares candidates and issues; it does not apply them to Supabase or declare them correct. `unclassified`, unresolved addresses and null uncertain values are acceptable only with explicit review and visible UI labels. Preserve source evidence in private staging.
