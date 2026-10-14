import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  assertVendorMaintainer,
  createVendor,
  listVendors,
} from '@/features/vendors/data';
import { VENDOR_BODY_MAX_BYTES } from '@/features/vendors/draft';

// The vendor directory read is open to every active employee (C5); creation is
// staff/manager/admin only, re-checked live here and again inside the guarded RPC.
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await listVendors(context, request.nextUrl.searchParams),
    );
  });
}

export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    assertVendorMaintainer(employee.role);
    const vendor = await createVendor(
      context,
      await objectBody(request, context, VENDOR_BODY_MAX_BYTES),
    );
    return NextResponse.json({ vendor }, { status: 201 });
  });
}
