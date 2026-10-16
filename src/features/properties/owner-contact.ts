import 'server-only';
import { ApiError, type RouteContext } from '@/lib/supabase/route';
import type { OwnerContactDisclosure } from './types';

const errorMap: Record<string, [number, string]> = {
  '42501': [403, 'access-denied'],
  P0001: [400, 'invalid-input'],
  P0002: [404, 'property-not-found'],
  P0003: [409, 'owner-contact-missing'],
  P0004: [409, 'owner-phone-missing'],
  P0005: [409, 'disclosure-key-conflict'],
};

function disclosure(value: unknown): OwnerContactDisclosure {
  const row =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : null;
  const raw = row?.contact;
  const contact =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (
    !row ||
    (row.eventId !== null && typeof row.eventId !== 'string') ||
    typeof row.businessDay !== 'string' ||
    typeof row.credited !== 'boolean' ||
    (raw !== null && !contact) ||
    (contact !== null &&
      (typeof contact.id !== 'string' ||
        typeof contact.displayName !== 'string' ||
        typeof contact.relation !== 'string' ||
        typeof contact.isPrimary !== 'boolean' ||
        typeof contact.phone !== 'string'))
  )
    throw new ApiError(503, 'unavailable');
  return {
    eventId: row.eventId,
    businessDay: row.businessDay,
    credited: row.credited,
    contact:
      contact === null
        ? null
        : {
            id: contact.id as string,
            displayName: contact.displayName as string,
            relation: contact.relation as string,
            isPrimary: contact.isPrimary as boolean,
            phone: contact.phone as string,
          },
  };
}

// The database owns the disclosure transaction: authorization, owner resolution and credit
// commit together, and the retry key returns the original event instead of a new one.
export async function revealOwnerContact(
  context: RouteContext,
  propertyId: string,
  key: string,
): Promise<OwnerContactDisclosure> {
  const { data, error } = await context.client.rpc('reveal_owner_contact', {
    p_property_id: propertyId,
    p_key: key,
  });
  if (error) {
    const [status, code] = errorMap[error.code ?? ''] ?? [503, 'unavailable'];
    throw new ApiError(status, code);
  }
  return disclosure(data);
}
