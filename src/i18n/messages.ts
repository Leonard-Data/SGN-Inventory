export type Locale = 'vi' | 'en';

const vi = {
  title: 'SGN Inventory',
  heading: 'Nền tảng phát triển',
  description:
    'Cấu hình phát triển đã sẵn sàng. Chức năng kho bất động sản và đăng nhập chưa được triển khai.',
  language: 'Ngôn ngữ',
  setup: 'Xem README và docs/setup.md để thiết lập môi trường.',
};

export const messages: Record<Locale, Record<keyof typeof vi, string>> = {
  vi,
  en: {
    title: 'SGN Inventory',
    heading: 'Development foundation',
    description:
      'Development configuration is ready. Inventory and sign-in workflows are not implemented yet.',
    language: 'Language',
    setup: 'See README and docs/setup.md for environment setup.',
  },
};
