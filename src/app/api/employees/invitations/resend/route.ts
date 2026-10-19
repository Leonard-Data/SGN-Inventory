import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  mayAdministerEmployees,
  resendBody,
} from '@/features/employees/invitation';
import { resendEmployeeInvitation } from '@/features/employees/invitation-data';

// Send a recorded, still unaccepted employee invitation again. The live admin is re-read from
// the session, the browser supplies only the recorded address, and the recorded invitation
// decides the role, the intended person and the provider identity. The response is the fresh
// recorded state, so an accepted further send and a refused one are reported as they were
// recorded instead of as the browser hoped.
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!mayAdministerEmployees(employee.role))
      throw new ApiError(403, 'access-denied');
    const body = await objectBody(request, context, 8 * 1024);
    const input = resendBody(body);
    if (!input) throw new ApiError(400, 'invalid-input');
    return NextResponse.json(await resendEmployeeInvitation(context, input));
  });
}
