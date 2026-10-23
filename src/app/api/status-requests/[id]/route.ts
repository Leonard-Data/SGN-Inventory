import { NextRequest, NextResponse } from 'next/server';
import { ApiError, runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { decideStatusRequest } from '@/features/property-status/data';
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (employee.role !== 'manager' && employee.role !== 'admin')
      throw new ApiError(403, 'access-denied');
    return NextResponse.json(
      await decideStatusRequest(
        context,
        (await route.params).id,
        await objectBody(request, context),
      ),
    );
  });
}
