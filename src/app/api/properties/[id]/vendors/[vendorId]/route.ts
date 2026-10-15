import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  assertVendorMaintainer,
  unlinkPropertyVendor,
} from '@/features/vendors/data';
import { VENDOR_LINK_BODY_MAX_BYTES } from '@/features/vendors/links';

// Correcting a mistaken link: only the current relationship is removed, under the same
// live role and property boundary as linking. The vendor and its earlier history stay.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string; vendorId: string }> },
) {
  return runRoute(request, async (context) => {
    const employee = await activeEmployee(context);
    assertVendorMaintainer(employee.role);
    const { id, vendorId } = await route.params;
    return NextResponse.json(
      await unlinkPropertyVendor(
        context,
        id,
        vendorId,
        await objectBody(request, context, VENDOR_LINK_BODY_MAX_BYTES),
      ),
    );
  });
}
