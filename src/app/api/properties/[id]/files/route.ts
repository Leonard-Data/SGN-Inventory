import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { propertyFiles } from '@/features/property-files/data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await propertyFiles(context, (await route.params).id),
    );
  });
}
