import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  InvitationError,
  invitationBody,
  invitationQuery,
  mayAdministerEmployees,
} from '@/features/employees/invitation';
import {
  administerEmployeeInvitation,
  loadInvitation,
} from '@/features/employees/invitation-data';

// Issue #68: the guarded employee-invitation surface. Both methods re-read live membership and
// the live role from the session; the browser never supplies the acting admin, the invited
// employee, the recorded role of an open invitation or a provider outcome. The read is the
// reconciliation path for a lost response and the pre-submission check for one normalized
// address.
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!mayAdministerEmployees(employee.role))
      throw new ApiError(403, 'access-denied');
    let email: string;
    try {
      email = invitationQuery(request.nextUrl.searchParams);
    } catch (failure) {
      throw new ApiError(
        400,
        failure instanceof InvitationError ? failure.code : 'invalid-input',
      );
    }
    return NextResponse.json(await loadInvitation(context, email));
  });
}

export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!mayAdministerEmployees(employee.role))
      throw new ApiError(403, 'access-denied');
    const body = await objectBody(request, context, 8 * 1024);
    const input = invitationBody(body);
    if (!input) throw new ApiError(400, 'invalid-input');
    return NextResponse.json(
      await administerEmployeeInvitation(context, employee, input),
    );
  });
}
