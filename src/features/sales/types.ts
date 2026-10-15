import type { EmployeeAccess } from '@/features/employees/directory';

export type SaleCloserOption = {
  id: string;
  displayName: string;
  access: EmployeeAccess;
};

export type CompletedSale = {
  id: string;
  propertyId: string;
  creditedEmployeeId: string;
  creditedEmployeeName: string;
  completedOn: string;
  reference: string;
  previousStatus: string;
  version: number;
  confirmedByName: string;
  confirmedAt: string;
};

// Why the reviewer-only confirmation form is not offered for this property. A recorded
// completion is not a refusal: the panel then shows the recorded fact instead.
export type SaleCompletionBlock =
  'archived' | 'rental' | 'status' | 'no-credited-employee' | null;

export type SaleCompletionState = {
  today: string;
  status: string;
  blocked: SaleCompletionBlock;
  suggestedCloser: { id: string; name: string } | null;
  employees: SaleCloserOption[];
  completion: CompletedSale | null;
};

export type CompletedSaleRankRow = {
  employeeId: string;
  employeeName: string;
  completedSales: number;
  rank: number;
};

export type CompletedSaleRanking = {
  from: string;
  to: string;
  today: string;
  rows: CompletedSaleRankRow[];
  totalCompletedSales: number;
  unknownAttribution: number;
};
