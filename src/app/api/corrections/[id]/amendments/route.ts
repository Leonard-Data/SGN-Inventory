import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { amendmentPage } from '@/features/corrections/data';
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await amendmentPage(
        context,
        (await route.params).id,
        request.nextUrl.searchParams,
      ),
    );
  });
}
