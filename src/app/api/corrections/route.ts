import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { correctionPage, submitCorrection } from '@/features/corrections/data';
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await correctionPage(context, request.nextUrl.searchParams),
    );
  });
}
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await submitCorrection(
        context,
        await objectBody(request, context, 256 * 1024),
      ),
      { status: 201 },
    );
  });
}
