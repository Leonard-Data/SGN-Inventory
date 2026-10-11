import { NextRequest, NextResponse } from 'next/server';
import { ApiError, runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  createContact,
  listContacts,
} from '@/features/property-maintenance/data';
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    if (!['staff', 'manager', 'admin'].includes(employee.role))
      throw new ApiError(403, 'access-denied');
    return NextResponse.json(
      await listContacts(context, request.nextUrl.searchParams),
    );
  });
}
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await createContact(
        context,
        await objectBody(request, context, 256 * 1024),
      ),
      { status: 201 },
    );
  });
}
