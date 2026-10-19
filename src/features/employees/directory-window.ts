import type { DirectoryEntry } from './directory.ts';
import type { CursorPage } from '@/features/stream/window';

// The one read the employee directory is a stream of. It pages by keyset cursor, so the stream
// reads it window by window without stating a total: the rows it has reached are what it knows
// of the directory's length, and the cursor the last row hands out is where the next window
// starts.
export const DIRECTORY_ENDPOINT = '/api/employees';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-input');
  return value as Record<string, unknown>;
}

// The recorded directory page as the read states it: the window's employees and the cursor after
// them. A payload whose envelope this page cannot place is a failed read, not a shorter page: a
// short page would silently end the stream.
export function directoryWindow(payload: unknown): CursorPage<DirectoryEntry> {
  const page = record(payload);
  if (
    !Array.isArray(page.employees) ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string')
  )
    throw new Error('invalid-input');
  const rows = page.employees.map((entry) => {
    const row = record(entry);
    if (typeof row.id !== 'string') throw new Error('invalid-input');
    return row as unknown as DirectoryEntry;
  });
  return { rows, next: page.nextCursor as string | null };
}
