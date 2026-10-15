import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  deactivationKey,
  mayAdministerEmployees,
} from '@/features/employees/deactivation';
import {
  administerEmployeeDeactivation,
  loadDeactivationConfirmation,
} from '@/features/employees/deactivation-data';

// Issue #66: the guarded employee-deactivation surface. Both methods re-read live membership
// and the live role from the session; the browser never supplies the actor, the target
// identity, an outcome or a revision.
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!mayAdministerEmployees(employee.role))
      throw new ApiError(403, 'access-denied');
    return NextResponse.json(
      await loadDeactivationConfirmation(context, (await route.params).id),
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
    const key = deactivationKey(body);
    if (!key) throw new ApiError(400, 'invalid-input');
    return NextResponse.json(
      await administerEmployeeDeactivation(
        context,
        employee,
        (await route.params).id,
        key,
      ),
    );
  });
}
