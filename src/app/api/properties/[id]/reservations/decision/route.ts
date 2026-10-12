import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { decideReservation } from '@/features/properties/reservation-data';

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    return NextResponse.json(
      await decideReservation(
        context,
        employee,
        (await route.params).id,
        await objectBody(request, context, 16 * 1024),
      ),
    );
  });
}
