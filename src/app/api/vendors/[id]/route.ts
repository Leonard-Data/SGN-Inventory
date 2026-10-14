import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { vendorDetail } from '@/features/vendors/data';

// Detail is the same active-employee read boundary as the directory: RLS returns the
// row or nothing, and a missing row is a genuine not-found rather than a denial.
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json({
      vendor: await vendorDetail(context, (await route.params).id),
    });
  });
}
