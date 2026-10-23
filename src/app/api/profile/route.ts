import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { myProfileBody } from '@/features/employees/profile';
import {
  loadMyProfile,
  updateMyProfile,
} from '@/features/employees/profile-data';

// A signed-in person's own profile. Both methods act on the live membership the session
// resolves to: neither takes an employee, so this route cannot read or write anyone else, and
// it carries no role, phone or email field.
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    return NextResponse.json(
      await loadMyProfile(context, employee.id, employee),
    );
  });
}

export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const values = myProfileBody(await objectBody(request, context, 4 * 1024));
    if (!values) throw new ApiError(400, 'invalid-input');
    return NextResponse.json(await updateMyProfile(context, values));
  });
}
