import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { historyPage } from '@/features/property-maintenance/data';
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await historyPage(
        context,
        (await route.params).id,
        request.nextUrl.searchParams,
      ),
    );
  });
}
