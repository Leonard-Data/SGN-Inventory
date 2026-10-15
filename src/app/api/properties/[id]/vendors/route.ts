import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  linkPropertyVendor,
  propertyVendors,
} from '@/features/vendors/data';
import { VENDOR_LINK_BODY_MAX_BYTES } from '@/features/vendors/links';

// A property's Vendor section: every active employee who can read the property reads its
// vendor companies, separately from owners and brokers. Linking is a vendor-maintenance
// write (C5), re-checked live here and again inside the guarded operation.
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await propertyVendors(context, (await route.params).id),
    );
  });
}

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const link = await linkPropertyVendor(
      context,
      (await route.params).id,
      await objectBody(request, context, VENDOR_LINK_BODY_MAX_BYTES),
    );
    return NextResponse.json({ link });
  });
}
