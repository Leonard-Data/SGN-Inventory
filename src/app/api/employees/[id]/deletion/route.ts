import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  deletionKey,
  mayAdministerEmployees,
} from '@/features/employees/deletion';
import {
  administerEmployeeAccountDeletion,
  loadDeletionConfirmation,
} from '@/features/employees/deletion-data';

// Issue #67: the guarded permanent-account-deletion surface. Both methods re-read live
// membership and the live role from the session; the browser never supplies the actor, the
// target Auth identity, a Storage custodian, an outcome or a revision.
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!mayAdministerEmployees(employee.role))
      throw new ApiError(403, 'access-denied');
    return NextResponse.json(
      await loadDeletionConfirmation(context, (await route.params).id),
    );
  });
}

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!mayAdministerEmployees(employee.role))
      throw new ApiError(403, 'access-denied');
    const body = await objectBody(request, context, 8 * 1024);
    const key = deletionKey(body);
    if (!key) throw new ApiError(400, 'invalid-input');
    return NextResponse.json(
      await administerEmployeeAccountDeletion(
        context,
        employee,
        (await route.params).id,
        key,
      ),
    );
  });
}
