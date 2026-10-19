import { NextRequest, NextResponse } from 'next/server';
import { ApiError, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { pendingStatusRequests } from '@/features/property-status/data';

// The reviewer queue: live membership first, then the live role, exactly as the other reviewer
// surfaces do. The trail read itself already follows each property's own boundary.
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (employee.role !== 'manager' && employee.role !== 'admin')
      throw new ApiError(403, 'access-denied');
    return NextResponse.json(
      await pendingStatusRequests(context, request.nextUrl.searchParams),
    );
  });
}
