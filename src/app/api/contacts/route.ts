import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { createContact } from '@/features/property-maintenance/data';
import { listContacts } from '@/features/contacts/data';

// Reading the recorded shared-contact directory is the same settled scope as correcting a
// linked shared contact: any live active employee, on a bounded page whose rows the
// database's RLS and the invoker wrapper decide. Creating a shared contact stays a
// staff/manager/admin operation (the guarded RPC refuses another role).
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
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
