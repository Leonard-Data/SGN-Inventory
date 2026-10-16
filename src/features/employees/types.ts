export type Locale = 'vi' | 'en';
export type Employee = {
  id: string;
  displayName: string;
  role: 'sales' | 'staff' | 'manager' | 'admin';
  locale: Locale;
};

export type EmployeeSession = {
  employee: Employee;
  accessRevision: number;
};
