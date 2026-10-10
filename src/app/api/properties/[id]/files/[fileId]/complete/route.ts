import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { validateAndCompleteFile } from '@/features/property-files/upload-data';

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string; fileId: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    const body = await objectBody(request, context);
    const { id, fileId } = await route.params;
    if (Object.keys(body).length !== 0)
      throw new ApiError(400, 'invalid-input');
    return NextResponse.json(
      await validateAndCompleteFile(context, id, fileId, employee.id),
    );
  });
}
