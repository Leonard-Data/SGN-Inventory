import { NextRequest, NextResponse } from 'next/server';
import { ApiError, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { mayReadDirectory } from '@/features/employees/directory';
import { listEmployees } from '@/features/employees/directory-data';

export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    // Live membership first, then the live role: the employee list is an admin surface, and
    // the database row read behind it is the live admin's full employee read.
    const employee = await activeEmployee(context);
    if (!mayReadDirectory(employee.role))
      throw new ApiError(403, 'access-denied');
    return NextResponse.json(
      await listEmployees(context, request.nextUrl.searchParams),
    );
  });
}
