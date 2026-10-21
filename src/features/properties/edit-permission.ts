import type { Employee } from '@/features/employees/types';

// The roles the property-edit rule admits beside the property's own creator. The database decides
// this edit; nothing a surface chooses widens it.
export const PROPERTY_EDIT_ROLES: readonly Employee['role'][] = [
  'staff',
  'manager',
  'admin',
];

// The one property-edit rule: an unarchived record may be edited by the employee who created it or
// by a staff, manager or admin. The full record's editor, its quick-view entry and the quick view's
// own price edit all read this, so no surface offers an edit another refuses.
export function mayEditProperty(
  employee: Pick<Employee, 'id' | 'role'> | null,
  record: { createdBy: string | null; archived: boolean },
): boolean {
  if (!employee || record.archived) return false;
  return (
    employee.id === record.createdBy ||
    PROPERTY_EDIT_ROLES.includes(employee.role)
  );
}
