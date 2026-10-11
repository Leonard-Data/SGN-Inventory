import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  listCategories,
  createOrGetCategory,
} from '@/features/property-files/upload-data';

export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(await listCategories(context));
  });
}

export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    if (
      Object.keys(body).some((key) => !['name'].includes(key)) ||
      typeof body.name !== 'string' ||
      !body.name.trim()
    )
      throw new ApiError(400, 'invalid-input');
    const id = await createOrGetCategory(context, body.name);
    return NextResponse.json({ id });
  });
}
