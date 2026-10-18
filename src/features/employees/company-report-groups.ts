import type { CompanyActivityRow } from './company-report-data';

export type CompanyActivityGroup = {
  employeeId: string;
  employeeEmail: string;
  employeeName: string;
  // The group's rows that recorded activity (any metric above zero).
  count: number;
  rows: CompanyActivityRow[];
};

function recorded(row: CompanyActivityRow) {
  return (
    row.pageViewEvents > 0 ||
    row.distinctPropertiesViewed > 0 ||
    row.ownerContactProperties > 0
  );
}

// One group per employee, in the order the flat table listed them: the daily report orders rows
// by business day then employee, so an employee's first appearance decides its group position and
// every group keeps its day rows exactly as the table rendered them. The database reports a dense
// employee x day matrix (explicit zero days included), so the label counts the rows that recorded
// activity rather than the days in the range, which every employee would report identically.
export function activityGroups(
  rows: CompanyActivityRow[],
): CompanyActivityGroup[] {
  const groups = new Map<string, CompanyActivityGroup>();
  for (const row of rows) {
    let group = groups.get(row.employeeId);
    if (group === undefined) {
      group = {
        employeeId: row.employeeId,
        employeeEmail: row.employeeEmail,
        employeeName: row.employeeName,
        count: 0,
        rows: [],
      };
      groups.set(row.employeeId, group);
    }
    group.rows.push(row);
    if (recorded(row)) group.count += 1;
  }
  return [...groups.values()];
}
