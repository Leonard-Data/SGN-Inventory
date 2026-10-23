import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import {
  createProperty,
  savedLegacyAddress,
} from '@/features/property-maintenance/data';
import { createWithContact } from '@/features/property-maintenance/create-contact';
import { activeEmployee } from '@/features/employees/access';
import {
  addContactNumber,
  contactChanges,
} from '@/features/properties/contact-number';
import { browseProperties } from '@/features/properties/data';
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context, 256 * 1024);
    // The owner's contact details travel with the create but are not a property fact: they are
    // read here and recorded once the record exists, by the same operation the record's own
    // capture form submits.
    const contact = contactChanges(body.contact);
    delete body.contact;
    const saved = contact
      ? await createWithContact(
          () => createProperty(context, body),
          (propertyId) =>
            addContactNumber(context, propertyId, { changes: contact }).then(
              (recorded) => recorded.id,
            ),
        )
      : { created: await createProperty(context, body) };
    return NextResponse.json(
      {
        ...saved.created,
        ...(await savedLegacyAddress(context, saved.created.id)),
        ...('contact' in saved ? { contact: saved.contact } : {}),
      },
      { status: 201 },
    );
  });
}
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await browseProperties(context, request.nextUrl.searchParams),
    );
  });
}
