export type DetailTool =
  | 'sale'
  | 'reservation'
  | 'edit'
  | 'correction'
  | 'requests';

type DetailEmployee = { id: string; role: string };
type DetailProperty = {
  id: string;
  created_by: string;
  archived_at: string | null;
};

export type DetailAction = {
  tool: DetailTool;
  forEmployee: DetailEmployee;
  propertyId: string;
};

export function canEditDetail(
  employee: DetailEmployee | null,
  property: DetailProperty | null,
) {
  return (
    !!employee &&
    !!property &&
    !property.archived_at &&
    (employee.id === property.created_by ||
      ['staff', 'manager', 'admin'].includes(employee.role))
  );
}

export function activeDetailAction(
  action: DetailAction | null,
  employee: DetailEmployee | null,
  property: DetailProperty | null,
): DetailTool | null {
  if (
    !action ||
    !employee ||
    !property ||
    action.forEmployee !== employee ||
    action.propertyId !== property.id
  )
    return null;
  if (action.tool === 'edit' && !canEditDetail(employee, property)) return null;
  if (
    action.tool === 'sale' &&
    !['manager', 'admin'].includes(employee.role)
  )
    return null;
  return action.tool;
}
