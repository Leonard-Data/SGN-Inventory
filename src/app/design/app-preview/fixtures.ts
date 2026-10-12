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
