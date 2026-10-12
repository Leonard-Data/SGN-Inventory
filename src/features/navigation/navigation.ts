import type { MessageKey } from '@/i18n/messages';
import type { Employee } from '@/features/employees/types';

type Role = Employee['role'];

export type NavItem = {
  id: string;
  label: MessageKey;
  href: string;
  icon: 'search';
  roles: Role[];
};

export type NavGroup = { label: MessageKey; items: NavItem[] };

const ALL_ROLES: Role[] = ['sales', 'staff', 'manager', 'admin'];

// ADR 0001 defines six menu groups (Inventory, Reservations & Reviews, Rentals,
// People, Reports, Admin). Only destinations that exist are listed: a group or
// item is added here — with its route — in the change that ships the route, so
// the rail never links to a page that does not exist. Hidden items are not
// rendered, never rendered disabled.
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
    ],
  },
];

export function visibleNavGroups(role: Role): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => item.roles.includes(role)),
  })).filter((group) => group.items.length > 0);
}
