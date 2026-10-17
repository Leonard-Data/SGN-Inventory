import type { Json } from '@/types/database';
export type Target = 'property' | 'address' | 'mapping' | 'contact' | 'link';
export type Changes = Record<string, Json>;
type Field = {
  vi: string;
  en: string;
  kind?:
    | 'money'
    | 'decimal'
    | 'count'
    | 'boolean'
    | 'phones'
    | 'uuid'
    | 'date'
    | 'coordinate';
  options?: readonly string[];
  required?: boolean;
};
export const fields: Record<string, Field> = {
  listing_mode: {
    vi: 'Mục đích đăng',
    en: 'Listing mode',
    options: ['sale', 'rent', 'both'],
    required: true,
  },
  property_type: {
    vi: 'Loại bất động sản',
    en: 'Property type',
    options: [
      'unclassified',
      'house',
      'land',
      'apartment',
      'villa',
      'serviced_apartment',
    ],
    required: true,
  },
  access_type: {
    vi: 'Lối tiếp cận',
    en: 'Access',
    options: [
      'unknown',
      'street_front',
      'car_alley',
      'motorbike_alley',
      'three_wheeler_alley',
    ],
    required: true,
  },
  status: {
    vi: 'Trạng thái kho',
    en: 'Inventory status',
    options: [
      'draft',
      'available',
      'negotiating',
      'withdrawn',
      'sold',
      'rented',
    ],
    required: true,
  },
  sale_price_vnd: {
    vi: 'Giá bán (VND nguyên)',
    en: 'Asking sale price (whole VND)',
    kind: 'money',
  },
  monthly_rent_vnd: {
    vi: 'Giá thuê tháng (VND nguyên)',
    en: 'Monthly asking rent (whole VND)',
    kind: 'money',
  },
  land_area_m2: {
    vi: 'Diện tích đất (m²)',
    en: 'Land area (m²)',
    kind: 'decimal',
  },
  floor_area_m2: {
    vi: 'Diện tích sàn (m²)',
    en: 'Floor area (m²)',
    kind: 'decimal',
  },
  frontage_m: { vi: 'Mặt tiền (m)', en: 'Frontage (m)', kind: 'decimal' },
  depth_m: { vi: 'Chiều sâu (m)', en: 'Depth (m)', kind: 'decimal' },
  floors: { vi: 'Số tầng', en: 'Floors', kind: 'count' },
  bedrooms: { vi: 'Phòng ngủ', en: 'Bedrooms', kind: 'count' },
  bathrooms: { vi: 'Phòng tắm', en: 'Bathrooms', kind: 'count' },
  direction: {
    vi: 'Hướng',
    en: 'Direction',
    options: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  },
  ownership_type: {
    vi: 'Hình thức sở hữu theo nguồn',
    en: 'Source ownership type',
    options: ['unknown', 'individual', 'joint', 'organization'],
  },
  parcel_number: { vi: 'Số thửa theo nguồn', en: 'Source parcel number' },
  map_sheet_number: { vi: 'Số tờ bản đồ', en: 'Map sheet number' },
  construction_text: {
    vi: 'Thông tin xây dựng theo nguồn',
    en: 'Source construction information',
  },
  area_raw: { vi: 'Diện tích theo nguồn', en: 'Source area text' },
  notes: { vi: 'Ghi chú', en: 'Notes' },
  latitude: { vi: 'Vĩ độ', en: 'Latitude', kind: 'coordinate' },
  longitude: { vi: 'Kinh độ', en: 'Longitude', kind: 'coordinate' },
  format: {
    vi: 'Dạng địa chỉ',
    en: 'Address format',
    options: ['legacy', 'current'],
    required: true,
  },
  address_text: { vi: 'Địa chỉ đã biết', en: 'Known address', required: true },
  house_number: { vi: 'Số nhà', en: 'House number' },
  street: { vi: 'Đường', en: 'Street' },
  province_text: {
    vi: 'Tỉnh / thành phố theo nguồn',
    en: 'Source province / city',
  },
  district_text: {
    vi: 'Quận / huyện (địa chỉ cũ)',
    en: 'District (legacy only)',
  },
  commune_text: { vi: 'Xã / phường theo nguồn', en: 'Source commune / ward' },
  province_unit_id: {
    vi: 'Tỉnh / thành phố trong danh mục',
    en: 'Official province / city',
    kind: 'uuid',
  },
  district_unit_id: {
    vi: 'Quận / huyện trong danh mục cũ',
    en: 'Official legacy district',
    kind: 'uuid',
  },
  commune_unit_id: {
    vi: 'Xã / phường trong danh mục',
    en: 'Official commune / ward',
    kind: 'uuid',
  },
  is_primary: { vi: 'Chính', en: 'Primary', kind: 'boolean' },
  mapping_status: {
    vi: 'Trạng thái ánh xạ',
    en: 'Mapping state',
    options: ['unresolved', 'candidate', 'verified'],
    required: true,
  },
  verification_method: {
    vi: 'Cách xác minh',
    en: 'Verification method',
    options: ['manual', 'boundary', 'document', 'official_whole_mapping'],
  },
  source_url: { vi: 'URL nguồn bằng chứng', en: 'Evidence source URL' },
  effective_on: { vi: 'Ngày có hiệu lực', en: 'Effective date', kind: 'date' },
  mapping_evidence: {
    vi: 'Bằng chứng của bất động sản',
    en: 'Property-level mapping evidence',
  },
  display_name: { vi: 'Tên người liên hệ', en: 'Contact name', required: true },
  phones: {
    vi: 'Số điện thoại (mỗi dòng một số)',
    en: 'Phones (one source string per line)',
    kind: 'phones',
  },
  raw_phone_text: { vi: 'Điện thoại theo nguồn', en: 'Original phone text' },
  contact_type: {
    vi: 'Loại người liên hệ',
    en: 'Contact classification',
    options: [
      'unknown',
      'owner',
      'broker',
      'representative',
      'buyer',
      'tenant',
    ],
    required: true,
  },
  contact_id: { vi: 'Người liên hệ', en: 'Contact identity', kind: 'uuid' },
  relation: {
    vi: 'Quan hệ với bất động sản',
    en: 'Property relationship',
    options: ['unknown', 'owner', 'broker', 'representative', 'tenant'],
    required: true,
  },
  remove: { vi: 'Gỡ liên kết', en: 'Unlink', kind: 'boolean' },
};
export const targetFields: Record<Target, readonly string[]> = {
  property: [
    'listing_mode',
    'property_type',
    'access_type',
    'status',
    'sale_price_vnd',
    'monthly_rent_vnd',
    'land_area_m2',
    'floor_area_m2',
    'frontage_m',
    'depth_m',
    'floors',
    'bedrooms',
    'bathrooms',
    'direction',
    'ownership_type',
    'parcel_number',
    'map_sheet_number',
    'construction_text',
    'area_raw',
    'notes',
    'latitude',
    'longitude',
  ],
  address: [
    'format',
    'address_text',
    'house_number',
    'street',
    'province_text',
    'district_text',
    'commune_text',
    'province_unit_id',
    'district_unit_id',
    'commune_unit_id',
    'is_primary',
  ],
  mapping: [
    'mapping_status',
    'verification_method',
    'source_url',
    'effective_on',
    'province_unit_id',
    'commune_unit_id',
    'mapping_evidence',
  ],
  contact: [
    'display_name',
    'phones',
    'raw_phone_text',
    'contact_type',
    'notes',
  ],
  link: ['contact_id', 'relation', 'is_primary', 'remove'],
};
export class InputError extends Error {
  constructor() {
    super('invalid-input');
  }
}
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function validateChanges(target: Target, input: unknown): Changes {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !targetFields[target]
  )
    throw new InputError();
  for (const [key, value] of Object.entries(input)) {
    if (!targetFields[target].includes(key)) throw new InputError();
    const field = fields[key];
    if (!field) throw new InputError();
    if (value === null) {
      if (field.required || ['boolean', 'phones'].includes(field.kind ?? ''))
        throw new InputError();
      continue;
    }
    if (field.kind === 'boolean') {
      if (typeof value !== 'boolean') throw new InputError();
    } else if (field.kind === 'phones') {
      if (
        !Array.isArray(value) ||
        value.length > 20 ||
        value.some(
          (v) =>
            typeof v !== 'string' ||
            v.length < 1 ||
            v.length > 100 ||
            v.includes('\0'),
        )
      )
        throw new InputError();
    } else {
      if (
        typeof value !== 'string' ||
        value.length > 2000 ||
        value.includes('\0') ||
        (field.required && !value.trim())
      )
        throw new InputError();
      if (field.options && !field.options.includes(value))
        throw new InputError();
      if (field.kind === 'uuid' && !isUuid(value)) throw new InputError();
      if (
        field.kind === 'date' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
          new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value)
      )
        throw new InputError();
      if (field.kind === 'money' && !/^(0|[1-9][0-9]{0,17})$/.test(value))
        throw new InputError();
      if (
        field.kind === 'count' &&
        (!/^(0|[1-9][0-9]{0,4})$/.test(value) || BigInt(value) > 32767n)
      )
        throw new InputError();
      if (
        field.kind === 'decimal' &&
        (!/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(value) ||
          /^0(?:\.0{1,2})?$/.test(value) ||
          (['frontage_m', 'depth_m'].includes(key) &&
            BigInt(value.split('.')[0]!) >= 1000000n))
      )
        throw new InputError();
      if (
        field.kind === 'coordinate' &&
        (!/^-?[0-9]{1,3}(\.[0-9]{1,7})?$/.test(value) ||
          Math.abs(Number(value)) > (key === 'latitude' ? 90 : 180))
      )
        throw new InputError();
    }
  }
  const result = input as Changes;
  if (
    target === 'address' &&
    result.format === 'current' &&
    (result.district_text != null || result.district_unit_id != null)
  )
    throw new InputError();
  return result;
}
export function formChanges(
  target: Target,
  form: FormData,
  before: Record<string, unknown> = {},
): Changes {
  const changes: Changes = {};
  for (const key of targetFields[target]) {
    if (!form.has(key)) continue;
    const value = form.get(key);
    if (typeof value !== 'string') throw new InputError();
    const kind = fields[key]!.kind;
    if (kind === 'boolean' && !['true', 'false'].includes(value))
      throw new InputError();
    if (
      kind === 'phones' &&
      Array.isArray(before[key]) &&
      value === (before[key] as string[]).join('\n')
    )
      continue;
    const parsed: Json =
      kind === 'boolean'
        ? value === 'true'
        : kind === 'phones'
          ? value
            ? value.split(/\r?\n/)
            : []
          : value === ''
            ? null
            : value;
    const prior =
      kind === 'count' && typeof before[key] === 'number'
        ? String(before[key])
        : (before[key] ?? null);
    if (JSON.stringify(parsed) !== JSON.stringify(prior)) changes[key] = parsed;
  }
  return validateChanges(target, changes);
}
