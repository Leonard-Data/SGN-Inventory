import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { authorizeAndSignFile } from '@/features/property-files/data';

export function POST(
  request: NextRequest,
  route: { params: Promise<{ propertyId: string; fileId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    const { propertyId, fileId } = await route.params;
    const download = body?.download === true;
    return NextResponse.json(
      await authorizeAndSignFile(context, propertyId, fileId, download),
    );
  });
}
