import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployeeSession } from '@/features/employees/access';
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    const session = await activeEmployeeSession(context);
    context.setLocale(session.employee.locale);
    return NextResponse.json(session);
  });
}
