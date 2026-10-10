import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { authorizeAndSignFile } from '@/features/property-files/data';

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string; fileId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    const { id, fileId } = await route.params;
    // Reject unknown keys; only 'download' allowed
    if (Object.keys(body).some((key) => key !== 'download'))
      throw new ApiError(400, 'invalid-input');
    const download = body.download === true;
    return NextResponse.json(
      await authorizeAndSignFile(context, id, fileId, download),
    );
  });
}
