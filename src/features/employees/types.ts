export type Locale = 'vi' | 'en';
export type Employee = {
  id: string;
  displayName: string;
  role: 'sales' | 'staff' | 'manager' | 'admin';
  locale: Locale;
};

// The employee plus the access revision their protected reads were authorized on.
export type EmployeeSession = {
  employee: Employee;
  accessRevision: number;
};
