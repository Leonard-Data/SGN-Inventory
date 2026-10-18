import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { contactDetail } from '@/features/property-maintenance/data';
import { maintainContact } from '@/features/contacts/data';
// Detail read and correction share the shared-identity authority: the guarded impact RPC
// decides the affected-property disclosure the caller may see, and the correction runs
// through the same operation the property maintenance branch delegates to.
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await contactDetail(context, (await route.params).id),
    );
  });
}
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await maintainContact(
        context,
        (await route.params).id,
        await objectBody(request, context, 256 * 1024),
      ),
    );
  });
}
