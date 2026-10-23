import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { setStatus } from '@/features/property-status/data';
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await setStatus(
        context,
        (await route.params).id,
        await objectBody(request, context),
      ),
    );
  });
}
