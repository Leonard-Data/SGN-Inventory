import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  addressGroup,
  mergeDuplicates,
} from '@/features/properties/duplicate-data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await addressGroup(context, (await route.params).id),
    );
  });
}

// Merging is a deliberate manager/admin action: the confirmation in the browser names both
// records, the route refuses another role before any file is copied, and the database re-checks
// the role, the address, the attested copies and the surviving record itself.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (employee.role !== 'manager' && employee.role !== 'admin')
      throw new ApiError(403, 'access-denied');
    return NextResponse.json(
      await mergeDuplicates(
        context,
        (await route.params).id,
        await objectBody(request, context),
      ),
    );
  });
}
