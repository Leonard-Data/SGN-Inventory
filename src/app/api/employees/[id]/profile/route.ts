import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { mayAdministerEmployees } from '@/features/employees/deactivation';
import { profileBody } from '@/features/employees/profile';
import { updateEmployeeProfile } from '@/features/employees/profile-data';

// The guarded admin edit of one recorded employee: display name, phone, role and bio. Live
// admin membership and the live role are re-read here and again in the database; the browser
// never supplies the actor, and the email that identifies the account is not a field.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!mayAdministerEmployees(employee.role))
      throw new ApiError(403, 'access-denied');
    const values = profileBody(await objectBody(request, context));
    if (!values) throw new ApiError(400, 'invalid-input');
    return NextResponse.json(
      await updateEmployeeProfile(context, (await route.params).id, values),
    );
  });
}
