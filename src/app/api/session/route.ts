import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    context.setLocale(employee.locale);
    return NextResponse.json({ employee });
  });
}
