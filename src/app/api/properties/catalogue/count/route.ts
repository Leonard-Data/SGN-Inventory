import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { catalogueTotal } from '@/features/properties/catalogue-data';

// The authorized total the browser states beside its progressive catalogue load: the caller's own
// session client counts the rows they may read, under the same eligibility as the catalogue pages,
// so the total and the batches describe one inventory. It is read once per load generation and is
// never what stops the traversal: a late or failed count leaves the total unknown and the pages
// keep arriving. The response is private and never cached by a shared cache.
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json({ total: await catalogueTotal(context) });
  });
}
