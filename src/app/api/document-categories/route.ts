import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  listCategories,
  createOrGetCategory,
} from '@/features/property-files/upload-data';

export function GET(
  request: NextRequest,
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(await listCategories(context));
  });
}

export function POST(
  request: NextRequest,
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    if (
      Object.keys(body).some((key) => !['name'].includes(key)) ||
      typeof body.name !== 'string' ||
      !body.name.trim()
    )
      return NextResponse.json(
        { error: 'invalid-input', message: 'Category name is required' },
        { status: 400 },
      );
    const id = await createOrGetCategory(context, body.name);
    return NextResponse.json({ id });
  });
}
