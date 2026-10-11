import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { createProperty } from '@/features/property-maintenance/data';
import { activeEmployee } from '@/features/employees/access';
import { browseProperties } from '@/features/properties/data';
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await createProperty(
        context,
        await objectBody(request, context, 256 * 1024),
      ),
      { status: 201 },
    );
  });
}
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await browseProperties(context, request.nextUrl.searchParams),
    );
  });
}
