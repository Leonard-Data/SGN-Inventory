import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { setFileCategory } from '@/features/property-files/category-data';

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string; fileId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    const { id, fileId } = await route.params;
    if (
      Object.keys(body).some((key) => !['categoryId'].includes(key)) ||
      typeof body.categoryId !== 'string'
    )
      return NextResponse.json(
        { error: 'invalid-input' },
        { status: 400 },
      );
    await setFileCategory(context, id, fileId, body.categoryId);
    return NextResponse.json({ status: 'ok' });
  });
}
