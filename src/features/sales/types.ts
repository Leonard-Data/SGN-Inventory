import type { EmployeeAccess } from '@/features/employees/directory';
import type { PropertySummary } from '@/features/properties/types';

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

// The answer to a committed completion: the fresh state plus the property's authoritative catalogue
// summary, so the browser's list shows the status the sale recorded rather than the one it held.
// An absent summary is one the server could not read back; the browser then reads the catalogue
// again instead of keeping what it holds.
export type SaleCompletionResult = SaleCompletionState & {
  summary?: PropertySummary | null;
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
