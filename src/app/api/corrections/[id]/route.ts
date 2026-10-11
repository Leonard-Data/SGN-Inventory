import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  correctionDetail,
  transitionCorrection,
} from '@/features/corrections/data';
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await correctionDetail(context, (await route.params).id),
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
      await transitionCorrection(
        context,
        (await route.params).id,
        await objectBody(request, context, 256 * 1024),
      ),
    );
  });
}
