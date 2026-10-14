import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  requestReservation,
  reservationState,
} from '@/features/properties/reservation-data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    return NextResponse.json(
      await reservationState(context, employee, (await route.params).id),
    );
  });
}

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    return NextResponse.json(
      await requestReservation(
        context,
        employee,
        (await route.params).id,
        await objectBody(request, context, 16 * 1024),
      ),
    );
  });
}
