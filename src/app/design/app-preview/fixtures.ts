// Fictional fixture records for the design review route only. They never reach
// a product surface and carry no customer data: three shapes matter — a full
// plot, a floor-area-only record (unit mode) and a record with no areas at all
// (the plate's placeholder).
import type { PropertySummary } from '@/features/properties/types';
import type { RecordFields } from '@/features/properties/plate-geometry';

export const summaryFixtures: PropertySummary[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    propertyCode: 'SNH-0148',
    listingMode: 'sale',
    status: 'available',
    coverFileId: null,
    frontageM: '8',
    depthM: '15',
    landAreaM2: '120',
    floorAreaM2: '216',
    floors: 3,
    direction: 'S',
    accessType: 'alley',
    // The chronological inventory views carry the recorded entry date, its provenance and the
    // database's Vietnam age; this fixture is a reliable legacy date.
    entryOn: '2023-02-03',
    entrySource: 'legacy',
    ageDays: 1348,
    createdBy: 'Nguyễn Thu Hà',
    addresses: [
      {
        id: '21111111-1111-4111-8111-111111111111',
        format: 'current',
        addressText: '12 Đường Nguyễn Trãi, Phường Bến Thành',
        mappingStatus: 'verified',
        isPrimary: true,
      },
    ],
  },
  {
    id: '12222222-2222-4222-8222-222222222222',
    propertyCode: 'SNH-0147',
    listingMode: 'rent',
    status: 'negotiating',
    coverFileId: null,
    frontageM: null,
    depthM: null,
    landAreaM2: null,
    floorAreaM2: '88',
    floors: 1,
    direction: 'NE',
    accessType: 'street',
    // An explicit unknown entry date, shown apart from an invented or import-day date.
    entryOn: null,
    entrySource: 'unknown',
    ageDays: null,
    createdBy: null,
    addresses: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        format: 'current',
        addressText: '45 Đường Nguyễn Hữu Cảnh, Phường 22',
        mappingStatus: 'candidate',
        isPrimary: true,
      },
    ],
  },
  {
    id: '13333333-3333-4333-8333-333333333333',
    propertyCode: 'SNH-0146',
    listingMode: 'sale',
    status: 'draft',
    coverFileId: null,
    frontageM: null,
    depthM: null,
    landAreaM2: null,
    floorAreaM2: null,
    floors: null,
    direction: null,
    accessType: null,
    // No resolvable creator: the card shows nothing rather than a placeholder.
    createdBy: null,
    addresses: [],
  },
];

export const plateFixtures: (RecordFields & {
  property_code: string;
})[] = [
  {
    property_code: 'SNH-0148',
    frontage_m: 8,
    depth_m: 15,
    land_area_m2: 120,
    floor_area_m2: 216,
    floors: 3,
    direction: 'S',
    access_type: 'alley',
  },
  {
    property_code: 'SNH-0147',
    floor_area_m2: 88,
    floors: 1,
    direction: 'NE',
  },
  {
    property_code: 'SNH-0146',
  },
];

// Fictional fixtures for the design review route only: the record rail's asking-price rows
// and change timeline, and the people directory (employee accounts and contact book). The
// product renders those surfaces from real data now, so nothing here is wired to a session
// or a table.
export type PriceFixture = {
  when: string;
  from: string | null;
  to: string;
  who: string;
};

export const priceFixtures: PriceFixture[] = [
  {
    when: '2026-10-12',
    from: '4200000000',
    to: '4500000000',
    who: 'Nguyễn Thu Hà',
  },
  {
    when: '2026-09-28',
    from: '4000000000',
    to: '4200000000',
    who: 'Nguyễn Thu Hà',
  },
  { when: '2026-09-10', from: null, to: '4000000000', who: 'Trần Bảo' },
];

export type ChangeFixture = {
  when: string;
  time: string;
  title: [string, string];
  body: [string, string];
  actor: string;
};

export const changeFixtures: ChangeFixture[] = [
  {
    when: '2026-10-12',
    time: '09:41',
    title: ['Ghi nhận hồ sơ', 'Record created'],
    body: [
      'Nhập từ danh sách bàn giao; địa chỉ và giá giữ nguyên bản gốc.',
      'Imported from the handover list; address and price kept as recorded.',
    ],
    actor: 'Trần Bảo',
  },
  {
    when: '2026-10-10',
    time: '15:02',
    title: ['Đính chính địa chỉ', 'Address corrected'],
    body: [
      'Phường thử nghiệm → Phường Bến Thành; bản ghi gốc được giữ.',
      'Phường thử nghiệm → Phường Bến Thành; the original is retained.',
    ],
    actor: 'Nguyễn Thu Hà',
  },
  {
    when: '2026-09-30',
    time: '11:20',
    title: ['Thăm bất động sản', 'Property visited'],
    body: [
      'Mặt tiền và số tầng đối chiếu tại chỗ, ảnh đã tải lên.',
      'Frontage and storeys checked on site, photographs uploaded.',
    ],
    actor: 'Lê Minh Anh',
  },
];

export type EmployeeFixture = {
  initials: string;
  name: string;
  email: string;
  role: [string, string];
  status: [string, string];
  tone: 'success' | 'warn' | 'neutral';
  active: string;
};

export const employeeFixtures: EmployeeFixture[] = [
  {
    initials: 'NH',
    name: 'Nguyễn Thu Hà',
    email: 'ha.nguyen@saigonnewhouse.vn',
    role: ['Quản trị viên', 'Administrator'],
    status: ['Đang hoạt động', 'Active'],
    tone: 'success',
    active: '12/10/2026 · 09:41',
  },
  {
    initials: 'BT',
    name: 'Trần Bảo',
    email: 'bao.tran@saigonnewhouse.vn',
    role: ['Quản lý', 'Manager'],
    status: ['Đang hoạt động', 'Active'],
    tone: 'success',
    active: '12/10/2026 · 08:15',
  },
  {
    initials: 'MA',
    name: 'Lê Minh Anh',
    email: 'minh.anh@saigonnewhouse.vn',
    role: ['Kinh doanh', 'Sales'],
    status: ['Đã mời', 'Invited'],
    tone: 'warn',
    active: '—',
  },
  {
    initials: 'PL',
    name: 'Phạm Khánh Linh',
    email: 'khanh.linh@saigonnewhouse.vn',
    role: ['Kinh doanh', 'Sales'],
    status: ['Đã vô hiệu hóa', 'Inactive'],
    tone: 'neutral',
    active: '02/08/2026 · 17:30',
  },
];

export type ContactFixture = {
  initials: string;
  name: string;
  relation: [string, string];
  phone: string;
  properties: number;
};

export const contactFixtures: ContactFixture[] = [
  {
    initials: 'TL',
    name: 'Trần Văn Lộc',
    relation: ['Chủ sở hữu', 'Owner'],
    phone: '0903 118 244',
    properties: 1,
  },
  {
    initials: 'TT',
    name: 'Lê Thu Trang',
    relation: ['Người thuê', 'Tenant'],
    phone: '0912 774 006',
    properties: 2,
  },
  {
    initials: 'QH',
    name: 'Nguyễn Quốc Huy',
    relation: ['Môi giới', 'Agent'],
    phone: '0938 402 517',
    properties: 3,
  },
  {
    initials: 'BN',
    name: 'Vũ Bích Ngọc',
    relation: ['Liên hệ khác', 'Other contact'],
    phone: '—',
    properties: 0,
  },
];
