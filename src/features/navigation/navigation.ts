import type { MessageKey } from '@/i18n/messages';
import type { Employee } from '@/features/employees/types';

type Role = Employee['role'];

export type NavItem = {
  id: string;
  label: MessageKey;
  href: string;
  icon: 'search' | 'plus' | 'inbox' | 'chart' | 'people';
  roles: Role[];
};

export type NavGroup = { label: MessageKey; items: NavItem[] };

const ALL_ROLES: Role[] = ['sales', 'staff', 'manager', 'admin'];
// The company activity report is an admin/manager read (its API checks the live role).
const REPORT_ROLES: Role[] = ['manager', 'admin'];
// The employee list is an admin read (its API and route guard check the live role).
const ADMIN_ROLES: Role[] = ['admin'];

// ADR 0001 defines six menu groups (Inventory, Reservations & Reviews, Rentals,
// People, Reports, Admin). Only destinations that exist are listed: a group or
// item is added here — with its route — in the change that ships the route, so
// the rail never links to a page that does not exist. Hidden items are not
// rendered, never rendered disabled. The correction queue is readable by every
// active employee (requester scope) though only staff/manager/admin decide a request.
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'inventory',
    items: [
      {
        id: 'inventory',
        label: 'navSearch',
        href: '/properties',
        icon: 'search',
        roles: ALL_ROLES,
      },
      {
        id: 'new-property',
        label: 'navNewProperty',
        href: '/properties/new',
        icon: 'plus',
        roles: ALL_ROLES,
      },
    ],
  },
  {
    label: 'reservationsReviews',
    items: [
      {
        id: 'corrections',
        label: 'navCorrections',
        href: '/reviews/corrections',
        icon: 'inbox',
        roles: ALL_ROLES,
      },
    ],
  },
  {
    label: 'people',
    items: [
      {
        id: 'employees',
        label: 'employeesLink',
        href: '/people/employees',
        icon: 'people',
        roles: ADMIN_ROLES,
      },
    ],
  },
  {
    label: 'reports',
    items: [
      {
        id: 'my-activity',
        label: 'myActivityLink',
        href: '/activity/me',
        icon: 'chart',
        roles: ALL_ROLES,
      },
      {
        id: 'company-activity',
        label: 'companyActivityLink',
        href: '/activity/company',
        icon: 'chart',
        roles: REPORT_ROLES,
      },
      {
        id: 'province-activity',
        label: 'provinceActivityLink',
        href: '/activity/provinces',
        icon: 'chart',
        roles: REPORT_ROLES,
      },
    ],
  },
];

export function visibleNavGroups(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}
