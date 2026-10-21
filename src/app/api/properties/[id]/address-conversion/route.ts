import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { convertAddressFormat } from '@/features/property-maintenance/data';
// The one deliberate action that switches an existing address between the legacy and the current
// format. An ordinary save still refuses to change an address's format.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await convertAddressFormat(
        context,
        (await route.params).id,
        await objectBody(request, context, 16 * 1024),
      ),
    );
  });
}
