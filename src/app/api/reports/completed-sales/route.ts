import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { completedSaleRanking } from '@/features/sales/ranking-data';

export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    return NextResponse.json(
      await completedSaleRanking(
        context,
        employee,
        new URL(request.url).searchParams,
      ),
    );
  });
}
