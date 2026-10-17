// Pure classification of a property read, shared by the server boundary
// (property-access.ts) and its unit tests; no server-only or framework imports.
export type PropertyReadFailure =
  | { status: 403; code: 'access-denied' }
  | { status: 503; code: 'unavailable' }
  | { status: 404; code: 'property-not-found' };

export function classifyPropertyRead(result: {
  data: unknown;
  error: { code?: string } | null;
}): PropertyReadFailure | null {
  if (result.error)
    return result.error.code === '42501'
      ? { status: 403, code: 'access-denied' }
      : { status: 503, code: 'unavailable' };
  if (!result.data) return { status: 404, code: 'property-not-found' };
  return null;
}
