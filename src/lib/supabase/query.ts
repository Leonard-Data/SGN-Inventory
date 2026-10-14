export const timestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

// A keyset cursor is named by both parts. A parameter that is present must be a
// complete, well-formed cursor, so an empty or partial pair is not "no cursor".
export function cursorPair(
  params: URLSearchParams,
): { before: string; beforeId: string } | 'invalid' | null {
  const before = params.get('before'),
    beforeId = params.get('beforeId');
  if (before === null && beforeId === null) return null;
  if (
    before === null ||
    beforeId === null ||
    before === '' ||
    beforeId === '' ||
    !timestamp.test(before) ||
    !Number.isFinite(Date.parse(before)) ||
    !isUuid(beforeId)
  )
    return 'invalid';
  return { before, beforeId };
}
