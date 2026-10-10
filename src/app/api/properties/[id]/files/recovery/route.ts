import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { recoverFiles } from '@/features/property-files/recovery-data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    const { id } = await route.params;
    const query = request.nextUrl.searchParams;
    if (
      [...query.keys()].some((key) => key !== 'fileId') ||
      query.getAll('fileId').length > 1
    )
      return NextResponse.json({ error: 'invalid-input' }, { status: 400 });
    return NextResponse.json(
      await recoverFiles(context, id, employee.id, query.get('fileId')),
    );
  });
}
