import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { todayActivity } from '@/features/employees/activity';
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(await todayActivity(context));
  });
}
