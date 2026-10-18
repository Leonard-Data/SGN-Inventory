import { isUuid } from '../../lib/supabase/query.ts';

// A merge request names the surviving record in the path and the records folded into it. The
// body carries nothing else, so a stray or replayed shape is refused before any file is copied.
export function mergeRequest(
  keepId: string,
  body: Record<string, unknown>,
): { keepId: string; merge: string[] } | null {
  const requested = body.merge;
  if (
    !isUuid(keepId) ||
    Object.keys(body).some((key) => key !== 'merge') ||
    !Array.isArray(requested) ||
    requested.length === 0 ||
    requested.length > 20 ||
    requested.some((value) => !isUuid(value)) ||
    new Set(requested).size !== requested.length ||
    requested.includes(keepId)
  )
    return null;
  return { keepId, merge: requested };
}

// A ready file's object key is bound to the property that owns it, so a merge moves each file to
// the surviving property's own key. A record that does not carry that shape stops the merge.
export function movedObjectPath(
  keepId: string,
  file: { id: string; propertyId: string; objectPath: string },
): string | null {
  const prefix = `${file.propertyId}/${file.id}/`;
  if (!file.objectPath.startsWith(prefix)) return null;
  return `${keepId}/${file.id}/${file.objectPath.slice(prefix.length)}`;
}
